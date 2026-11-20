"""Source-derived inner bodies, NOT captured firmware packets or reply fixtures."""
import importlib
from pathlib import Path
import struct
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))

class DrawBodyCodecTests(unittest.TestCase):
    def codec(self):
        return importlib.import_module('joy_draw_codec')

    def test_begin_end_are_four_byte_source_bodies_without_transport_framing(self):
        c = self.codec()
        self.assertEqual(c.begin_draw_body(), bytes.fromhex('21000000'))
        self.assertEqual(c.end_draw_body(), bytes.fromhex('22000000'))

    def test_scalar_kind_is_raw_uint32_not_float_and_coordinates_divide_by_72(self):
        c = self.codec()
        self.assertEqual(c.scalar_draw_body(2, 288, 18), bytes.fromhex('4202000000000080400000803e'))
        self.assertEqual(c.scalar_draw_body(0x01020304, 72, -18), bytes.fromhex('42040302010000803f000080be'))

    def test_batch_uses_low8_kind_and_native_floats_without_scalar_division_or_count_byte(self):
        c = self.codec(); p = c.NativeBatchPoint(2, 288, 18)
        self.assertEqual(c.batch_draw_body([p]), bytes.fromhex('43020000904300009041'))
        q = c.NativeBatchPoint(3, -1, .5)
        self.assertEqual(c.batch_draw_body([p, q]), bytes.fromhex('43020000904300009041') + struct.pack('<Bff', 3, -1, .5))

    def test_scalar_rejects_bad_raw_kind_without_coercion_or_partial_output(self):
        for value in [True, -1, 2**32, 2.0, '2', None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.codec().scalar_draw_body(value, 0, 0)

    def test_coordinates_reject_nonfinite_boolean_overflow_and_unrepresentable_underflow(self):
        c = self.codec()
        for value in [True, float('nan'), float('inf'), -float('inf'), '1', None, 10**1000, 1e300, 1e-300]:
            with self.subTest(value=str(value)), self.assertRaises(ValueError):
                c.scalar_draw_body(2, value, 0)
            with self.subTest(batch=str(value)), self.assertRaises(ValueError):
                c.batch_draw_body([c.NativeBatchPoint(2, value, 0)])

    def test_batch_requires_bounded_plain_sequence_and_valid_records(self):
        c = self.codec(); p = c.NativeBatchPoint(2, 1, 1)
        for value in [[], None, 'abc', iter([p]), [None], [p, c.NativeBatchPoint(256, 1, 1)], [c.NativeBatchPoint(True, 1, 1)]]:
            with self.subTest(value=str(value)), self.assertRaises(ValueError):
                c.batch_draw_body(value)
        for limit in [True, 0, -1, 1025, 3.5, None]:
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                c.batch_draw_body([p], max_points=limit)
        with self.assertRaises(ValueError): c.batch_draw_body([p] * 57)
        self.assertEqual(len(c.batch_draw_body([p] * 56)), 1 + 9 * 56)
        self.assertEqual(len(c.batch_draw_body([p] * 57, max_points=64)), 1 + 9 * 57)

    def test_inert_codec_does_not_add_worker_draw_capabilities(self):
        # Structural boundary: the worker must not import/call this module. A
        # future executor requires independently recovered reply/lifecycle gates.
        source = (Path(__file__).resolve().parents[1] / 'runtime' / 'worker.py').read_text()
        self.assertNotIn('joy_draw_codec', source)

if __name__ == '__main__':
    unittest.main()
