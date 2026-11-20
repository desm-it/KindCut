"""Independent phase fault matrix. Every query reply below is SYNTHETIC.
Only the default start ACK is copied exactly from the pass31 captured record.
No hardware, imports of vendor runtimes, or discovery.
"""
import math
import struct
import unittest
from test_joy_measurement_experiment import Clock, Peer, Session, clear_frame
from joy_measurement_experiment import run_measurement_experiment


def typed(length:float=0, raw_state=0, prefix=0xee):
    return bytes([prefix, int(raw_state)]) + struct.pack('>f', length)


class StrictClock(Clock):
    def sleep(self, seconds):
        assert math.isfinite(seconds) and seconds >= 0, 'Invalid phase sleep'
        super().sleep(seconds)


class PhasePeer(Peer):
    def __init__(self, *, precheck=None, progress=None, start_reply=None):
        super().__init__()
        self.precheck = list(precheck or [typed()])
        self.progress = list(progress or [typed(12)])
        self.start_reply = bytes.fromhex('00ee8501ff') if start_reply is None else start_reply
        self.started = False
        self.queries_after_start = 0
        self.receive_status_delay = lambda: None

    def receive(self, timeout, *, require_encrypted):
        packet = self.sent[-1][2:]
        if packet[0] == 0xee:
            if packet[1:] != bytes(4):
                self.started = True
                return clear_frame(self.start_reply)
            sequence = self.progress if self.started else self.precheck
            if self.started:
                self.queries_after_start += 1
            return clear_frame(sequence.pop(0) if len(sequence) > 1 else sequence[0])
        if packet[0] == 0x60:
            self.receive_status_delay()
        return super().receive(timeout, require_encrypted=require_encrypted)


class MeasurementPhaseFaultTests(unittest.TestCase):
    def run_case(self, peer=None, **kwargs):
        s = Session(); s.channel = PhasePeer() if peer is None else peer
        c = StrictClock()
        options = dict(motion_approved=True, blade_removed_confirmed=True,
                       clock=c, sleep=c.sleep, hold_ready_seconds=0)
        options.update(kwargs)
        report = run_measurement_experiment(s, 12, **options)
        return report, s, c

    def starts(self, session):
        return [p for p in session.channel.sent if p[2] == 0xee and p[3:] != bytes(4)]

    def test_lost_mat_after_raw_state_precheck_cannot_start_motion(self):
        p = PhasePeer(precheck=[typed(0, True), typed(0)])
        p.statuses = iter([0, 1, 0])
        r,s,_ = self.run_case(p)
        self.assertEqual(self.starts(s), [])
        self.assertEqual(r['outcome'], 'failed')

    def test_presence_rechecked_after_single_precheck_before_start(self):
        p = PhasePeer(); p.statuses = iter([1, 0])
        r,s,_ = self.run_case(p)
        self.assertEqual(self.starts(s), [])
        self.assertEqual(r['outcome'], 'failed')

    def test_invalid_timeout_rejected_before_all_io(self):
        for timeout in (True, 0, -1, 46, 121, float('nan'), float('inf'), '45'):
            with self.subTest(timeout=timeout):
                s = Session(); c = StrictClock(); caught = None
                try:
                    run_measurement_experiment(s,12,motion_approved=True,
                        blade_removed_confirmed=True,timeout=timeout,clock=c,sleep=c.sleep)
                except Exception as error:
                    caught = error
                self.assertIsInstance(caught,ValueError)
                self.assertEqual(s.channel.sent, [])

    def test_native_padded_precheck_is_not_a_completion_or_physical_success_claim(self):
        # 0483a8 pads this field; eb674 ignores raw state. Later progress here
        # is explicitly SYNTHETIC full data, not established by the start ACK.
        p = PhasePeer(precheck=[bytes.fromhex('00ee8501ff')])
        r,s,_ = self.run_case(p)
        self.assertEqual(r['outcome'],'measurement_complete')
        self.assertEqual(len(self.starts(s)),1)
        self.assertEqual(struct.pack('>f',r['initiallyMeasuredInches']).hex(),'8501ff00')
        self.assertFalse(r['physicalLoadingVerified'])

    def test_invalid_query_numbers_and_error_prefix_never_start(self):
        for payload in (typed(-1),typed(25),typed(float('nan')),typed(float('inf')),
                        typed(0,prefix=1),typed(0,prefix=0x31)):
            with self.subTest(payload=payload.hex()):
                r,s,_ = self.run_case(PhasePeer(precheck=[payload]))
                self.assertEqual(r['outcome'],'failed'); self.assertEqual(self.starts(s),[])

    def test_start_result_fields_are_discarded_and_progress_still_validated(self):
        # Native ebba0 never reads the response float, even if it is not a
        # plausible measurement. Separate QUERY float checks remain mandatory.
        for length in (-1,25,float('nan')):
            with self.subTest(length=length):
                peer=PhasePeer(start_reply=typed(length))
                r,s,_ = self.run_case(peer)
                self.assertEqual(r['outcome'],'measurement_complete')
                self.assertIs(r['measurementStartAcknowledged'],True)
                self.assertGreater(peer.queries_after_start,0)
                bad,_,_=self.run_case(PhasePeer(start_reply=typed(length),progress=[typed(float('nan'))]))
                self.assertEqual(bad['outcome'],'failed')

    def test_partial_length_queries_do_not_finish_early(self):
        p = PhasePeer(progress=[typed(1),typed(6),typed(12)])
        r,s,_ = self.run_case(p)
        self.assertEqual(r['outcome'],'measurement_complete')
        self.assertEqual(len(self.starts(s)),1)
        self.assertEqual(p.queries_after_start,3)

    def test_unchanged_progress_times_out_without_restarting(self):
        r,s,c = self.run_case(PhasePeer(progress=[typed(1)]))
        self.assertEqual(r['outcome'],'timeout'); self.assertEqual(len(self.starts(s)),1)
        self.assertLess(c.now,10)
        self.assertIs(r['physicalLoadingVerified'],False)

    def test_changed_length_resets_unchanged_result_stall_clock(self):
        readings = [typed(6)]*6 + [typed(5)]*6 + [typed(6)]*6 + [typed(12)]
        r,s,_ = self.run_case(PhasePeer(progress=readings))
        self.assertEqual(r['outcome'],'measurement_complete')
        self.assertEqual(len(self.starts(s)),1)

    def test_initially_satisfied_never_sends_nonzero_request(self):
        p = PhasePeer(precheck=[typed(12,0xee)])
        r,s,_ = self.run_case(p)
        self.assertEqual(r['outcome'],'precheck_already_satisfied')
        self.assertEqual(self.starts(s),[])
        self.assertEqual(r['measuredInches'],12)
        self.assertIs(r['measurementStartAcknowledged'],False)

    def test_cancel_each_phase_does_not_complete_or_restart(self):
        for stage in ('query_precheck','starting_measurement','polling_measurement',
                      'finishing_measurement','ready_for_observation'):
            with self.subTest(stage=stage):
                flag = [False]
                def on_stage(value):
                    if value == stage: flag[0] = True
                r,s,_ = self.run_case(cancelled=lambda:flag[0],on_stage=on_stage,
                                    hold_ready_seconds=1)
                self.assertEqual(r['outcome'],'cancelled')
                self.assertLessEqual(len(self.starts(s)),1)
                self.assertEqual(s.state,'closed')

    def test_finish_wait_io_can_cross_phase_end_without_negative_sleep(self):
        p = PhasePeer(); c = StrictClock(); finishing = [False]; times = {}
        def stage(value):
            if value=='finishing_measurement': finishing[0]=True; times['start']=c.now
            if value=='ready_for_observation': finishing[0]=False; times['end']=c.now
        def delay():
            if finishing[0]: c.now += .2
        p.receive_status_delay=delay
        r,_,_ = self.run_case(p,clock=c,sleep=c.sleep,on_stage=stage)
        self.assertEqual(r['outcome'],'measurement_complete')
        self.assertGreaterEqual(times['end']-times['start'],4)
        self.assertLess(times['end']-times['start'],4.3)

    def test_hold_io_can_cross_phase_end_without_negative_sleep(self):
        p = PhasePeer(); c = StrictClock(); observing = [False]
        def stage(value):
            if value=='ready_for_observation': observing[0]=True
        def delay():
            if observing[0]: c.now += .2
        p.receive_status_delay=delay
        r,_,_ = self.run_case(p,clock=c,sleep=c.sleep,on_stage=stage,hold_ready_seconds=.5)
        self.assertEqual(r['outcome'],'measurement_complete')

    def test_finishing_really_precedes_observation_and_cleanup(self):
        c = StrictClock(); times = {}
        def stage(value): times[value] = c.now
        r,_,_ = self.run_case(clock=c,sleep=c.sleep,on_stage=stage)
        self.assertEqual(r['outcome'],'measurement_complete')
        self.assertGreaterEqual(times['ready_for_observation']-times['finishing_measurement'],4)
        self.assertGreaterEqual(times['aborting'],times['ready_for_observation'])

    def test_lost_mat_during_persistently_busy_precheck_is_sampled_promptly(self):
        p = PhasePeer(precheck=[typed(0,True)]); p.statuses=iter([0,1,0])
        r,s,c = self.run_case(p)
        self.assertEqual(r['outcome'],'failed')
        self.assertLess(c.now,2)
        self.assertEqual(self.starts(s),[])

    def test_malformed_normalized_frame_discards_stream_without_cleanup_commands(self):
        p = PhasePeer(); receive = p.receive
        def malformed(timeout,*,require_encrypted):
            if p.sent[-1][2]==0x60: return bytes.fromhex('0009606801')
            return receive(timeout,require_encrypted=require_encrypted)
        p.receive=malformed
        r,s,_ = self.run_case(p)
        self.assertEqual(r['outcome'],'failed')
        self.assertIs(r['cleanup']['abortSent'],False)
        self.assertIs(r['cleanup']['disarmSent'],False)
        self.assertEqual(s.state,'closed')

    def test_valid_late_reply_is_traced_and_keeps_cleanup_available(self):
        p = PhasePeer(); c = StrictClock(); receive = p.receive; trace=[]
        def late(timeout,*,require_encrypted):
            frame = receive(timeout,require_encrypted=require_encrypted)
            if p.sent[-1][2]==0x60: c.now=46
            return frame
        p.receive=late
        r,_,_ = self.run_case(p,clock=c,sleep=c.sleep,on_trace=lambda packet,reply:trace.append((packet,reply)))
        self.assertEqual(r['outcome'],'timeout')
        self.assertTrue(any(packet[2]==0x60 for packet,_ in trace))
        self.assertIs(r['cleanup']['abortSent'],True)

    def test_cancel_at_zero_length_observation_still_reports_cancelled(self):
        flag=[False]
        def stage(value):
            if value=='ready_for_observation': flag[0]=True
        r,_,_ = self.run_case(cancelled=lambda:flag[0],on_stage=stage,hold_ready_seconds=0)
        self.assertEqual(r['outcome'],'cancelled')

    def test_presence_gate_after_start_stage_callback_before_nonzero_request(self):
        p=PhasePeer()
        def stage(value):
            if value=='starting_measurement': p.statuses=iter([0])
        r,s,_ = self.run_case(p,on_stage=stage)
        self.assertEqual(self.starts(s),[])
        self.assertEqual(r['outcome'],'failed')

    def test_overall_deadline_still_enforced_with_zero_observation(self):
        c = StrictClock()
        def stage(value):
            if value=='ready_for_observation': c.now=50
        r,_,_ = self.run_case(clock=c,sleep=c.sleep,on_stage=stage)
        self.assertEqual(r['outcome'],'timeout')


if __name__ == '__main__': unittest.main()
