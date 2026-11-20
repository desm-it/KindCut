"""Offline selected-curve arithmetic from native f0284; not device calibration.

The caller must supply the already selected device/tool calibration points.
This module neither selects a native tool bucket nor reads a device or preset.
"""


from fractions import Fraction
import math

from joy_tool_calibration import _positive_fraction_to_f32


def _word(value):
    if type(value) is not int or not 0 <= value <= 65535:
        raise ValueError('Expected a builtin uint16 calibration value.')
    return value


def interpolate_pressure_counts(requested, points):
    """Port f0284 AFTER native tool-bucket filtering, for explicit U16 points.

    Local admission is stricter than native: 1..4096 ordered distinct input
    samples and uint16 request/output fields. No sorting, guessed table,
    grams/height conversion or physical-pressure interpretation is performed.
    Source f038c..f03f0 uses F32 divide, F32 FMADD, zero/prior fallback and
    FCVTZS; it does not round the final integer to nearest.
    """
    requested = _word(requested)
    if type(points) not in (tuple, list) or not 1 <= len(points) <= 4096:
        raise ValueError('An explicit bounded selected calibration curve is required.')
    samples = []
    for point in points:
        if type(point) not in (tuple, list) or len(point) != 2:
            raise ValueError('Expected an exact pressure/count pair.')
        pressure, counts = (_word(value) for value in point)
        if samples and pressure <= samples[-1][0]:
            raise ValueError('Calibration input samples must be strictly increasing.')
        samples.append((pressure, counts))

    previous = None
    result = 0.0
    for pressure, counts in samples:
        if pressure < requested:
            previous = (pressure, counts)
            continue
        if pressure == requested or previous is None:
            result = float(counts)
        else:
            # All U16 integers/subtractions are exactly representable in F32.
            # Round FDIV then round the fused multiply-add only once.
            fraction = _positive_fraction_to_f32(
                Fraction(requested - previous[0], pressure - previous[0]))
            result = _positive_fraction_to_f32(
                Fraction(fraction) * (counts - previous[1]) + previous[1])
        break
    if result == 0.0 and previous is not None:
        result = float(previous[1])
    return math.trunc(result)
