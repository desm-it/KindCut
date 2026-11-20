"""Original-Joy axis-scale read codec and position arithmetic, offline only.

Source: ddccc selects property009B for model/protocol12; 05ee18/05ef50 encode
A0+u16BE and decode two f32BE fields. The second value feeds BOTH native axis
scales160/164 on this selected model. edd98/ede40 provide the arithmetic below.
No transport, guessed defaults, pressure-table interpolation, tool actuation or
physical clearance/calibration claim. A0 traffic has not been captured on Joy.
"""
from dataclasses import dataclass
from fractions import Fraction
import math
import struct


@dataclass(frozen=True)
class JoyAxisCalibration:
    first_native_f32: float
    axis_scale_f32: float


def _number(value):
    if type(value) not in (int, float):
        raise ValueError('A finite builtin number is required.')
    try:
        value = float(value)
    except OverflowError:
        raise ValueError('Number exceeds binary64 range.') from None
    if not math.isfinite(value):
        raise ValueError('A finite builtin number is required.')
    return value


def _f32(value):
    value = _number(value)
    try:
        rounded = struct.unpack('>f', struct.pack('>f', value))[0]
    except (OverflowError, struct.error):
        raise ValueError('Number exceeds binary32 range.') from None
    if not math.isfinite(rounded):
        raise ValueError('Number exceeds binary32 range.')
    return rounded


def _calibration(value):
    if type(value) is not JoyAxisCalibration:
        raise ValueError('An explicit original-Joy axis calibration is required.')
    first, scale = _number(value.first_native_f32), _number(value.axis_scale_f32)
    if scale <= 0 or _f32(scale) != scale or _f32(first) != first:
        raise ValueError('Calibration fields must be finite binary32; scale must be positive.')
    return scale


def _positive_fraction_to_f32(value):
    """Round nonnegative rational directly to binary32, avoiding double rounding."""
    if value < 0:
        raise ValueError('Expected a nonnegative rational.')
    n, d = value.numerator, value.denominator
    if n == 0:
        return 0.0
    exponent = n.bit_length() - d.bit_length()
    if ((n < d << exponent) if exponent >= 0 else (n << -exponent < d)):
        exponent -= 1
    quantum = max(exponent - 23, -149)
    scaled_n, scaled_d = (n, d << quantum) if quantum >= 0 else (n << -quantum, d)
    significand, remainder = divmod(scaled_n, scaled_d)
    if 2 * remainder > scaled_d or (2 * remainder == scaled_d and significand & 1):
        significand += 1
    try:
        result = math.ldexp(float(significand), quantum)
    except OverflowError:
        raise ValueError('Binary32 arithmetic overflow.') from None
    if result > float.fromhex('0x1.fffffep+127'):
        raise ValueError('Binary32 arithmetic overflow.')
    return result


def axis_scale_request_body():
    """Fixed original-Joy read, NOT a framed request or live query."""
    return b'\xa0\x00\x9b'


def decode_axis_scale_response_body(payload):
    # Native accepts >=11; exact11 is stricter local correlation/admission.
    if type(payload) is not bytes or len(payload) != 11 or payload[:3] != axis_scale_request_body():
        raise ValueError('Expected exactly11 bytes for property009B response.')
    first, scale = struct.unpack('>ff', payload[3:])
    result = JoyAxisCalibration(first, scale)
    _calibration(result)
    return result


def position_word_from_mm(mm, calibration):
    """edd98: f32(mm)/f32(25.4), f32-FMA(scale,+0.5), truncate to int.

    This is the positive PBModeApi.posMM branch, NOT an absolute-height or
    partial-lift command. Reject values outside the later uint16 wire field
    instead of emulating native narrowing/wrapping. No I/O is performed.
    """
    scale = _calibration(calibration)
    mm = _number(mm)
    if mm < 0:
        raise ValueError('Negative position input is not admitted.')
    source = _f32(mm)
    quotient = _positive_fraction_to_f32(Fraction(source) / Fraction(_f32(25.4)))
    rounded = _positive_fraction_to_f32(Fraction(quotient) * Fraction(scale) + Fraction(1, 2))
    result = math.trunc(rounded)
    if not 0 <= result <= 65535:
        raise ValueError('Position result exceeds local uint16 admission.')
    return result


def mm_from_native_position(value, calibration):
    """ede40 selected model12: binary64(value)/binary64(f32(scale))*25.4.

    Both selected native axes use property009B on model12; no other model,
    tool enum, physical origin or pressure/height meaning is inferred here.
    """
    scale = _calibration(calibration)
    if type(value) is not int or not 0 <= value <= 65535:
        raise ValueError('Expected a builtin uint16 position value.')
    return float(value) / scale * 25.4
