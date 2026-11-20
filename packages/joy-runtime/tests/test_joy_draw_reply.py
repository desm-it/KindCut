"""Synthetic normalized ACK payloads from helper source, not device captures."""
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))

class DrawReplyTests(unittest.TestCase):
    def parser(self):
        return importlib.import_module('joy_draw_reply').parse_draw_ack_body

    def test_all_four_selected_draw_callbacks_share_positive_five_byte_contract(self):
        for opcode in [0x21, 0x22, 0x42, 0x43]:
            with self.subTest(opcode=opcode):
                raw = bytes([0, opcode, 0x85, 1, 0xff]); r = self.parser()(raw, opcode)
                self.assertTrue(r.acknowledged)
                self.assertEqual((r.opcode, r.detail_0b, r.detail_0c, r.detail_0e), (opcode, 0x85, 1, 0xff))
                self.assertEqual(r.error_0d, 0)
                self.assertFalse(r.native_flag_09)
                self.assertIsNone(r.native_flag_0a, 'positive branch does not write this stateful helper flag')
                self.assertEqual(r.raw_payload, raw)

    def test_seven_and_eight_byte_negative_payloads_preserve_fields_without_claiming_completion(self):
        for tail in [b'\xff', b'\x12\x34']:
            raw = b'\x01\x43\x05\x06\x07\x3c' + tail
            r = self.parser()(raw, 0x43)
            self.assertFalse(r.acknowledged)
            self.assertEqual((r.detail_0b, r.detail_0c, r.detail_0e, r.error_0d), (5, 6, 7, 0x3c))
            self.assertTrue(r.native_flag_09)
            self.assertFalse(r.native_flag_0a)
            self.assertEqual(r.raw_payload, raw)

    def test_assembly_unsigned_guard_sets_flag_only_for_four_error_bytes(self):
        for error in range(256):
            r = self.parser()(bytes([1, 0x42, 0, 0, 0, error, 0xff]), 0x42)
            self.assertEqual(r.native_flag_09, error == 0x3c)
            self.assertEqual(r.native_flag_0a, error in (0x35, 0x36, 0x54, 0x55))

    def test_body_fields_are_opaque_not_assumed_length_or_terminator_bytes(self):
        r = self.parser()(bytes.fromhex('0021000000'), 0x21)
        self.assertTrue(r.acknowledged)
        self.assertEqual(r.detail_0e, 0)

    def test_mismatched_opcodes_invalid_shapes_and_prefixes_fail_closed(self):
        bad = [b'', b'\x00', bytes.fromhex('00220501ff'), bytes.fromhex('00210501'),
               bytes.fromhex('00210501ff00'), bytes.fromhex('01210501ff'),
               bytes.fromhex('012105010203040506'), bytes.fromhex('02210501ff'),
               bytes.fromhex('00210501020304')]
        for raw in bad:
            with self.subTest(raw=raw.hex()), self.assertRaises(ValueError): self.parser()(raw, 0x21)

    def test_mutable_nonbytes_and_unproven_expected_tags_are_rejected(self):
        for raw in [bytearray.fromhex('00210501ff'), memoryview(b'abc'), None, '00210501ff']:
            with self.assertRaises(ValueError): self.parser()(raw, 0x21)
        for opcode in [True, 33.0, -1, 256, 0xee, '33', None]:
            with self.assertRaises(ValueError): self.parser()(bytes.fromhex('00210501ff'), opcode)

    def test_stateless_parser_does_not_retain_negative_error_flags_for_later_positive_body(self):
        parse = self.parser()
        negative = parse(bytes.fromhex('014200000035ff'), 0x42)
        positive = parse(bytes.fromhex('00420501ff'), 0x42)
        self.assertTrue(negative.native_flag_0a)
        self.assertIsNone(positive.native_flag_0a)

    def test_worker_has_no_reply_or_job_execution_wiring(self):
        source = (Path(__file__).resolve().parents[1] / 'runtime' / 'worker.py').read_text()
        self.assertNotIn('joy_draw_reply', source)

if __name__ == '__main__': unittest.main()
