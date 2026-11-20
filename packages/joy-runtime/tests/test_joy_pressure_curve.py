"""Source-derived, hardware-free calibration-curve arithmetic tests."""
from importlib import import_module
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
interpolate = import_module('joy_pressure_curve').interpolate_pressure_counts


class PressureCurveTests(unittest.TestCase):
    def test_exact_endpoints_and_outside_clamping(self):
        points = ((10, 100), (20, 200))
        for requested, expected in ((0, 100), (10, 100), (20, 200),
                                     (21, 200), (65535, 200)):
            with self.subTest(requested=requested):
                self.assertEqual(interpolate(requested, points), expected)

    def test_native_interpolation_truncates_instead_of_rounding(self):
        self.assertEqual(interpolate(1, ((0, 1), (10, 2))), 1)
        self.assertEqual(interpolate(15, ((10, 100), (20, 200))), 150)
        self.assertEqual(interpolate(15, ((10, 100), (20, 0))), 50)

    def test_zero_after_prior_sample_uses_native_prior_value_fallback(self):
        points = ((10, 100), (20, 0))
        self.assertEqual(interpolate(20, points), 100)
        self.assertEqual(interpolate(21, points), 0)
        self.assertEqual(interpolate(0, ((10, 0), (20, 100))), 0)

    def test_single_sample_and_input_immutability(self):
        points = [[10, 500]]
        self.assertEqual(interpolate(0, points), 500)
        self.assertEqual(interpolate(65535, points), 500)
        self.assertEqual(points, [[10, 500]])

    def test_strict_local_input_and_resource_admission(self):
        invalid_requests = (True, -1, 65536, 1.0, float('nan'), '10', 10**1000)
        for requested in invalid_requests:
            with self.subTest(requested=repr(requested)), self.assertRaises(ValueError):
                interpolate(requested, ((0, 0), (100, 200)))
        bad_points = (None, (), 'bad', iter(((0, 1),)), ((0,),),
                      ((False, 1),), ((0, True),), ((-1, 0),), ((0, 65536),),
                      ((0.0, 1),), ((0, 1), (0, 2)), ((10, 1), (0, 2)),
                      tuple((i, i) for i in range(4097)))
        for points in bad_points:
            with self.subTest(points=repr(points)[:80]), self.assertRaises(ValueError):
                interpolate(10, points)


if __name__ == '__main__':
    unittest.main()
