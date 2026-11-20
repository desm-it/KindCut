"""Synthetic wire-body fixtures, never captured device calibration data."""
from fractions import Fraction
from importlib import import_module
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
codec = import_module('joy_pressure_table')


def body(index, pressure, counts, opaque=0x7fc00000):
    return struct.pack('>BHII', 0xa0, index, opaque, (pressure << 16) | counts)


def table():
    return tuple(body(index, index * 10, index * 2) for index in range(1, 17))


class PressureTableTests(unittest.TestCase):
    def test_fixed_sixteen_read_bodies_use_property_ids_not_factory_selector(self):
        reads = codec.pressure_table_request_bodies()
        self.assertEqual(type(reads), tuple)
        self.assertEqual(reads, tuple(struct.pack('>BH', 0xa0, i)
                                     for i in range(1, 17)))
        self.assertEqual(reads[0], b'\xa0\x00\x01')
        self.assertEqual(reads[-1], b'\xa0\x00\x10')

    def test_second_word_is_packed_uint32_not_first_word_or_float(self):
        entry = codec.decode_pressure_entry(1, body(1, 0xb4, 0x23))
        self.assertEqual((entry.index, entry.pressure_native, entry.position_counts,
                          entry.opaque_first_word), (1, 0xb4, 0x23, 0x7fc00000))
        maximum = codec.decode_pressure_entry(16, body(16, 65535, 65535))
        self.assertEqual((maximum.pressure_native, maximum.position_counts),
                         (65535, 65535))
        with self.assertRaises((AttributeError, TypeError)):
            entry.position_counts = 0

    def test_reply_correlation_and_local_exact_length_fail_closed(self):
        valid = body(1, 10, 20)
        for index, payload in ((True, valid), (0, valid), (17, valid),
                               (1.0, valid), (1, None), (1, bytearray(valid)),
                               (1, valid[:-1]), (1, valid + b'\0'),
                               (1, b'\xa1' + valid[1:]), (2, valid)):
            with self.subTest(index=index, payload=repr(payload)), self.assertRaises(ValueError):
                codec.decode_pressure_entry(index, payload)

    def test_table_requires_all_sixteen_correlated_responses_in_index_order(self):
        rows = codec.decode_pressure_table(table())
        self.assertEqual(type(rows), tuple)
        self.assertEqual(tuple(row.index for row in rows), tuple(range(1, 17)))
        invalid = (None, (), table()[:-1], table() + (table()[0],),
                   tuple(reversed(table())), (table()[0],) * 16)
        for payloads in invalid:
            with self.subTest(payloads=repr(payloads)[:80]), self.assertRaises(ValueError):
                codec.decode_pressure_table(payloads)

    def test_decoder_preserves_raw_rows_instead_of_sorting_or_dropping_zeroes(self):
        payloads = tuple(body(i, 0, 0) for i in range(1, 17))
        rows = codec.decode_pressure_table(payloads)
        self.assertEqual(len(rows), 16)
        self.assertTrue(all(row.pressure_native == row.position_counts == 0 for row in rows))
        # Raw decode is not permission to use a curve rejected by stricter math admission.
        with self.assertRaises(ValueError):
            codec.pressure_counts_from_responses(10, payloads)

    def test_actual_decoder_composes_with_reviewed_interpolator(self):
        expected = int(Fraction(25) * Fraction(2, 10))
        self.assertEqual(codec.pressure_counts_from_responses(25, table()), expected)
        self.assertEqual(codec.pressure_counts_from_responses(50, table()), 5 * 2)
        with self.assertRaises(ValueError):
            codec.pressure_counts_from_responses(25, table()[:-1])


if __name__ == '__main__':
    unittest.main()
