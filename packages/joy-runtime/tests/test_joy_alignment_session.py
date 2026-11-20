import unittest
from typing import Any
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from joy_measurement_experiment import BorrowerStreamState
from joy_alignment_session import run_post_measurement_alignment
from joy_protocol import clear_frame, request
class FakeSession:
    state='ready'
    def __init__(self):
        self.result=type('R',(),{'selector':8.164000001,'used_fallback':False})()
        self.channel: Any=None
class AlignmentTests(unittest.TestCase):
    def setup(self,replies):
        s=FakeSession(); b=BorrowerStreamState(); b._bound=True
        class Ch:
            def __init__(self): self.sent=[]; self.last=None
            def send(self,p,*,encrypted,timeout): self.sent.append((p,encrypted)); self.last=p
            def receive(self,timeout,*,require_encrypted):
                if self.last == request('status'): return clear_frame(bytes([0x60,0x60,1,0,0,0,0,0,0]))
                return replies.pop(0)
        s.channel=Ch(); return s,b
    def runit(self,s,b,**kw): return run_post_measurement_alignment(session=s,borrower_stream_state=b,
        material_present=lambda:True,motion_approved=True,blade_removed_confirmed=True,
        measurement_report={'outcome':'measurement_complete'},point_mode='scalar',context_byte_8=kw.pop('context_byte_8',0),**kw)
    def test_source_candidate_framed_and_acknowledged(self):
        ops=(0x21,0x42,0x42,0x22); replies=[clear_frame(bytes([0,o,1,2,3])) for o in ops]
        s,b=self.setup(replies); r=self.runit(s,b)
        self.assertEqual(r.accepted_requests,4); self.assertFalse(r.physical_alignment_verified)
        self.assertEqual(s.channel.sent[0][0],request('status')); self.assertTrue(all(e for _,e in s.channel.sent))
    def test_negative_ack_no_retry(self):
        s,b=self.setup([clear_frame(bytes([1,0x21,1,2,3,0x35,0]))])
        result = self.runit(s,b)
        self.assertEqual(result.outcome,'negative_ack_no_retry')
        self.assertEqual(result.negative_error_u8,0x35)
        self.assertEqual([packet[2] for packet,_ in s.channel.sent],[0x60,0x21])
        self.assertFalse(b._invalidated)
    def test_wrong_ack_tag_invalidates(self):
        s,b=self.setup([clear_frame(bytes([0,0x22,1,2,3]))])
        with self.assertRaises(ValueError): self.runit(s,b)
        self.assertTrue(b._invalidated)
    def test_context_one_rejected_pre_io(self):
        s,b=self.setup([])
        with self.assertRaises(ValueError): self.runit(s,b,context_byte_8=1)
        self.assertEqual(s.channel.sent,[])
if __name__=='__main__': unittest.main()
