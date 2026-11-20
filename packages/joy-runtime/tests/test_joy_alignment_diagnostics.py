"""Inert SDK diagnostics assertions; NOT captured Joy traffic."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
import test_joy_alignment_session as fixtures
clear_frame=fixtures.clear_frame

class AlignmentDiagnosticTests(unittest.TestCase):
    def setup(self,wrong=False):
        f=fixtures.AlignmentTests();ops=(0x21,0x42,0x42,0x22)
        replies=[clear_frame(bytes([0,op,1,2,3])) for op in ops]
        if wrong: replies[0]=clear_frame(bytes([0,0x22,1,2,3]))
        s,b=f.setup(replies);return f,s,b
    def test_every_alignment_request_and_as_received_reply_is_observed_before_parse(self):
        f,s,b=self.setup();seen=[]
        def observe(stage,tx=None,rx=None,error=None,**meta):seen.append((stage,tx,rx,error,meta))
        result=f.runit(s,b,on_diagnostic=observe)
        captured=[e for e in seen if e[4].get('kind')=='exchange']
        self.assertEqual([e[1] for e in captured],[p for p,_ in s.channel.sent])
        self.assertTrue(all(type(e[2]) is bytes and e[4].get('started') is not None for e in captured))
        self.assertEqual(result.accepted_requests,4)
    def test_bad_tag_retains_raw_reply_and_first_failure_without_retry(self):
        f,s,b=self.setup(wrong=True);seen=[]
        def observe(stage,tx=None,rx=None,error=None,**meta):seen.append((stage,tx,rx,error,meta))
        with self.assertRaises(ValueError):f.runit(s,b,on_diagnostic=observe)
        self.assertTrue(b._invalidated)
        self.assertEqual([p[2] for p,_ in s.channel.sent],[0x60,0x21])
        self.assertTrue(any(e[2]==clear_frame(bytes([0,0x22,1,2,3])) for e in seen))
        self.assertTrue(any(e[4].get('kind')=='failure' and isinstance(e[3],ValueError) for e in seen))
    def test_send_failure_keeps_attempt_and_no_reply(self):
        f,s,b=self.setup();seen=[]
        def broken(*a,**kw):raise OSError('NEVER_SERIALIZE_THIS')
        s.channel.send=broken
        def observe(stage,tx=None,rx=None,error=None,**meta):seen.append((stage,tx,rx,error,meta))
        with self.assertRaises(OSError):f.runit(s,b,on_diagnostic=observe)
        self.assertTrue(any(e[1] is not None and e[2] is None and e[4].get('code')=='send_failed' for e in seen))
    def test_observer_exception_does_not_change_the_wire_or_poison_a_valid_scope(self):
        f,a,ba=self.setup();f.runit(a,ba);f,b,bb=self.setup()
        def broken(*args,**kwargs):raise RuntimeError('observer bug')
        f.runit(b,bb,on_diagnostic=broken)
        self.assertEqual(a.channel.sent,b.channel.sent)
        self.assertFalse(bb._invalidated)
if __name__=='__main__':unittest.main()
