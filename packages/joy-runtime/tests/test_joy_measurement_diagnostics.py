"""Behavior-level diagnostics tests over the inert synthetic measurement peer."""
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runtime'));sys.path.insert(0,str(ROOT/'tests'))
from test_joy_measurement_experiment import Session, Clock
from joy_measurement_experiment import measured_session_scope, MeasurementScopeFailed
from joy_loading_diagnostics import LoadingDiagnostics, on_diagnostic

class DiagnosticPeerTests(unittest.TestCase):
    def opts(self,s,clock,**kw):
        return dict(session=s,height_inches=12,motion_approved=True,blade_removed_confirmed=True,
                    clock=clock,sleep=clock.sleep,hold_ready_seconds=0,**kw)
    def test_malformed_reply_is_captured_before_validation_and_cleanup(self):
        s=Session(malformed=True); c=Clock(); d=LoadingDiagnostics(1)
        with self.assertRaises(MeasurementScopeFailed):
            with measured_session_scope(**self.opts(s,c,on_diagnostic=on_diagnostic(d))): pass
        snap=d.snapshot(); events=snap['events']
        self.assertIn(snap['failure']['stage'],('query_precheck','polling_measurement'))
        query=[e for e in events if e['stage']=='query_precheck' and e['txHex']]
        self.assertTrue(query)
        self.assertTrue(any(e['kind']=='cleanup' and e['stage']=='closing' for e in events))
        self.assertTrue(any(e['stage']=='aborting' for e in events))
    def test_semantic_failure_retains_last_query_frame_and_callback_fault_does_not_change_wire(self):
        class BadSemantic(Session):
            def __init__(self):
                super().__init__()
                receive=self.channel.receive
                def altered(timeout,*,require_encrypted):
                    frame=receive(timeout,require_encrypted=require_encrypted)
                    if self.channel.sent[-1][2]==0xee and self.channel.sent[-1][3:]==bytes(4):
                        from joy_protocol import clear_frame
                        return clear_frame(bytes.fromhex('ee0000000000'))
                    return frame
                self.channel.receive=altered
        a=BadSemantic(); b=BadSemantic(); ca=Clock(); cb=Clock(); rec=LoadingDiagnostics(2)
        def raises(*a,**k): raise RuntimeError('observer private secret')
        for s,c,obs in ((a,ca,None),(b,cb,raises)):
            try:
                with measured_session_scope(**self.opts(s,c,on_diagnostic=obs)): pass
            except MeasurementScopeFailed: pass
        self.assertEqual(a.channel.sent,b.channel.sent)
    def test_measurement_capture_callback_exception_is_nonfatal_and_marked_incomplete(self):
        s=Session(); c=Clock()
        def raises(*a,**k): raise RuntimeError('must not escape')
        with measured_session_scope(**self.opts(s,c,on_diagnostic=raises)) as report:
            self.assertTrue(report['captureIncomplete'])
        self.assertEqual(s.state,'closed')
    def test_send_failure_and_cleanup_failures_are_recorded_without_secret_text(self):
        s=Session(fail=0x31); c=Clock(); d=LoadingDiagnostics(3)
        with self.assertRaises(MeasurementScopeFailed):
            with measured_session_scope(**self.opts(s,c,on_diagnostic=on_diagnostic(d))): pass
        snap=d.snapshot()
        self.assertIsNotNone(snap['failure'])
        self.assertNotIn('synthetic transport failure',repr(snap))
        self.assertTrue(any(e['kind']=='io_error' for e in snap['events']))
        self.assertTrue(any(e['stage']=='closing' for e in snap['events']))

if __name__=='__main__': unittest.main()
