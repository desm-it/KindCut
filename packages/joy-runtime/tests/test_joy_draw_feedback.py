"""Synthetic normalized feedback bodies; source policy, no native execution."""
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))

class DrawFeedbackTests(unittest.TestCase):
    def codec(self): return importlib.import_module('joy_draw_feedback')

    def test_ack_slots_are_opaque_bits_not_physical_state_labels(self):
        c = self.codec()
        for b in range(256):
            for v in (0, 1, 2, 3, 255):
                r = c.draw_feedback(bytes([0, 0x43, b, v, 23]), 0x43)
                self.assertTrue(r.acknowledged)
                self.assertEqual(r.reported_limit_byte, 23)
                self.assertEqual(r.native_b_bit5, bool(b & 0x20))
                self.assertEqual(r.native_b_bit6, bool(b & 0x40))
                self.assertEqual(r.native_c_bit1, bool(v & 2))
                self.assertIsNone(r.native_flag_0a)

    def test_positive_adaptation_clamps_report_to_one_then_configured_max(self):
        c = self.codec()
        for maximum in (1, 2, 56, 256, 1024):
            for reported in range(256):
                raw = bytes([0, 0x43, 5, 1, reported])
                self.assertEqual(c.next_batch_limit(raw, maximum), min(max(reported, 1), maximum))
        self.assertEqual(c.next_batch_limit(bytes.fromhex('00430501ff'), 56), 56)

    def test_feedback_does_not_relabel_native_negative_flags_or_retain_state(self):
        c = self.codec()
        negative = c.draw_feedback(bytes.fromhex('014300000035ff'), 0x43)
        self.assertFalse(negative.acknowledged)
        self.assertTrue(negative.native_flag_0a)
        positive = c.draw_feedback(bytes.fromhex('0043000000'), 0x43)
        self.assertIsNone(positive.native_flag_0a)

    def test_negative_ack_does_not_invent_retry_or_batch_adaptation(self):
        with self.assertRaisesRegex(ValueError, 'status|negative'):
            self.codec().next_batch_limit(bytes.fromhex('01430501013cff'), 56)

    def test_only_batch_tag_can_drive_the_batch_rule(self):
        c = self.codec()
        for opcode in (0x21, 0x22, 0x42):
            with self.assertRaises(ValueError): c.next_batch_limit(bytes([0, opcode, 5, 1, 12]), 56)

    def test_bad_maxima_and_malformed_bodies_fail_before_policy_output(self):
        c = self.codec()
        for maximum in (True, False, 0, -1, 1.0, 1025, None, '56', 10**100):
            with self.assertRaises(ValueError): c.next_batch_limit(bytes.fromhex('00430501ff'), maximum)
        for body in (b'', bytes.fromhex('00430501'), bytearray.fromhex('00430501ff'), bytes.fromhex('00430501ff00')):
            with self.assertRaises(ValueError): c.next_batch_limit(body, 56)

    def test_worker_does_not_import_feedback_or_enable_job_dispatch(self):
        source=(Path(__file__).resolve().parents[1]/'runtime'/'worker.py').read_text()
        self.assertNotIn('joy_draw_feedback',source)

if __name__ == '__main__': unittest.main()
