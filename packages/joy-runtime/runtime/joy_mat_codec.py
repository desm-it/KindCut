"""Pure original-Joy mat vectors; NO transport or hardware effects.

Dimensions: 100047a70/1000489b0. EE codec: 10004823c/1000483a8.
EE reply vectors are synthetic, not a captured/validated hardware exchange.
Strict echo/length/busy validation and a 24-inch plausibility ceiling are
engineering fail-closed policy, not recovered firmware limits. This ceiling is
for short/long MATS only; smart-material feeding is out of scope.
"""
import math
import struct
from joy_protocol import clear_frame

MAX_MEASURED_INCHES = 24.0


def _bounded_number(value, maximum):
    if (type(value) not in (int, float) or not 0 <= value <= maximum
            or not math.isfinite(value)):
        raise ValueError('Invalid mat length')
    return float(value)


def dimensions(height_inches, *, mat_mode=0):
    if type(mat_mode) is not int or mat_mode not in (0, 2):
        raise ValueError('Unsupported original-Joy mat mode')
    if type(height_inches) not in (int, float) or not (
            (mat_mode == 0 and height_inches in (6.5, 12)) or
            (mat_mode == 2 and height_inches == 6.25)):
        raise ValueError('Choose a supported original-Joy mat')
    # Preserve Cupid width's exact source float bits and selected mode.
    payload = b'\x11' + bytes((mat_mode,)) + bytes.fromhex('4099999a') + struct.pack('>fff', height_inches, 0, 0)
    return clear_frame(payload)


def measurement_request(limit_inches=0):
    # Nonzero starts measurement; zero queries it. Building is NOT permission
    # to send: the complete safe measurement profile is still unaudited.
    limit = _bounded_number(limit_inches, 12)
    return clear_frame(b'\xee' + struct.pack('>f', limit))


def parse_measurement(payload):
    # Input is the decrypted payload, without outer two-byte framing.
    if not isinstance(payload, bytes) or len(payload) != 6 or payload[0] != 0xee:
        raise ValueError('Expected a typed measurement reply, not an ACK/error')
    if payload[1] not in (0, 1):
        raise ValueError('Unknown measurement busy state')
    length = _bounded_number(struct.unpack('>f', payload[2:])[0], MAX_MEASURED_INCHES)
    return bool(payload[1]), length
