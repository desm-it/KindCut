"""Selected factory status and captured moving-state regression, hardware-free."""
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
class SelectedStatusTests(unittest.TestCase):
    def project(self,payload,**kw):return importlib.import_module('joy_selected_status').project_selected_status(payload,**kw)
    def test_athena_override_preserves_native_extra_word_for_internal_model12(self):
        view=self.project(bytes.fromhex('606801123401020304'),context_byte_8=0)
        self.assertEqual(getattr(view,'native_extra_u16',None),0x1234)
        self.assertEqual(getattr(view,'native_model_10c',None),12)

    def test_alignment_status_bits_follow_both_native_getters(self):
        for b in range(256):
            body=bytes([0x60,b,1,0,0,0,0,0,0])
            view=self.project(body,context_byte_8=0)
            self.assertEqual(getattr(view,'native_slot_90',None),bool(b&32))
            self.assertEqual(getattr(view,'native_slot_98',None),bool(b&64))

    def test_lowbit_context_override_is_not_exact_one_rule(self):
        body=bytes.fromhex('600001000000000035')
        for mode in (0,1,2,3,255):
            opts={'host_counter_45a4d8':0,'host_flag_45a504':1} if mode==1 else {}
            view=self.project(body,context_byte_8=mode,**opts)
            self.assertEqual(getattr(view,'native_slot_90',None),bool(mode&1))
            self.assertEqual(getattr(view,'native_slot_98',None),bool(mode&1))

    def test_captured_measurement_snapshot_is_not_a_loaded_or_stopped_claim(self):
        # Exact status repeated during pass34 while EE result was increasing.
        view=self.project(bytes.fromhex('606801000000000000'),context_byte_8=0)
        self.assertEqual(getattr(view,'physical_state',None),'unverified')
        self.assertIs(getattr(view,'native_slot_90',None),True)
        self.assertIs(getattr(view,'native_slot_98',None),True)
        self.assertFalse(hasattr(view,'loaded_ready'))

    def test_malformed_body_context_and_missing_host_override_fail_closed(self):
        for body,mode in ((b'',0),(bytearray(9),0),(bytes.fromhex('606801000000000000'),True),(bytes.fromhex('606801000000000000'),1)):
            with self.assertRaises(ValueError):self.project(body,context_byte_8=mode)
if __name__=='__main__':unittest.main()
