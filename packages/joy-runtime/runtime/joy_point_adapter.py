"""Inert selected-Joy internal-point to batch-body adapter.

0609dc copies a point then divides BOTH nested binary64 fields by72 before
060604 serializes. Does not map SVG axes, choose kind tags, flatten cubics,
configure tools, frame/encrypt, send, or establish physical safety/completion.
"""
from dataclasses import dataclass
from joy_draw_codec import scalar_draw_body

@dataclass(frozen=True)
class InternalDrawPoint:
    kind_bits: int
    x_internal: float
    y_internal: float

def batch_body_from_internal(points: list[InternalDrawPoint] | tuple[InternalDrawPoint, ...], *, max_points: int = 56) -> bytes:
    """Compose AddPoint normalization plus batch serialization, without I/O.

    Input is a proved internal record frame, NOT an SVG/native-wire point. The
    existing scalar encoder implements the same f64/72 ->f32LE operation, so
    reuse its strict u32/coordinate/range validation and coordinate bytes ONLY.
    Its scalar header/kind are not emitted; kind is truncated at the batch wire
    boundary. No scalar requests, additional division, or count bytes are sent.
    56 default and1..1024 override are existing local admission policies.
    """
    if type(max_points) is not int or not 1 <= max_points <= 1024:
        raise ValueError("Invalid local native batch limit.")
    if type(points) not in (list, tuple) or not 1 <= len(points) <= max_points:
        raise ValueError("Internal batch must be a bounded nonempty plain sequence.")
    records = []
    for point in points:
        if type(point) is not InternalDrawPoint:
            raise ValueError("Invalid internal draw record.")
        scalar = scalar_draw_body(point.kind_bits, point.x_internal, point.y_internal)
        records.append(bytes([point.kind_bits & 0xff]) + scalar[5:])
    return b'\x43' + b''.join(records)
