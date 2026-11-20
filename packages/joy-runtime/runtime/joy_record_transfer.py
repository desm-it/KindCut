"""Pure admitted subset of native d6a44 intermediate-record transfer.

No parser selection, SVG/axis/origin transform, kind9 handling, tool semantics,
framing, transport or physical state. Caller must supply a proved record frame.
"""
from dataclasses import dataclass
import math
from joy_point_adapter import InternalDrawPoint

@dataclass(frozen=True)
class ParserRecord:
    kind: int
    x: float
    y: float

def transfer_records(records: list[ParserRecord] | tuple[ParserRecord, ...], *, options_word: int, max_records: int = 100000) -> tuple[InternalDrawPoint, ...]:
    """Transfer only valid kinds0/1/2; source types remain opaque.

    Source kind1 consumes three consecutive input rows and emits FOUR kind1
    rows: prior pair, then those three pairs. Every admitted path ends with an
    extra kind2 at the final pair. Options4/5 append kind0 at each kind2's CURRENT
    pair, not its previous pair. No coordinate arithmetic/scaling occurs here.
    Engineering admission rejects empty/non-kind2-start paths, unsupported9 and
    incomplete/mixed groups instead of reproducing native unchecked lookahead
    or its empty-input origin record. Max1..100000 is a local resource bound.
    """
    if type(options_word) is not int or not 0 <= options_word <= 0xffffffff:
        raise ValueError("Options must be an exact unsigned32 word.")
    if type(max_records) is not int or not 1 <= max_records <= 100000:
        raise ValueError("Invalid local record limit.")
    if type(records) not in (list, tuple) or not 1 <= len(records) <= max_records:
        raise ValueError("Records must be a bounded nonempty plain sequence.")
    normalized = []
    for record in records:
        if type(record) is not ParserRecord or type(record.kind) is not int or record.kind not in (0, 1, 2):
            raise ValueError("Unsupported intermediate record kind or type.")
        pair = []
        for value in (record.x, record.y):
            if type(value) not in (int, float):
                raise ValueError("Coordinates must be finite builtin binary64 values.")
            try:
                number = float(value)
            except OverflowError:
                raise ValueError("Coordinate exceeds binary64 range.") from None
            if not math.isfinite(number):
                raise ValueError("Coordinates must be finite.")
            pair.append(number)
        normalized.append(InternalDrawPoint(record.kind, pair[0], pair[1]))
    if normalized[0].kind_bits != 2:
        raise ValueError("Admitted path must start with kind2.")
    output = []
    previous = (0.0, 0.0)
    index = 0
    while index < len(normalized):
        point = normalized[index]
        if point.kind_bits == 1:
            group = normalized[index:index+3]
            if len(group) != 3 or any(p.kind_bits != 1 for p in group):
                raise ValueError("Kind1 requires three consecutive input rows.")
            output.append(InternalDrawPoint(1, *previous))
            output.extend(group)
            point = group[-1]
            index += 3
        else:
            output.append(point)
            if point.kind_bits == 2 and options_word & 0xfffffffe == 4:
                output.append(InternalDrawPoint(0, point.x_internal, point.y_internal))
            index += 1
        previous = (point.x_internal, point.y_internal)
    output.append(InternalDrawPoint(2, *previous))
    return tuple(output)
