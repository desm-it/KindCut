"""Inert deb90 path and post-End raw status predicate, NOT physical loading."""
import importlib
from pathlib import Path
import struct
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))

class AlignmentTests(unittest.TestCase):
    def module(self):return importlib.import_module('joy_alignment')
    def decide(self,payload=None,**kw):
        args={'continuation_permitted':True,'end_return_u32':1,'status_return_u32':1,'context_byte_8':0}
        args.update(kw)
        return self.module().alignment_wait_condition(b'\x60'+bytes(8) if payload is None else payload,**args)
    def test_batch_candidate_has_one_begin_two_kind2_points_and_one_end(self):
        p=self.module().build_alignment_candidate(point_mode='batch')
        expected=b'\x43'+(b'\x02'+struct.pack('<ff',4,.25))*2
        self.assertEqual(getattr(p,'bodies',None),(b'\x21\x00\x00\x00',expected,b'\x22\x00\x00\x00'))
        self.assertEqual(getattr(p,'parser_selector',None),1)
        self.assertEqual(getattr(p,'parser_options_word',None),2)
        self.assertEqual(getattr(p,'execution',None),'unsupported')
    def test_scalar_candidate_encodes_u32_kind2_and_divides_internal72_once(self):
        p=self.module().build_alignment_candidate(point_mode='scalar')
        body=b'\x42'+struct.pack('<Iff',2,4,.25)
        self.assertEqual(getattr(p,'bodies',None),(b'\x21\x00\x00\x00',body,body,b'\x22\x00\x00\x00'))
    def test_explicit_point_mode_not_inferred_from_model_or_default(self):
        for v in (True,1,None,'auto','batch56'):
            with self.assertRaises(ValueError):self.module().build_alignment_candidate(point_mode=v)
    def test_raw_wait_truth_table(self):
        for b in range(256):
            p=self.decide(bytes([0x60,b,0])+bytes(6))
            expected='condition_met' if (b&0x20 and b&0x40) or b&4 else 'refresh_status'
            self.assertEqual(getattr(p,'action',None),expected)
            self.assertIs(getattr(p,'physical_alignment_verified',None),False)
    def test_advancing_measurement_snapshot_can_pass_raw_condition_without_loading_proof(self):
        p=self.decide(bytes.fromhex('606801000000000000'))
        self.assertEqual(getattr(p,'action',None),'condition_met')
        self.assertIs(getattr(p,'physical_alignment_verified',None),False)
    def test_cancel_and_call_failures_do_not_promote_condition(self):
        raw=bytes.fromhex('606801000000000000')
        p=self.decide(raw,continuation_permitted=False)
        self.assertEqual(getattr(p,'action',None),'continuation_stopped')
        p=self.decide(raw,end_return_u32=0)
        self.assertEqual(getattr(p,'native_return_u32',None),0xfffffff3)
        p=self.decide(raw,end_return_u32=0,status_return_u32=0)
        self.assertEqual(getattr(p,'native_return_u32',None),0xfffffff6)
    def test_raw_call_return_bits_are_not_coerced_to_nonzero_booleans(self):
        p=self.decide(bytes.fromhex('606801000000000000'),end_return_u32=2,status_return_u32=2)
        self.assertEqual(getattr(p,'action',None),'native_wait_skipped')
        self.assertEqual(getattr(p,'native_return_u32',None),1)
        for k in ('end_return_u32','status_return_u32'):
            with self.assertRaises(ValueError):self.decide(**{k:True})

    def test_strict_results_and_context(self):
        for key in ('continuation_permitted',):
            with self.assertRaises(ValueError):self.decide(**{key:1})
        with self.assertRaises(ValueError):self.decide(context_byte_8=True)
        with self.assertRaises(ValueError):self.decide(context_byte_8=1)
        with self.assertRaises(ValueError):self.decide(b'\x60')
if __name__=='__main__':unittest.main()
