"""Source-sized synthetic property replies; no device or height validation."""
from pathlib import Path
import math
import importlib
import struct
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
calibration_module = importlib.import_module('joy_tool_calibration')
axis_scale_request_body = calibration_module.axis_scale_request_body
decode_axis_scale_response_body = calibration_module.decode_axis_scale_response_body
position_word_from_mm = calibration_module.position_word_from_mm
mm_from_native_position = calibration_module.mm_from_native_position
JoyAxisCalibration = calibration_module.JoyAxisCalibration


def reply(first=7.0, scale=254.0, property_id=0x9b):
    return b'\xa0'+struct.pack('>Hff', property_id, first, scale)


class ToolCalibrationTests(unittest.TestCase):
    def test_fixed_read_request_and_big_endian_correlated_response(self):
        self.assertEqual(axis_scale_request_body(), b'\xa0\x00\x9b')
        c = decode_axis_scale_response_body(reply())
        self.assertEqual((c.first_native_f32, c.axis_scale_f32), (7.0, 254.0))

    def test_rejects_wrong_shape_tag_property_or_nonpositive_scale(self):
        for raw in (b'', reply()[:-1], reply()+b'\0', bytearray(reply()),
                    b'\x00'+reply()[1:], reply(property_id=0xa3), reply(scale=0),
                    reply(scale=-1), reply(scale=math.inf), reply(scale=math.nan), reply(first=math.nan)):
            with self.subTest(raw=repr(raw)):
                with self.assertRaises(ValueError): decode_axis_scale_response_body(raw)

    def test_explicit_calibration_and_forward_inverse_formulas(self):
        c = decode_axis_scale_response_body(reply())
        self.assertEqual(position_word_from_mm(25.4, c), 254)
        self.assertEqual(position_word_from_mm(0, c), 0)
        self.assertEqual(mm_from_native_position(254, c), 25.4)
        self.assertEqual(mm_from_native_position(0, c), 0.0)

    def test_half_steps_round_by_native_plus_half_then_truncate(self):
        c = decode_axis_scale_response_body(reply(scale=25.4))
        self.assertEqual(position_word_from_mm(0.5, c), 1)
        self.assertEqual(position_word_from_mm(1.5, c), 2)
        self.assertEqual(position_word_from_mm(2.5, c), 3)

    def test_no_forged_invalid_calibration(self):
        for c in (None, {}, JoyAxisCalibration(0, 0), JoyAxisCalibration(0, math.inf),
                  JoyAxisCalibration(0, True), JoyAxisCalibration(math.nan, 1)):
            with self.subTest(calibration=repr(c)):
                with self.assertRaises(ValueError): position_word_from_mm(1, c)

    def test_binary32_rounding_ties_subnormals_and_avoids_double_rounding(self):
        from fractions import Fraction
        r = calibration_module._positive_fraction_to_f32
        self.assertEqual(r(Fraction(1, 1 << 150)), 0.0)
        self.assertEqual(r(Fraction(3, 1 << 150)), float.fromhex('0x0.000004p-126'))
        midpoint = Fraction(1) + Fraction(1, 1 << 24)
        self.assertEqual(r(midpoint), 1.0)
        self.assertEqual(r(midpoint + Fraction(1, 1 << 80)), float.fromhex('0x1.000002p0'))
        self.assertEqual(r(Fraction.from_float(float.fromhex('0x1.fffffep127'))),
                         float.fromhex('0x1.fffffep127'))
        with self.assertRaises(ValueError): r(Fraction(1 << 128))

    def test_numeric_admission_and_wire_word_limit(self):
        c = decode_axis_scale_response_body(reply())
        for mm in (True, -1, math.inf, math.nan, 10**1000, '1', 1e9):
            with self.subTest(mm=repr(mm)):
                with self.assertRaises(ValueError): position_word_from_mm(mm, c)
        for value in (True, -1, math.nan, 1.5, 65536, '1'):
            with self.subTest(value=repr(value)):
                with self.assertRaises(ValueError): mm_from_native_position(value, c)


if __name__ == '__main__': unittest.main()
