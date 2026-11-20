"""Real measured-scope/alignment/Go composition with an inert scripted peer."""
import importlib
import sys
import unittest
from typing import Any
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from test_joy_measurement_experiment import Session, Peer, Clock
api = importlib.import_module('joy_retained_loader')
frame = importlib.import_module('joy_protocol').clear_frame

class LoaderPeer(Peer):
    def __init__(self, clock):
        super().__init__(); self.clock=clock; self.ended=False; self.failure=None
        self.snapshot=None; self.bad=False; self.delay=False; self.lost=False
    def receive(self, timeout, *, require_encrypted):
        op=self.sent[-1][2]
        if op in (0x21,0x22,0x42,0x43):
            if op==0x22: self.ended=True
            return frame(bytes([0,op,0,0,56]))
        if op==0x60 and self.ended:
            if self.failure:
                self.snapshot=tuple(self.sent); raise self.failure
            if self.delay: self.clock.sleep(100)
            if self.bad:
                self.snapshot=tuple(self.sent); return frame(b'bad')
            return frame(bytes([0x60,0x60,int(not self.lost)])+bytes(6))
        return super().receive(timeout,require_encrypted=require_encrypted)

class CompositionTests(unittest.TestCase):
    def setup_peer(self):
        c=Clock(); s: Any=Session(); s.channel=LoaderPeer(c)
        return s,c,api.JoyRetainedLoader(s,exclusive_session=True)
    def opts(self,c,**kw):
        opts=dict(height_inches=12,host_go=lambda t:True,material_present=lambda:True,
                  motion_approved=True,blade_removed_confirmed=True,point_mode='scalar',
                  clock=c,sleep=c.sleep,timeout=30)
        opts.update(kw); return opts
    def held(self,s):
        self.assertEqual(s.state,'ready')
        self.assertFalse(any(p[2:] in (b'\x68\xff',b'\xed\x01') for p in s.channel.sent))
    def test_full_stage_callbacks_and_opt_in_indefinite_ready(self):
        s,c,loader=self.setup_peer(); stages=[]; calls=[]
        def go(t):
            calls.append(1)
            if len(calls) == 4: raise InterruptedError('cancel synthetic wait')
            return False
        options = self.opts(c, host_go=go)
        options.update(retain_ready=True, on_stage=stages.append)
        with self.assertRaises(InterruptedError):
            with loader.loaded_scope(**options):
                self.fail('must remain retained until cancellation')
        self.assertEqual(stages, ['waiting_for_mat','gripped','measuring_y','positioning','waiting_for_go'])
        self.assertEqual(len(calls),4)
        self.assertEqual(s.state,'closed')

    def test_actual_composition_holds_pending_go_and_caller_block(self):
        s,c,loader=self.setup_peer(); polls=[]
        def go(t):
            self.held(s); polls.append(sum(p[2]==0x60 for p in s.channel.sent)); c.sleep(.2)
            return len(polls)==3
        with loader.loaded_scope(**self.opts(c,host_go=go)) as result:
            self.held(s); self.assertEqual(result.outcome,'host_go_observed_no_job_started')
            self.assertFalse(result.physical_alignment_verified); self.assertTrue(s.channel.ended)
            self.assertLess(polls[0],polls[1]); self.assertLess(polls[1],polls[2])
        self.assertEqual(s.state,'closed')
        self.assertEqual(sum(p[2:]==b'\x68\xff' for p in s.channel.sent),1)
        self.assertEqual(sum(p[2:]==b'\xed\x01' for p in s.channel.sent),1)
        self.assertTrue(set(p[2] for p in s.channel.sent)<={0x11,0x79,0xed,0x60,0x30,0x31,0x3e,0xee,0x68,0x21,0x22,0x42})
    def test_material_loss_while_go_pending(self):
        s,c,loader=self.setup_peer(); calls=[]
        def go(t): calls.append(True); s.channel.lost=True; return False
        with self.assertRaisesRegex(RuntimeError,'material'):
            with loader.loaded_scope(**self.opts(c,host_go=go)): self.fail('yielded')
        self.assertEqual(len(calls),1); self.assertEqual(s.state,'closed')
    def test_uncertain_receive_closes_without_more_protocol(self):
        s,c,loader=self.setup_peer(); error=OSError('uncertain'); s.channel.failure=error
        with self.assertRaises(OSError) as caught:
            with loader.loaded_scope(**self.opts(c)): self.fail('yielded')
        self.assertIs(caught.exception,error); self.assertEqual(tuple(s.channel.sent),s.channel.snapshot)
        self.assertEqual(s.state,'closed')
    def test_late_malformed_reply_is_invalidated_before_timeout(self):
        s,c,loader=self.setup_peer(); s.channel.bad=True; s.channel.delay=True
        with self.assertRaises(ValueError):
            with loader.loaded_scope(**self.opts(c)): self.fail('yielded')
        self.assertEqual(tuple(s.channel.sent),s.channel.snapshot); self.assertEqual(s.state,'closed')
    def test_late_valid_reply_allows_bounded_cleanup(self):
        s,c,loader=self.setup_peer(); s.channel.delay=True
        with self.assertRaisesRegex(RuntimeError,'deadline'):
            with loader.loaded_scope(**self.opts(c)): self.fail('yielded')
        self.assertEqual(s.state,'closed'); self.assertTrue(any(p[2:]==b'\xed\x01' for p in s.channel.sent))
    def test_clock_exception_releases_owner_before_io(self):
        s,c,loader=self.setup_peer(); error=LookupError('clock')
        def broken(): raise error
        with self.assertRaises(LookupError) as caught:
            with loader.loaded_scope(**self.opts(c,clock=broken)): self.fail('yielded')
        self.assertIs(caught.exception,error); self.assertEqual(s.channel.sent,[])
        with loader.loaded_scope(**self.opts(c)): self.held(s)
    def test_caller_exception_identity_and_nested_owner_gate(self):
        s,c,loader=self.setup_peer(); error=LookupError('caller')
        with self.assertRaises(LookupError) as caught:
            with loader.loaded_scope(**self.opts(c)):
                before=tuple(s.channel.sent)
                with self.assertRaisesRegex(RuntimeError,'owned'):
                    with loader.loaded_scope(**self.opts(c)): self.fail('nested')
                self.assertEqual(tuple(s.channel.sent),before); raise error
        self.assertIs(caught.exception,error); self.assertEqual(s.state,'closed')

    def test_host_go_callback_deadline_is_checked_before_further_status_io(self):
        s,c,loader=self.setup_peer(); before=[]
        def go(t): before.extend(s.channel.sent); c.sleep(100); return True
        with self.assertRaisesRegex(RuntimeError,'deadline'):
            with loader.loaded_scope(**self.opts(c,host_go=go)): self.fail('yielded')
        self.assertEqual([p[2:] for p in s.channel.sent[len(before):]], [b'\x68\xff',b'\xed\x01'])

    def test_cancel_after_pending_go_keeps_healthy_cleanup(self):
        s,c,loader=self.setup_peer(); flag=[False]
        def go(t): flag[0]=True; return False
        with self.assertRaisesRegex(RuntimeError,'cancelled'):
            with loader.loaded_scope(**self.opts(c,host_go=go,cancelled=lambda:flag[0])): self.fail('yielded')
        self.assertEqual(s.state,'closed')
        self.assertEqual(s.channel.sent[-1][2:],b'\xed\x01')

    def test_pending_poll_budget_bounds_nonadvancing_clock(self):
        s,c,loader=self.setup_peer(); calls=[]; freeze=[False]
        def go(t): calls.append(True); freeze[0]=True; return False
        def controlled_sleep(t):
            if not freeze[0]: c.sleep(t)  # Legacy measurement requires a progressing clock.
        with self.assertRaisesRegex(RuntimeError,'deadline'):
            with loader.loaded_scope(**self.opts(c,host_go=go,sleep=controlled_sleep,max_go_polls=2)):
                self.fail('yielded')
        self.assertEqual(len(calls),2); self.assertEqual(s.state,'closed')

    def test_external_thread_cannot_enter_owned_manager(self):
        import threading
        s,c,loader=self.setup_peer(); errors=[]
        def enter():
            try:
                with loader.loaded_scope(**self.opts(c)): self.fail('concurrent lease')
            except RuntimeError as error: errors.append(error)
        with loader.loaded_scope(**self.opts(c)):
            before=tuple(s.channel.sent); worker=threading.Thread(target=enter)
            worker.start(); worker.join(2)
            self.assertFalse(worker.is_alive()); self.assertEqual(len(errors),1)
            self.assertEqual(tuple(s.channel.sent),before)

    def test_caller_can_invalidate_borrowed_stream_before_exception_cleanup(self):
        s,c,loader=self.setup_peer(); before=(); error=OSError('borrower I/O')
        with self.assertRaises(OSError) as caught:
            with loader.loaded_scope(**self.opts(c)) as result:
                result.borrower_stream_state.invalidate(); before=tuple(s.channel.sent); raise error
        self.assertIs(caught.exception,error)
        self.assertEqual(tuple(s.channel.sent),before); self.assertEqual(s.state,'closed')

    def test_presence_callback_latency_cannot_start_positioning(self):
        s,c,loader=self.setup_peer()
        def slow(): c.sleep(100); return True
        with self.assertRaisesRegex(RuntimeError,'deadline'):
            with loader.loaded_scope(**self.opts(c,material_present=slow)): self.fail('yielded')
        self.assertFalse(any(p[2] in (0x21,0x22,0x42,0x43) for p in s.channel.sent))
        self.assertEqual(s.state,'closed')

    def test_session_closed_during_go_callback_poisoned_before_cleanup(self):
        s,c,loader=self.setup_peer(); before=[]
        def go(t): s.state='closed'; before.extend(s.channel.sent); return False
        with self.assertRaises(ConnectionError):
            with loader.loaded_scope(**self.opts(c,host_go=go)): self.fail('yielded')
        self.assertEqual(s.channel.sent,before)

    def test_post_end_status_must_be_observed_before_go(self):
        s,c,loader=self.setup_peer(); original=s.channel.receive; observed=[]
        def receive(timeout,*,require_encrypted):
            if s.channel.ended and s.channel.sent[-1][2]==0x60 and len(observed)<3:
                observed.append(True)
                return frame(bytes([0x60,0x60 if len(observed)==3 else 0,1])+bytes(6))
            return original(timeout,require_encrypted=require_encrypted)
        s.channel.receive=receive
        def go(t): self.assertGreaterEqual(len(observed),3); return True
        with loader.loaded_scope(**self.opts(c,host_go=go)): self.held(s)
        self.assertEqual(len(observed),3)

if __name__=='__main__': unittest.main()
