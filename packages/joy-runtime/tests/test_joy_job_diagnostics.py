"""Only SYNTHETIC job/profile data, no hardware/calibration reads."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_joy_job_program import inputs
from joy_job_program import compile_job_program
from joy_job_diagnostics import JobDiagnostics
from joy_loading_diagnostics import LoadingDiagnostics,on_diagnostic
from joy_protocol import clear_frame

class JobDiagnosticsTests(unittest.TestCase):
    def recorder(self):
        program=compile_job_program(*inputs());return JobDiagnostics(1,program),program

    def test_job_records_program_bound_data_and_new_interface_query(self):
        recorder,program=self.recorder();callback=on_diagnostic(recorder)
        record=program.passes[0].paths[0].records[0]
        packets=[clear_frame(b'\x43'+record),clear_frame(b'\x73')]
        for packet in packets:callback('draining',packet,b'\x00\x06\x73\x00\x00\x00\x00\x00')
        result=recorder.snapshot();self.assertFalse(result['captureIncomplete'])
        self.assertEqual([e['txHex']for e in result['events']],[p.hex()for p in packets])
        self.assertEqual(result['lastStage'],'loading_and_aligning')

    def test_program_specific_config_not_generic_packet_permission(self):
        recorder,program=self.recorder()
        for body in program.passes[0].configuration_bodies:
            recorder.exchange('setting_up',clear_frame(body),bytes([0,5,0,body[0],5,1,0x90]))
        self.assertFalse(recorder.snapshot()['captureIncomplete'])
        old=LoadingDiagnostics(1)
        old.exchange('setting_up',clear_frame(program.passes[0].configuration_bodies[0]),b'xx')
        self.assertTrue(old.snapshot()['captureIncomplete'])

    def test_unplanned_data_and_arbitrary_request_redact_both_directions(self):
        for body in (b'\x43'+bytes([255])*9,b'\x99credential'):
            recorder,_=self.recorder()
            recorder.exchange('sending',clear_frame(body),b'private-response')
            result=recorder.snapshot();self.assertTrue(result['captureIncomplete'])
            self.assertNotIn('private-response'.encode().hex(),json.dumps(result))
            self.assertIsNone(result['events'][0]['txHex']);self.assertIsNone(result['events'][0]['rxHex'])

    def test_failure_never_serializes_exception_message(self):
        recorder,_=self.recorder();recorder.failure('sending',error=RuntimeError('secret-password-forbidden'))
        result=recorder.snapshot();self.assertEqual(result['failure']['errorType'],'RuntimeError')
        self.assertNotIn('secret-password',json.dumps(result))

    def test_job_window_retains_a_full_object_major_burst_but_loading_stays_at_512(self):
        recorder,_=self.recorder();old=LoadingDiagnostics(1)
        for _ in range(700):
            recorder.exchange('draining',clear_frame(b'\x73'),b'\x73\x00\x00\x00\x00\x00')
            old.exchange('loading_and_aligning',clear_frame(b'\xed\x01'),None)
        self.assertEqual(len(recorder.snapshot()['events']),700)
        self.assertEqual(recorder.snapshot()['evictedEvents'],0)
        self.assertEqual(len(old.snapshot()['events']),512)
        for _ in range(400):recorder.exchange('draining',clear_frame(b'\x73'),b'\x73\x00\x00\x00\x00\x00')
        self.assertEqual(len(recorder.snapshot()['events']),1024)
        self.assertEqual(recorder.snapshot()['evictedEvents'],76)

if __name__=='__main__':unittest.main()
