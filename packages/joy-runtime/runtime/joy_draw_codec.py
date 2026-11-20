"""Source-bound native draw INNER bodies, never a device execution API.

Pass35 selected-Joy factories reach 05aedc/05d5f0/05cb1c/060604;
scalar and batch representations were corroborated with ARM64 assembly.
No terminator, envelope, checksum, crypto, response parsing, tool configuration,
axis transform, plan-to-native mapping, adaptive batching or transport is added.
The worker deliberately does not import this module; cutting remains disabled.
"""
from dataclasses import dataclass
import math
import struct


@dataclass(frozen=True)
class NativeBatchPoint:
    """Already-native fields, not an SVG/pt72 coordinate or semantic tool command."""
    kind_low8: int
    x_native: float
    y_native: float


def _uint(value: int, bits: int) -> int:
    if type(value) is not int or not 0 <= value < (1 << bits):
        raise ValueError("Native point kind must be an exact unsigned integer.")
    return value


def _coordinate(value: float) -> float:
    if type(value) not in (int, float):
        raise ValueError("Native coordinate must be a finite builtin number.")
    try:
        number = float(value)
    except OverflowError:
        raise ValueError("Native coordinate is unrepresentable.") from None
    if not math.isfinite(number):
        raise ValueError("Native coordinate must be finite.")
    return number


def _binary32(value: float) -> bytes:
    try:
        encoded = struct.pack('<f', value)
    except (OverflowError, struct.error):
        raise ValueError("Native coordinate exceeds binary32 range.") from None
    restored = struct.unpack('<f', encoded)[0]
    # Engineering admission policy, stricter than an unchecked native fcvt:
    # do not silently serialize infinities or erase a nonzero coordinate.
    if not math.isfinite(restored) or (value != 0 and restored == 0):
        raise ValueError("Native coordinate loses range in binary32 conversion.")
    return encoded


def begin_draw_body() -> bytes:
    """05aedc: opcode plus three zero bytes; not a framed request."""
    return b'\x21\x00\x00\x00'


def end_draw_body() -> bytes:
    """05d5f0: opcode plus three zero bytes; not a framed request."""
    return b'\x22\x00\x00\x00'


def scalar_draw_body(kind_bits: int, x_internal: float, y_internal: float) -> bytes:
    """05cb1c: 42 + raw u32 LE + binary32 LE of two native fields /72.

    No semantic kind aliases are invented. Native parser axis/offset/coordinate
    mapping is unresolved; do not feed the geometry plan directly into this API.
    """
    kind = _uint(kind_bits, 32)
    fields = []
    for value in (x_internal, y_internal):
        number = _coordinate(value)
        scaled = number / 72.0
        if number != 0 and scaled == 0:
            raise ValueError("Native scalar division underflows.")
        fields.append(_binary32(scaled))
    return b'\x42' + struct.pack('<I', kind) + b''.join(fields)


def batch_draw_body(points: list[NativeBatchPoint] | tuple[NativeBatchPoint, ...], *, max_points: int = 56) -> bytes:
    """060604: 43 + (u8, f32LE, f32LE)*N; NO division or count byte.

    56 is the recovered normal Joy initial policy, not a universal wire limit.
    The bounded max_points override (1..1024) is a local resource policy; callers
    still need recovered selected-mode/adaptive-response contracts before use.
    Iterators are deliberately rejected so validation cannot execute an unbounded
    producer. Empty batches are rejected instead of serializing an opcode alone.
    """
    if type(max_points) is not int or not 1 <= max_points <= 1024:
        raise ValueError("Invalid local native batch limit.")
    if type(points) not in (list, tuple) or not 1 <= len(points) <= max_points:
        raise ValueError("Native batch must be a bounded nonempty plain sequence.")
    records = []
    for point in points:
        if type(point) is not NativeBatchPoint:
            raise ValueError("Invalid native batch record.")
        kind = _uint(point.kind_low8, 8)
        x = _binary32(_coordinate(point.x_native))
        y = _binary32(_coordinate(point.y_native))
        records.append(bytes([kind]) + x + y)
    return b'\x43' + b''.join(records)
