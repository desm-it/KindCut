"""Source-derived affine equation tests; not physical calibration validation."""
import importlib
from pathlib import Path
import math
from decimal import getcontext, ROUND_FLOOR
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))


class CoordinateConfigTests(unittest.TestCase):
    def module(self):
        return importlib.import_module('joy_coordinate_config')

    def test_affine_uses_native_coefficient_order_and_translation_after_fma(self):
        m = self.module()
        transform = m.AffineTransform((2.0, 3.0, 5.0, 7.0, 11.0, 13.0))
        self.assertEqual(transform.apply((17.0, 19.0)), (140.0, 197.0))

    def test_identity_and_translation(self):
        m = self.module()
        self.assertEqual(m.AffineTransform((1, 0, 0, 1, 0, 0)).apply((4, -2)), (4.0, -2.0))
        self.assertEqual(m.AffineTransform((1, 0, 0, 1, 26, -9)).apply((4, -2)), (30.0, -11.0))

    def test_coefficients_and_points_require_finite_builtin_numbers_and_exact_shapes(self):
        m = self.module()
        for coefficients in ((1, 2, 3, 4, 5), (1, 2, 3, 4, 5, 6, 7), (True, 0, 0, 1, 0, 0),
                             (1, 0, 0, 1, 0, float('nan')), (1, 0, 0, 1, 0, float('inf')), (10**1000, 0, 0, 1, 0, 0)):
            with self.subTest(coefficients=repr(coefficients[:2])):
                with self.assertRaises(ValueError): m.AffineTransform(coefficients)
        identity = m.AffineTransform((1, 0, 0, 1, 0, 0))
        for point in ((1,), (1, 2, 3), (True, 0), (float('inf'), 0), (float('nan'), 0), (10**1000, 0), '12'):
            with self.subTest(point=repr(point)):
                with self.assertRaises(ValueError): identity.apply(point)

    def test_overflowing_result_is_rejected(self):
        m = self.module()
        transform = m.AffineTransform((1e308, 0, 0, 1, 0, 0))
        with self.assertRaises(ValueError): transform.apply((1e308, 0))

    def test_signed_zero_and_input_immutability(self):
        m = self.module()
        point = (-0.0, 0.0)
        result = m.AffineTransform((1, 0, 0, 1, 0, 0)).apply(point)
        self.assertEqual(math.copysign(1.0, result[0]), 1.0)  # translation +0 follows native addition
        self.assertEqual(point, (-0.0, 0.0))

    def test_fused_rounding_survives_cancellation(self):
        m = self.module()
        x = float.fromhex("0x1.0000000000001p+0")
        y = float.fromhex("0x1.fffffffffffffp-1")
        self.assertEqual(m.AffineTransform((x, 0, -1, 1, 0, 0)).apply((y, 1))[0],
                         float.fromhex("0x1.ffffffffffffep-54"))

    def test_fma_fallback_is_independent_of_decimal_global_rounding(self):
        m = self.module()
        old = getcontext().rounding
        try:
            getcontext().rounding = ROUND_FLOOR
            got = m._fma(1.0, -0.0, 0.0)
        finally:
            getcontext().rounding = old
        self.assertEqual(math.copysign(1.0, got), 1.0)

    def test_fallback_ignores_hostile_decimal_exponents_and_traps(self):
        from decimal import localcontext
        from types import SimpleNamespace
        from unittest.mock import patch
        m = self.module()
        fallback_math = SimpleNamespace(**{k: v for k, v in vars(math).items() if k != 'fma'})
        with patch.object(m, 'math', fallback_math), localcontext() as context:
            context.Emax, context.Emin, context.prec = 9, -9, 2
            for signal in context.traps:
                context.traps[signal] = True
            self.assertEqual(m._fma(1e100, 1.0, 0.0), 1e100)
            self.assertEqual(m._fma(float.fromhex('0x0.0000000000001p-1022'),
                                    float.fromhex('0x0.0000000000001p-1022'),
                                    sys.float_info.max), sys.float_info.max)
            self.assertEqual((context.Emax, context.Emin, context.prec), (9, -9, 2))

    def test_subnormal_fma_and_coefficient_input_copy(self):
        m = self.module()
        smallest = float.fromhex("0x0.0000000000001p-1022")
        self.assertEqual(m._fma(smallest, 1.0, 0.0), smallest)
        self.assertEqual(math.copysign(1.0, m._fma(1.0, -0.0, -0.0)), -1.0)
        coefficients = [1, 0, 0, 1, 0, 0]
        transform = m.AffineTransform(coefficients)
        coefficients[0] = 99
        self.assertEqual(transform.apply((2, 3)), (2.0, 3.0))


if __name__ == '__main__':
    unittest.main()
