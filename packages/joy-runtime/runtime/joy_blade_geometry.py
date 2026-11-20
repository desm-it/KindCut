"""Pure offline port of the original-Joy selector2 drag-knife geometry path.

The port emits typed path records only.  It performs no transport, device,
helper, worker, file, account, or cutter operation.  The caller's separate
blade-execution gate remains authoritative.
"""
from dataclasses import dataclass
import math

from joy_coordinate_config import _fma

_MAX_ABS_COORDINATE = 1e6
_MAX_RECORDS = 100000
_DEGREES_PER_RADIAN = 57.29577951308232
_RADIANS_PER_DEGREE = 0.017453292519943295
_TURN_DOT_THRESHOLD = 0.8660254
_CURVE_LENGTH_LIMIT = 2.16
_CURVE_EPSILON = 1.000000013351432e-10
_CURVE_DISTANCE_TOLERANCE_SQUARED = 0.01
_CURVE_ANGLE_TOLERANCE = 0.5
_CURVE_RECURSION_LIMIT = 64
_ARC_DISTANCE_TOLERANCE = 0.01
_ARC_POINT_EPSILON = 0.001


@dataclass(frozen=True)
class BladeRecord:
    """One native-shaped 24-byte logical record (kind plus x/y doubles)."""

    kind: int
    x: float
    y: float


@dataclass(frozen=True)
class BladeSubpath:
    records: tuple[BladeRecord, ...]
    closed: bool
    initial_angle: float
    final_angle: float


@dataclass(frozen=True)
class BladeGeometry:
    paths: tuple[BladeSubpath, ...]
    final_angle: float


def _number(value, description='number'):
    if type(value) not in (int, float):
        raise ValueError(f'Expected a finite builtin {description}.')
    try:
        result = float(value)
    except OverflowError:
        raise ValueError(f'{description.capitalize()} out of range.') from None
    if not math.isfinite(result):
        raise ValueError(f'Expected a finite builtin {description}.')
    return result


def _point(value):
    if type(value) not in (tuple, list) or len(value) != 2:
        raise ValueError('Expected an exact two-coordinate point.')
    coords = []
    for item in value:
        item = _number(item, 'coordinate')
        if abs(item) > _MAX_ABS_COORDINATE:
            raise ValueError('Coordinate is nonfinite or exceeds local bound.')
        coords.append(item)
    return coords[0], coords[1]


def _uint(value, maximum, description):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError(f'Invalid {description}.')
    return value


def _positive_budget(value, description):
    if type(value) is not int or not 1 <= value <= _MAX_RECORDS:
        raise ValueError(f'Invalid {description}.')
    return value


def _bounded_append(target, value, maximum):
    if len(target) >= maximum:
        raise ValueError('Blade geometry record budget exceeded.')
    target.append(value)


def segment_length(start, end):
    """Native 0x1003375f8: sqrt(fma(dx,dx,dy*dy)), not two rounded squares."""
    x1, y1 = _point(start)
    x2, y2 = _point(end)
    dx, dy = x2 - x1, y2 - y1
    result = math.sqrt(_fma(dx, dx, dy * dy))
    if not math.isfinite(result):
        raise ValueError('Segment length overflowed.')
    return result


def segment_angle_degrees(start, end, *, reverse_y=False):
    """Native 0x1003375a0 directed angle in degrees."""
    if type(reverse_y) is not bool:
        raise ValueError('reverse_y must be an explicit boolean.')
    x1, y1 = _point(start)
    x2, y2 = _point(end)
    if x1 == x2 and y1 == y2:
        return 0.0
    dy = (y1 - y2) if reverse_y else (y2 - y1)
    result = math.atan2(dy, x1 - x2) * _DEGREES_PER_RADIAN
    if not math.isfinite(result):
        raise ValueError('Angle is nonfinite.')
    return result


def _native_path_angle(first, second):
    # 0x100335a74 passes the later point first and flag w0=1.
    return segment_angle_degrees(second, first)


def _first_angle(points):
    for first, second in zip(points, points[1:]):
        if first != second:
            return _native_path_angle(first, second)
    return 0.0


def _last_angle(points):
    for index in range(len(points) - 1, 0, -1):
        if points[index - 1] != points[index]:
            return _native_path_angle(points[index - 1], points[index])
    return 0.0


def _curve_leaf(points, p0, p1, p2, p3, depth, length_limited, maximum, work):
    """Port 0x100336fb0 in source evaluation order."""
    work[0] += 1
    if work[0] > work[1]:
        raise ValueError('Cubic subdivision work budget exceeded.')
    if depth > _CURVE_RECURSION_LIMIT:
        return
    x12 = (p0[0] + p1[0]) * 0.5
    y12 = (p0[1] + p1[1]) * 0.5
    x23 = (p1[0] + p2[0]) * 0.5
    y23 = (p1[1] + p2[1]) * 0.5
    x34 = (p2[0] + p3[0]) * 0.5
    y34 = (p2[1] + p3[1]) * 0.5
    x123 = (x12 + x23) * 0.5
    y123 = (y12 + y23) * 0.5
    x234 = (x23 + x34) * 0.5
    y234 = (y23 + y34) * 0.5
    middle = ((x123 + x234) * 0.5, (y123 + y234) * 0.5)

    subdivide = depth < 1
    if not subdivide and length_limited:
        polygon_length = (
            segment_length(p0, (x12, y12))
            + segment_length((x12, y12), (x123, y123))
            + segment_length((x123, y123), middle)
            + segment_length(middle, (x234, y234))
            + segment_length((x234, y234), (x34, y34))
            + segment_length((x34, y34), p3)
        )
        subdivide = _CURVE_LENGTH_LIMIT < polygon_length

    if not subdivide:
        dx = p3[0] - p0[0]
        dy = p3[1] - p0[1]
        cross1 = -(dx * (p1[1] - p3[1])) + dy * (p1[0] - p3[0])
        cross2 = -(dx * (p2[1] - p3[1])) + dy * (p2[0] - p3[0])
        d1, d2 = abs(cross1), abs(cross2)
        significant1 = d1 > _CURVE_EPSILON
        significant2 = d2 > _CURVE_EPSILON

        if significant1 and significant2:
            flat = ((d1 + d2) * (d1 + d2) <=
                    (dy * dy + dx * dx) * _CURVE_DISTANCE_TOLERANCE_SQUARED)
            if flat:
                a1 = abs(math.atan2(p2[1] - p1[1], p2[0] - p1[0]) -
                         math.atan2(p1[1] - p0[1], p1[0] - p0[0]))
                a2 = abs(math.atan2(p3[1] - p2[1], p3[0] - p2[0]) -
                         math.atan2(p2[1] - p1[1], p2[0] - p1[0]))
                if a1 >= 3.1415963172912598:
                    a1 = 6.2831926345825195 - a1
                if a2 >= 3.1415963172912598:
                    a2 = 6.2831926345825195 - a2
                flat = a1 + a2 < _CURVE_ANGLE_TOLERANCE
        elif not significant1 and not significant2:
            mx = middle[0] - (p0[0] + p3[0]) * 0.5
            my = middle[1] - (p0[1] + p3[1]) * 0.5
            flat = my * my + mx * mx <= _CURVE_DISTANCE_TOLERANCE_SQUARED
        elif not significant1:
            flat = ((dy * dy + dx * dx) * _CURVE_DISTANCE_TOLERANCE_SQUARED >=
                    cross2 * cross2)
            if flat:
                angle = abs(math.atan2(p3[1] - p2[1], p3[0] - p2[0]) -
                            math.atan2(p2[1] - p1[1], p2[0] - p1[0]))
                if angle >= 3.1415963172912598:
                    angle = 6.2831926345825195 - angle
                flat = angle < _CURVE_ANGLE_TOLERANCE
        else:
            flat = ((dy * dy + dx * dx) * _CURVE_DISTANCE_TOLERANCE_SQUARED >=
                    cross1 * cross1)
            if flat:
                angle = abs(math.atan2(p2[1] - p1[1], p2[0] - p1[0]) -
                            math.atan2(p1[1] - p0[1], p1[0] - p0[0]))
                if angle >= 3.1415963172912598:
                    angle = 6.2831926345825195 - angle
                flat = angle < _CURVE_ANGLE_TOLERANCE
        if flat:
            _bounded_append(points, middle, maximum)
            return

    _curve_leaf(points, p0, (x12, y12), (x123, y123), middle,
                depth + 1, length_limited, maximum, work)
    _curve_leaf(points, middle, (x234, y234), (x34, y34), p3,
                depth + 1, length_limited, maximum, work)


def _parse_steps(steps, maximum_source, maximum_intermediate):
    if type(steps) is not list or not steps or len(steps) > maximum_source:
        raise ValueError('Expected a bounded nonempty normalized step list.')
    subpaths = []
    points = None
    start = current = None
    drew = False
    curve_work = [0, max(64, maximum_intermediate * 4)]

    def finish(closed=False):
        nonlocal points, start, current, drew
        if points is not None:
            if not drew:
                raise ValueError('Subpath has no drawable geometry.')
            subpaths.append((points, closed or points[0] == points[-1]))
        points = None
        start = current = None
        drew = False

    for raw in steps:
        if type(raw) is not dict or set(raw) != {'op', 'points'}:
            raise ValueError('Unexpected normalized command fields.')
        op, raw_points = raw['op'], raw['points']
        if type(op) is not str or op not in ('M', 'L', 'C', 'Z'):
            raise ValueError('Unsupported normalized command.')
        count = 0 if op == 'Z' else 3 if op == 'C' else 1
        if type(raw_points) is not list or len(raw_points) != count:
            raise ValueError('Wrong command point count.')
        parsed = []
        for raw_point in raw_points:
            if type(raw_point) is not dict or set(raw_point) != {'x', 'y'}:
                raise ValueError('Unexpected point fields.')
            parsed.append(_point((raw_point['x'], raw_point['y'])))
        if op == 'M':
            finish()
            points = [parsed[0]]
            start = current = parsed[0]
            continue
        if points is None or start is None or current is None:
            raise ValueError('Drawing/close requires active M.')
        if op == 'L':
            _bounded_append(points, parsed[0], maximum_intermediate)
            current = parsed[0]
            drew = True
        elif op == 'C':
            _curve_leaf(points, current, parsed[0], parsed[1], parsed[2], 0,
                        True, maximum_intermediate, curve_work)
            _bounded_append(points, parsed[2], maximum_intermediate)
            current = parsed[2]
            drew = True
        else:
            if current != start:
                _bounded_append(points, start, maximum_intermediate)
            finish(True)
    finish()
    if not subpaths:
        raise ValueError('No drawable blade geometry.')
    return subpaths


def _remove_adjacent_duplicates(points):
    # 0x100334af8 skips the earlier member of each equal adjacent pair.
    return [point for index, point in enumerate(points)
            if index == len(points) - 1 or point != points[index + 1]]


def _rotate_closed_for_angle(points, wanted_angle):
    """Apply 333ea8's bounded direction choice, then 333ff8's rotation."""
    if len(points) < 3 or points[0] != points[-1]:
        return points

    forward_min = reverse_min = 360.0
    # Native 333ea8 examines i=0..n-3 inclusive: it deliberately omits
    # the closing edge and compares each segment in both directions.
    for index in range(len(points) - 2):
        first, second = points[index], points[index + 1]
        if first == second:
            continue
        forward_difference = abs(_native_path_angle(first, second) - wanted_angle)
        reverse_difference = abs(_native_path_angle(second, first) - wanted_angle)
        if forward_difference < forward_min:
            forward_min = forward_difference
        if reverse_difference < reverse_min:
            reverse_min = reverse_difference

    vertices = list(reversed(points)) if reverse_min < forward_min else list(points)

    def rotate(vertices):
        best_index, best_difference = 0, math.inf
        for index, first in enumerate(vertices):
            second = vertices[(index + 1) % len(vertices)]
            if first != second:
                difference = abs(_native_path_angle(first, second) - wanted_angle)
                if difference < best_difference:
                    best_index, best_difference = index, difference
        turned = vertices[best_index:] + vertices[:best_index]
        return turned + [turned[0]], best_difference

    return rotate(vertices[:-1])[0]


def _extend_segment(start, end, distance):
    """Both return registers of 0x100337680, including axis branches."""
    x1, y1 = start
    x2, y2 = end
    if start == end:
        return end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0.0:
        return x1, y1 + distance if dy > 0.0 else y1 - distance
    if dy == 0.0:
        return x1 + distance if dx > 0.0 else x1 - distance, y1
    angle = (math.atan2(dy, dx) * _DEGREES_PER_RADIAN) * _RADIANS_PER_DEGREE
    return (_fma(distance, math.cos(angle), x1),
            _fma(distance, math.sin(angle), y1))


def _append_overcut(points, distance, maximum):
    if distance == 0.0:
        return
    accumulated = 0.0
    original_count = len(points)
    for index in range(original_count - 1):
        start, end = points[index], points[index + 1]
        length = abs(segment_length(start, end))
        point = _extend_segment(start, end, distance) if distance < length else end
        _bounded_append(points, point, maximum)
        accumulated += distance if distance < length else length
        if accumulated >= distance:
            break


def _unit(start, end):
    # 0x10034d588 normalizes in this operand order, then normalizes once more.
    dx, dy = end[0] - start[0], end[1] - start[1]
    for _ in range(2):
        length = math.sqrt(dy * dy + dx * dx)
        if 1e-15 < abs(length):
            dx, dy = dx / length, dy / length
    return dx, dy


def _turn_arc(target, center, start, end, cross, radius, maximum):
    if radius == 0.0 or start == end:
        if start != end:
            _bounded_append(target, end, maximum)
        return
    # 0x10034addc drops an arc node when both endpoint deltas are below 1e-3.
    if (abs(end[0] - start[0]) < _ARC_POINT_EPSILON and
            abs(end[1] - start[1]) < _ARC_POINT_EPSILON):
        return
    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    end_angle = math.atan2(end[1] - center[1], end[0] - center[0])
    if cross > 0.0:
        while end_angle <= start_angle:
            end_angle += math.tau
    else:
        while end_angle >= start_angle:
            end_angle -= math.tau
    delta = end_angle - start_angle
    chord_angle = 2.0 * math.acos(max(-1.0, min(1.0,
        (radius - _ARC_DISTANCE_TOLERANCE) / radius)))
    count = 100 if chord_angle == 0.0 else math.ceil(abs(delta) / chord_angle)
    count = min(100, max(4, count))
    step = delta / count
    for index in range(1, count + 1):
        angle = start_angle + step * index
        point = (_fma(radius, math.cos(angle), center[0]),
                 _fma(radius, math.sin(angle), center[1]))
        _bounded_append(target, point, maximum)


def _offset_polyline(points, radius, maximum):
    segments = []
    for start, end in zip(points, points[1:]):
        ux, uy = _unit(start, end)
        if ux == 0.0 and uy == 0.0:
            continue
        shifted_start = (_fma(radius, ux, start[0]), _fma(radius, uy, start[1]))
        shifted_end = (_fma(radius, ux, end[0]), _fma(radius, uy, end[1]))
        segments.append((start, end, (ux, uy), shifted_start, shifted_end))
    if not segments:
        raise ValueError('Subpath has no drawable geometry.')
    result = []
    _bounded_append(result, segments[0][3], maximum)
    for index, segment in enumerate(segments):
        _bounded_append(result, segment[4], maximum)
        if index + 1 == len(segments):
            continue
        next_segment = segments[index + 1]
        ux, uy = segment[2]
        vx, vy = next_segment[2]
        if ux * vx + uy * vy < _TURN_DOT_THRESHOLD:
            cross = ux * vy - uy * vx
            center = (segment[4][0] - radius * ux,
                      segment[4][1] - radius * uy)
            _turn_arc(result, center, segment[4], next_segment[3],
                      cross, radius, maximum)
    return result


def _point_at(distance, angle_degrees, origin):
    angle = angle_degrees * _RADIANS_PER_DEGREE
    sine, cosine = math.sin(angle), math.cos(angle)
    return (_fma(distance, cosine, origin[0]),
            _fma(-distance, sine, origin[1]))


def _angle_delta(start, end):
    delta = end - start
    while delta > 180.0:
        delta -= 360.0
    while delta < -180.0:
        delta += 360.0
    return delta


def _lead_arc(origin, distance, start_angle, end_angle, maximum):
    delta = _angle_delta(start_angle, end_angle)
    count = max(4, math.ceil(abs(delta) / 10.0))
    denominator = count - 1
    points = []
    for index in range(1, count):
        angle = _fma(delta / denominator, float(index), start_angle)
        _bounded_append(points, _point_at(distance, angle, origin), maximum)
    return points


def _add_lead(offset_points, origin, distance, previous_angle, lead_mode, maximum):
    if lead_mode == 1 or len(offset_points) < 2:
        return list(offset_points)
    current_angle = _native_path_angle(offset_points[0], offset_points[1])
    lead = []
    if lead_mode in (0, 2):
        _bounded_append(lead, _point_at(distance, previous_angle, origin), maximum)
    if lead_mode in (0, 3):
        for point in _lead_arc(origin, distance, previous_angle,
                               current_angle, maximum):
            _bounded_append(lead, point, maximum)
    for point in offset_points:
        _bounded_append(lead, point, maximum)
    return lead


def _normalize_terminal_records(points, maximum):
    if len(points) + 2 > maximum:
        raise ValueError('Blade geometry record budget exceeded.')
    records = [BladeRecord(2, points[0][0], points[0][1]),
               BladeRecord(0, points[0][0], points[0][1])]
    records.extend(BladeRecord(0, point[0], point[1]) for point in points[1:])
    records.append(BladeRecord(2, points[-1][0], points[-1][1]))
    return tuple(records)


def offset_path(steps, *, offset=1.133858323097229, options_word=2,
                initial_angle=0.0, lead_mode=0, max_source_records=100000,
                max_output_records=100000):
    """Apply selected ToolType2 geometry to normalized absolute M/L/C/Z.

    ``offset`` is an explicit pure-kernel radius override (not a bound
    ToolGeometryPolicy/custom-offset setting); native default is model12's
    literal radius. ``lead_mode`` is the recovered lead policy selector.

    Returned records are offline geometry artifacts, not cutter commands.
    """
    raw_offset = _number(offset, 'offset')
    if not 0.0 <= raw_offset <= 72.0:
        raise ValueError('Offset exceeds local admission range.')
    _uint(options_word, 0xffffffff, 'options word')
    if options_word != 2:
        raise ValueError('Only selected ToolType2 is supported.')
    _uint(lead_mode, 3, 'lead mode')
    maximum_source = _positive_budget(max_source_records, 'source record budget')
    maximum_output = _positive_budget(max_output_records, 'output record budget')
    if initial_angle is None:
        raise ValueError('Initial angle must be explicitly available.')
    initial_angle = _number(initial_angle, 'initial angle')
    if abs(initial_angle) > 360.0:
            raise ValueError('Initial angle exceeds local admission range.')

    parsed = _parse_steps(steps, maximum_source, maximum_output)
    scalar = raw_offset
    results = []
    previous_angle = initial_angle
    total_output = 0
    for source_points, closed in parsed:
        points = _remove_adjacent_duplicates(source_points)
        if len(points) < 2:
            raise ValueError('Subpath has no drawable geometry.')
        if closed:
            points = _rotate_closed_for_angle(points, previous_angle)
        origin = points[0]
        if closed:
            _append_overcut(points, scalar, maximum_output)
        final_angle = _last_angle(points)
        offset_points = _offset_polyline(points, scalar, maximum_output)
        trajectory = _add_lead(offset_points, origin, scalar,
                               previous_angle, lead_mode, maximum_output)
        records = _normalize_terminal_records(trajectory, maximum_output)
        total_output += len(records)
        if total_output > maximum_output:
            raise ValueError('Blade geometry record budget exceeded.')
        record_points = [(record.x, record.y) for record in records]
        result_initial = _first_angle(record_points)
        results.append(BladeSubpath(records, closed, result_initial, final_angle))
        previous_angle = final_angle
    return BladeGeometry(tuple(results), previous_angle if previous_angle is not None else 0.0)
