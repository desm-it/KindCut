from types import SimpleNamespace
import unittest

from joy_job_executor import run_job_program, ExceptionJobRejected
from joy_tool_return import ORIGIN_RETURN_RECORDS
from joy_job_program import NativeJobProgram, JobPass, JobPath
from joy_measurement_experiment import BorrowerStreamState


class InertChannel:
    def __init__(self, cap=2):
        self.sent = []
        self.cap = cap

    def send(self, packet, *, encrypted, timeout):
        assert encrypted and timeout > 0
        self.sent.append(packet)

    def receive(self, timeout, *, require_encrypted):
        assert require_encrypted and timeout > 0
        body = self.sent[-1][2:]
        op = body[0]
        if op == 0x60:
            return b'\x00\x09\x60\x60\x01\x00\x00\x00\x00\x00\x00'
        if op == 0x73:
            return b'\x00\x06\x73\x00\x00\x00\x00\x00'
        if op == 0x43:
            return bytes([0, 5, 0, 0x43, 0, 0, self.cap])
        return bytes([0, 5, 0, op, 0, 0, 0])


def fixture():
    channel = InertChannel()
    session = SimpleNamespace(state='ready', result=SimpleNamespace(selector=8.164000001, used_fallback=False), channel=channel)
    guard = BorrowerStreamState(); guard._bound = True
    records = tuple(bytes([0, i, 0, 0, 0, 0, 0, 0, 0]) for i in range(5))
    program = NativeJobProgram('a'*64, 12, 'pen', 'draw', 'kindcut_canvas_pt72_v1', 12.0,
        (JobPass(100, (b'\x30'+bytes(30), b'\x31'+bytes(30), b'\x3e'+bytes(30)),
                 (JobPath('p', records),)),))
    return session, guard, program


class ExecutorTests(unittest.TestCase):
    def test_program_streams_config_then_dynamic_batches_and_final_drain(self):

        session, guard, program = fixture()
        result = run_job_program(session=session, program=program, borrower_stream_state=guard,
            motion_approved=True, tool_confirmed=True, max_status_polls=5, initial_batch_limit=2)
        bodies = [packet[2:] for packet in session.channel.sent]
        data = [body for body in bodies if body[0] == 0x43]
        assert [len(body[1:]) // 9 for body in data] == [2, 2, 1, 2]
        assert [body[0] for body in bodies if body[0] in (0x22, 0x30, 0x31, 0x3e, 0x21)] == [0x22,0x30,0x31,0x3e,0x21,0x21,0x22]
        assert result.accepted_records == 5
        assert result.outcome == 'protocol_completion_observed_unverified'
        assert not result.physical_completion_verified and not result.motion_stopped_verified
        assert bodies.count(b'\x73') == 2


    def test_denied_admission_sends_nothing(self):
        session, guard, program = fixture()
        with self.assertRaises(ExceptionJobRejected):
            run_job_program(session=session, program=program, borrower_stream_state=guard,
                motion_approved=False, tool_confirmed=True)
        assert session.channel.sent == []


    def test_malformed_reply_invalidates_guard_without_replay(self):
        session, guard, program = fixture()
        class Broken(InertChannel):
            def receive(self, timeout, *, require_encrypted):
                return b"\x00\x08\x60"
        session.channel = Broken()
        with self.assertRaises(ValueError):
            run_job_program(session=session, program=program, borrower_stream_state=guard,
                motion_approved=True, tool_confirmed=True)
        assert guard._invalidated
        assert len(session.channel.sent) == 1


    def test_observer_faults_do_not_change_execution_order(self):
        session, guard, program = fixture()
        stages = []
        def broken_stage(name):
            stages.append(name)
            raise RuntimeError("observer")
        result = run_job_program(session=session, program=program, borrower_stream_state=guard,
            motion_approved=True, tool_confirmed=True, initial_batch_limit=2,
            on_stage=broken_stage, on_progress=lambda value: (_ for _ in ()).throw(RuntimeError()))
        assert stages == ["draining", "setting_up", "sending", "draining", "returning_to_origin"]
        assert result.diagnostic_capture_incomplete
        assert result.accepted_records == 5


class QueuePauseTests(unittest.TestCase):
    def run_paused(self, mode='resume', response=None):
        from joy_alignment_session import OperationCancelled, OperationDeadline, MaterialLost
        session, guard, program = fixture()
        flags={'pause':False,'cancel':False,'time':0.,'slept':0}
        stages=[];progress=[];original=session.channel.receive
        def receive(timeout, *, require_encrypted):
            raw=original(timeout,require_encrypted=require_encrypted)
            if session.channel.sent[-1][2]==0x43 and not flags.get('first'):
                flags['first']=True;flags['pause']=True
                # Signal arrives WHILE response is being received, before consumption.
                flags['ack_returning']=True
                if response is not None:return response
            return raw
        session.channel.receive=receive
        def stage(name):
            stages.append(name)
            if name=='paused':
                self.assertTrue(flags['ack_returning']);self.assertEqual(progress[-1]['acceptedRecords'],2)
                self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),1)
                flags['paused_ops']=len(session.channel.sent)
        def sleep(dt):
            flags['slept']+=1;flags['time']+=dt
            if 'paused_ops' in flags:
                self.assertTrue(all(packet[2] in (0x60,0x73) for packet in session.channel.sent[flags['paused_ops']:]))
            if mode=='resume':flags['pause']=False
            elif mode=='cancel':flags['cancel']=True
            elif mode=='lost':
                def lost(timeout,*,require_encrypted):
                    return bytes.fromhex('0009606000000000000000')
                session.channel.receive=lost
        kwargs=dict(session=session,program=program,borrower_stream_state=guard,
            motion_approved=True,tool_confirmed=True,initial_batch_limit=2,max_status_polls=5,
            pause_requested=lambda:flags['pause'],cancelled=lambda:flags['cancel'],
            clock=lambda:flags['time'],sleep=sleep,on_stage=stage,on_progress=progress.append,
            timeout=.3 if mode=='timeout' else 60)
        return session,guard,program,flags,stages,kwargs

    def test_pause_consumes_ack_then_drains_and_resumes_exact_cursor_without_reset(self):
        session,guard,program,flags,stages,kwargs=self.run_paused()
        result=run_job_program(**kwargs)
        self.assertIn('paused',stages);self.assertGreaterEqual(flags['slept'],1)
        bodies=[p[2:]for p in session.channel.sent];data=[b[1:]for b in bodies if b[0]==0x43]
        self.assertEqual(b''.join(data),b''.join(program.passes[0].paths[0].records)+b''.join(ORIGIN_RETURN_RECORDS))
        self.assertEqual([b[0]for b in bodies if b[0]in(0x22,0x30,0x31,0x3e,0x21)],[0x22,0x30,0x31,0x3e,0x21,0x21,0x22])
        self.assertEqual(result.accepted_records,5);self.assertFalse(result.motion_stopped_verified)
        self.assertFalse(result.physical_completion_verified);self.assertFalse(guard._invalidated)
        self.assertFalse(result.diagnostic_capture_incomplete)

    def test_cancel_and_deadline_while_paused_never_submit_remaining_records(self):
        from joy_alignment_session import OperationCancelled, OperationDeadline
        for mode,error in [('cancel',OperationCancelled),('timeout',OperationDeadline)]:
            session,guard,program,flags,stages,kwargs=self.run_paused(mode)
            with self.subTest(mode=mode),self.assertRaises(error):run_job_program(**kwargs)
            self.assertIn('paused',stages);self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),1)
            self.assertFalse(guard._invalidated)

    def test_material_loss_while_paused_is_not_a_resumable_state(self):
        from joy_alignment_session import MaterialLost
        session,guard,program,flags,stages,kwargs=self.run_paused('lost')
        with self.assertRaises(MaterialLost):run_job_program(**kwargs)
        self.assertIn('paused',stages);self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),1)

    def test_uncertain_ack_never_reaches_pause_or_replays(self):
        session,guard,program,flags,stages,kwargs=self.run_paused(response=b'\x00\x08\x00')
        with self.assertRaises(ValueError):run_job_program(**kwargs)
        self.assertNotIn('paused',stages);self.assertTrue(guard._invalidated)
        self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),1)

    def test_pause_callback_is_explicit_boolean_and_validated_before_io(self):
        for callback in [None,lambda:1,lambda:'pause']:
            session,guard,program=fixture()
            with self.subTest(callback=callback),self.assertRaises(ExceptionJobRejected):
                run_job_program(session=session,program=program,borrower_stream_state=guard,
                    motion_approved=True,tool_confirmed=True,pause_requested=callback)
            self.assertEqual(session.channel.sent,[])

    def test_unsupported_feedback_cannot_be_promoted_to_pause(self):
        for b,c in [(0x20,0),(0x40,0),(0,2)]:
            raw=bytes([0,5,0,0x43,b,c,2])
            session,guard,program,flags,stages,kwargs=self.run_paused(response=raw)
            with self.subTest(b=b,c=c),self.assertRaises(ExceptionJobRejected):run_job_program(**kwargs)
            self.assertNotIn('paused',stages)
            self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),1)

    def test_pause_does_not_reset_ack_batch_capacity(self):
        session,guard,program,flags,stages,kwargs=self.run_paused(response=bytes([0,5,0,0x43,0,0,1]))
        result=run_job_program(**kwargs)
        data=[p[3:]for p in session.channel.sent if p[2]==0x43]
        self.assertEqual([len(b)//9 for b in data],[2,1,2,2])
        self.assertEqual(b''.join(data),b''.join(program.passes[0].paths[0].records)+b''.join(ORIGIN_RETURN_RECORDS))
        self.assertEqual(result.accepted_records,5)
