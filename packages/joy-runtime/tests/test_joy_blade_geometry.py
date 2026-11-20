"""Hardware-free analytic/source-derived selector2 blade geometry tests."""
from pathlib import Path
import math
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from joy_blade_geometry import offset_path, segment_length, segment_angle_degrees


def step(op, *points):
    return {'op': op, 'points': [{'x': x, 'y': y} for x, y in points]}


def coordinates(path):
    return [(record.x, record.y) for record in path.records]


class BladeGeometryTests(unittest.TestCase):
    def test_native_segment_length_is_euclidean(self):
        self.assertEqual(segment_length((0, 0), (3, 4)), 5.0)

    def test_native_segment_length_preserves_fused_square_sum(self):
        dx = float.fromhex('-0x1.7066955fa0d16p+19')
        dy = float.fromhex('-0x1.ace028aba7920p+15')
        self.assertEqual(segment_length((0, 0), (dx, dy)),
                         float.fromhex('0x1.715fe492c7101p+19'))

    def test_native_directed_angle_degrees(self):
        for end, expected in [((1, 0), 180.0), ((0, 1), 90.0),
                              ((-1, 0), 0.0), ((0, -1), -90.0)]:
            with self.subTest(end=end):
                self.assertEqual(segment_angle_degrees((0, 0), end), expected)
        self.assertEqual(segment_angle_degrees((0, 0), (0, 1), reverse_y=True), -90.0)

    def test_coincident_angle_is_zero(self):
        self.assertEqual(segment_angle_degrees((2, 3), (2, 3)), 0.0)

    def test_invalid_points(self):
        for point in [(math.nan, 0), (0, math.inf), (1e7, 0), (True, 0),
                      (10**1000, 0), (1,), '12']:
            with self.subTest(point=repr(point)):
                with self.assertRaises(ValueError):
                    segment_length((0, 0), point)

    def test_reverse_y_requires_explicit_boolean(self):
        for value in (0, 1, None, 'false'):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    segment_angle_degrees((0, 0), (0, 1), reverse_y=value)

    def test_open_line_has_native_lead_and_terminal_records(self):
        result = offset_path([step('M', (0, 0)), step('L', (10, 0))],
                             offset=1.0)
        self.assertEqual(len(result.paths), 1)
        path = result.paths[0]
        self.assertFalse(path.closed)
        self.assertEqual([record.kind for record in path.records],
                         [2, 0, 0, 0, 0, 0, 0, 2])
        self.assertEqual(coordinates(path),
                         [(1.0, 0.0)] * 6 + [(11.0, 0.0)] * 2)
        self.assertEqual(path.initial_angle, 0.0)
        self.assertEqual(path.final_angle, 0.0)

    def test_right_angle_inserts_source_threshold_turn_arc(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (10, 0)), step('L', (10, 10)),
        ], offset=1.0, lead_mode=1)
        points = coordinates(result.paths[0])
        expected = [
            (1.0, 0.0), (1.0, 0.0), (11.0, 0.0),
            (10.965925826289068, 0.25881904510252074),
            (10.86602540378444, 0.49999999999999994),
            (10.707106781186548, 0.7071067811865475),
            (10.5, 0.8660254037844386),
            (10.258819045102522, 0.9659258262890682),
            (10.0, 1.0), (10.0, 11.0), (10.0, 11.0),
        ]
        self.assertEqual(len(points), len(expected))
        for actual, wanted in zip(points, expected):
            self.assertAlmostEqual(actual[0], wanted[0], places=14)
            self.assertAlmostEqual(actual[1], wanted[1], places=14)

    def test_sub_milliscalar_turn_arc_is_removed_by_library_epsilon(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (10, 0)), step('L', (10, 10)),
        ], offset=0.001, lead_mode=1)
        self.assertEqual(len(result.paths[0].records), 9)

    def test_closed_rectangle_has_closure_turn_and_overcut(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (10, 0)),
            step('L', (10, 10)), step('L', (0, 10)), step('Z'),
        ], offset=1.0, lead_mode=1)
        path = result.paths[0]
        self.assertTrue(path.closed)
        self.assertEqual(coordinates(path)[-2:], [(2.0, 0.0), (2.0, 0.0)])
        self.assertIn((1.0, 0.0), coordinates(path))
        self.assertGreater(len(path.records), 18)

    def test_closed_diagonal_overcut_uses_literal_extension_order(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (10, 10)),
            step('L', (10, 0)), step('Z'),
        ], offset=1.0, lead_mode=1)
        x, y = coordinates(result.paths[0])[-2]
        self.assertAlmostEqual(x, 2.0 ** 0.5, places=14)
        self.assertAlmostEqual(y, 2.0 ** 0.5, places=14)

    def test_direction_change_shifts_along_each_directed_segment(self):
        forward = offset_path([step('M', (0, 0)), step('L', (10, 0))],
                              offset=1.0, lead_mode=1)
        reverse = offset_path([step('M', (10, 0)), step('L', (0, 0))],
                              offset=1.0, lead_mode=1)
        self.assertEqual(coordinates(forward.paths[0]),
                         [(1.0, 0.0), (1.0, 0.0), (11.0, 0.0), (11.0, 0.0)])
        self.assertEqual(coordinates(reverse.paths[0]),
                         [(9.0, 0.0), (9.0, 0.0), (-1.0, 0.0), (-1.0, 0.0)])
        self.assertEqual(reverse.paths[0].final_angle, 180.0)

    def test_retained_angle_drives_next_subpath_lead_transition(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (10, 0)),
            step('M', (20, 0)), step('L', (20, 10)),
        ], offset=1.0)
        second = coordinates(result.paths[1])
        self.assertEqual(second[0], (21.0, 0.0))
        self.assertAlmostEqual(second[-3][0], 20.0, places=14)
        self.assertAlmostEqual(second[-3][1], 1.0, places=14)
        self.assertEqual(result.final_angle, -90.0)

    def test_retained_angle_rotates_later_closed_path_without_reversing_it(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (10, 0)),
            step('M', (20, 0)), step('L', (20, 10)),
            step('L', (30, 10)), step('L', (30, 0)), step('Z'),
        ], offset=1.0, lead_mode=1)
        second = result.paths[1]
        self.assertTrue(second.closed)
        self.assertEqual(coordinates(second)[:2], [(21.0, 10.0), (21.0, 10.0)])
        self.assertEqual(coordinates(second)[-2:], [(22.0, 10.0), (22.0, 10.0)])

    def test_explicit_coordinate_closure_matches_z_detection(self):
        explicit = offset_path([
            step('M', (0, 0)), step('L', (2, 0)),
            step('L', (2, 2)), step('L', (0, 0)),
        ], offset=0.0, lead_mode=1)
        self.assertTrue(explicit.paths[0].closed)

    def test_all_source_lead_modes_have_distinct_placement(self):
        source = [step('M', (0, 0)), step('L', (10, 0))]
        paths = [offset_path(source, offset=1.0, initial_angle=-90.0,
                             lead_mode=mode).paths[0] for mode in range(4)]
        self.assertAlmostEqual(coordinates(paths[0])[0][0], 0.0, places=14)
        self.assertEqual(coordinates(paths[0])[0][1], 1.0)
        self.assertEqual(coordinates(paths[1])[0], (1.0, 0.0))
        self.assertAlmostEqual(coordinates(paths[2])[0][0], 0.0, places=14)
        self.assertEqual(coordinates(paths[2])[0][1], 1.0)
        self.assertNotEqual(coordinates(paths[3])[0], (0.0, 1.0))
        self.assertGreater(len(paths[0].records), len(paths[2].records))
        self.assertGreater(len(paths[3].records), len(paths[1].records))

    def test_repeated_points_are_removed_and_degenerate_path_rejected(self):
        result = offset_path([
            step('M', (0, 0)), step('L', (0, 0)),
            step('L', (5, 0)), step('L', (5, 0)),
        ], offset=1.0, lead_mode=1)
        self.assertEqual(coordinates(result.paths[0]),
                         [(1.0, 0.0), (1.0, 0.0), (6.0, 0.0), (6.0, 0.0)])
        with self.assertRaisesRegex(ValueError, 'drawable'):
            offset_path([step('M', (1, 1)), step('L', (1, 1))])

    def test_cubic_subdivision_preserves_source_left_then_right_order(self):
        result = offset_path([
            step('M', (0, 0)), step('C', (0, 0), (0, 0), (1, 0)),
        ], offset=0.0, lead_mode=1)
        xs = [record.x for record in result.paths[0].records]
        self.assertEqual(xs, [0.0, 0.0, 0.015625, 0.244140625,
                              0.669921875, 1.0, 1.0])

    def test_cubic_close_is_flattened_then_overcut(self):
        result = offset_path([
            step('M', (0, 0)), step('C', (0, 3), (3, 3), (3, 0)), step('Z'),
        ], offset=1.0, lead_mode=1)
        path = result.paths[0]
        self.assertTrue(path.closed)
        self.assertGreater(len(path.records), 10)
        self.assertEqual(path.records[0].kind, 2)
        self.assertEqual(path.records[-1].kind, 2)

    def test_odd_options_are_rejected_instead_of_silently_zeroing_radius(self):
        with self.assertRaises(ValueError):
            offset_path([step('M', (0, 0)), step('L', (10, 0))],
                         offset=1.0, options_word=1, lead_mode=1)

    def test_input_and_resource_admission_fail_closed(self):
        valid = [step('M', (0, 0)), step('L', (10, 0))]
        bad_calls = [
            lambda: offset_path(valid, offset=-1),
            lambda: offset_path(valid, offset=73),
            lambda: offset_path(valid, offset=math.nan),
            lambda: offset_path(valid, options_word=True),
            lambda: offset_path(valid, lead_mode=4),
            lambda: offset_path(valid, initial_angle=361),
            lambda: offset_path([step('L', (1, 1))]),
            lambda: offset_path([step('M', (0, 0)), step('C', (1, 1))]),
            lambda: offset_path([step('M', (0, 0)), step('L', (math.inf, 0))]),
            lambda: offset_path(valid, max_source_records=1),
            lambda: offset_path(valid, max_output_records=3),
        ]
        for call in bad_calls:
            with self.subTest(call=repr(call)):
                with self.assertRaises(ValueError):
                    call()

        long_curve = [
            step('M', (0, 0)), step('C', (1000, 1000), (-1000, 1000), (0, 0)),
        ]
        with self.assertRaisesRegex(ValueError, 'budget'):
            offset_path(long_curve, max_output_records=20)

    def test_native_tool2_model12_uses_full_radius_and_zero_initial_angle(self):
        result = offset_path([step('M', (0, 0)), step('L', (10, 0))], lead_mode=1)
        self.assertEqual(coordinates(result.paths[0]),
                         [(1.133858323097229, 0.0)] * 2 +
                         [(11.133858323097229, 0.0)] * 2)
        self.assertEqual(result.paths[0].initial_angle, 0.0)

    def test_only_selected_tool_type_two_is_supported(self):
        for tool_type in (0, 1, 3, 12, 19):
            with self.subTest(tool_type=tool_type), self.assertRaises(ValueError):
                offset_path([step('M', (0, 0)), step('L', (10, 0))],
                            options_word=tool_type)

    def test_initial_angle_none_is_not_synthesized_from_first_segment(self):
        with self.assertRaises(ValueError):
            offset_path([step('M', (0, 0)), step('L', (0, 10))], initial_angle=None)

    def test_closed_direction_ignores_closing_edge_in_native_decision(self):
        # Native 333ea8 scans only i=0..n-3; the closing diagonal must not
        # make the reversed direction win. 333ff8 then keeps the full list.
        points = [(0.0, 0.0), (1.0, 1.0), (2.0, 0.0), (0.0, 0.0)]
        from joy_blade_geometry import _rotate_closed_for_angle
        self.assertEqual(_rotate_closed_for_angle(points, 0.0), points)

    def test_three_record_closed_path_rotates_to_matching_edge(self):
        # Native 333ff8 admits n=3. Direction comparison uses n-2 edges;
        # the subsequent rotation still considers both drawable edges.
        for angle, start, other in ((80.0, (0.0, 10.0), (0.0, 0.0)),
                                    (-80.0, (0.0, 0.0), (0.0, 10.0))):
            with self.subTest(initial_angle=angle):
                result = offset_path([step('M', (0, 0)), step('L', (0, 10)),
                                      step('Z')], offset=0.0,
                                     initial_angle=angle, lead_mode=1)
                self.assertTrue(result.paths[0].closed)
                self.assertEqual(coordinates(result.paths[0]),
                                 [start, start, other, start, start])

    def test_closed_first_path_can_reverse_to_minimize_angle_difference(self):
        result = offset_path([step('M', (0, 0)), step('L', (0, 10)),
                              step('L', (10, 10)), step('L', (0, 0)), step('Z')],
                             offset=0.0, initial_angle=180.0, lead_mode=1)
        self.assertTrue(result.paths[0].closed)
        self.assertEqual(coordinates(result.paths[0])[2], (0.0, 10.0))


if __name__ == '__main__':
    unittest.main()
