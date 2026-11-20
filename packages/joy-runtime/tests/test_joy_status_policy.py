"""Synthetic source-normalized status/ACK bodies, never device captures or I/O."""
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
def status(a=0,b=1,error=0,tail=b''):
    return bytes([0x60,a,b,0x12,0x34])+error.to_bytes(4,'big')+tail
def negative_ack(b=0,error=1):
    return bytes([1,0x43,b,0,0,error,0xff])
class MachineStatusPolicyTests(unittest.TestCase):
    def codec(self):return importlib.import_module('joy_status_policy')

    def test_reuses_existing_status_parser_without_inventing_wire_format(self):
        r=self.codec().project_machine_status(status(0xaa,0x55,0x01020304,b'extension'),context_byte_8=0)
        self.assertEqual((r.raw_status_11,r.raw_status_12,r.raw_value_14),(0xaa,0x55,0x01020304))
        self.assertEqual(r.effective_error_u32,0x01020304)
        self.assertEqual(r.extension,b'extension')

    def test_ordinary_status_getters_match_bits_without_physical_state_labels(self):
        for a in range(256):
            for b in (0,1,2,255):
                r=self.codec().project_machine_status(status(a,b,0xffffffff),context_byte_8=0)
                self.assertEqual(r.native_slot_78,bool(a&4))
                self.assertEqual(r.native_slot_a8,bool(b&1))
                self.assertEqual(r.effective_error_u32,0xffffffff)

    def test_low_bit_error_suppression_differs_from_exact_one_host_override(self):
        c=self.codec()
        for mode in range(256):
            args={'host_counter_45a4d8':-1,'host_flag_45a504':0} if mode==1 else {}
            r=c.project_machine_status(status(4,1,0x12345678),context_byte_8=mode,**args)
            self.assertEqual(r.effective_error_u32,0 if mode&1 else 0x12345678)
            self.assertEqual(r.native_slot_78,mode!=1)
            self.assertEqual(r.native_slot_a8,mode!=1)

    def test_host_counter_is_signed_and_host_flag_uses_low_bit(self):
        for count in (-2**31,-1,0,1,2**31-1):
            for flag in (0,1,2,255):
                r=self.codec().project_machine_status(status(0,0,1),context_byte_8=1,
                    host_counter_45a4d8=count,host_flag_45a504=flag)
                self.assertEqual(r.native_slot_78,count>0)
                self.assertEqual(r.native_slot_a8,bool(flag&1))
                self.assertEqual(r.effective_error_u32,0)

    def test_execution_nonzero_is_not_an_ack_or_predicate_and_false_returns_f6_without_body(self):
        r=self.codec().negative_batch_branch(negative_ack(),None,status_call_returned_nonzero=False)
        self.assertEqual(r.native_return_u32,0xfffffff6)
        self.assertIsNone(r.status_projection)

    def test_ack_flag09_and_detail_b_bit5_take_direct_return_two_without_status(self):
        c=self.codec()
        r=c.negative_batch_branch(negative_ack(0x20,0x3c),None,status_call_returned_nonzero=False)
        self.assertEqual(r.native_return_u32,2)
        self.assertIsNone(r.status_projection)
        r=c.negative_batch_branch(negative_ack(0,0x3c),None,status_call_returned_nonzero=False)
        self.assertEqual(r.native_return_u32,0xfffffff6)

    def test_a8_and_78_precede_error_code_branches(self):
        c=self.codec()
        def branch(a,b,e):return c.negative_batch_branch(negative_ack(),status(a,b,e),
            status_call_returned_nonzero=True,context_byte_8=0).native_return_u32
        for e in (0,0x35,0x36,1,0xffffffff):
            self.assertEqual(branch(0,0,e),0xffffffe9)
            self.assertEqual(branch(4,1,e),2)
        self.assertEqual(branch(0,1,0x35),0xffffffd4)
        self.assertEqual(branch(0,1,0x36),0xffffffd4)
        self.assertEqual(branch(0,1,0x37),0xfffffff3)
        self.assertIsNone(branch(0,1,0),'None means further native command gates, NOT retry or success')

    def test_negative_branch_requires_negative_tag43_and_explicit_boolean_result(self):
        c=self.codec()
        for ack in (bytes.fromhex('00430501ff'),bytes.fromhex('014205010001ff'),b''):
            with self.assertRaises(ValueError):c.negative_batch_branch(ack,None,status_call_returned_nonzero=False)
        for result in (0,1,'yes',None):
            with self.assertRaises(ValueError):c.negative_batch_branch(negative_ack(),None,status_call_returned_nonzero=result)

    def test_projection_rejects_mutable_bad_shapes_and_missing_host_inputs(self):
        c=self.codec()
        for body in (b'',status()[:8],bytes([0x61])+status()[1:],bytearray(status()),status(tail=b'x'*512)):
            with self.assertRaises(ValueError):c.project_machine_status(body,context_byte_8=0)
        for mode in (True,False,-1,256,0.0,'0',None):
            with self.assertRaises(ValueError):c.project_machine_status(status(),context_byte_8=mode)
        with self.assertRaises(ValueError):c.project_machine_status(status(),context_byte_8=1)
        for count,flag in ((2**31,0),(-2**31-1,0),(True,0),(0,256),(0,True),(None,0)):
            with self.assertRaises(ValueError):c.project_machine_status(status(),context_byte_8=1,
                host_counter_45a4d8=count,host_flag_45a504=flag)

    def test_worker_does_not_add_status_policy_or_draw_execution_wiring(self):
        source=(Path(__file__).resolve().parents[1]/'runtime'/'worker.py').read_text()
        self.assertNotIn('joy_status_policy',source)
if __name__=='__main__':unittest.main()
