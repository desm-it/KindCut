import copy
import threading
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from joy_loading_diagnostics import LoadingDiagnostics

class LoadingDiagnosticsTests(unittest.TestCase):
    def test_rejects_non_allowlisted_frames_and_redacts_labels_with_monotonic_time(self):
        ticks = iter([10.0, 10.1, 10.2, 10.3, 10.4])
        d = LoadingDiagnostics(3, clock=lambda: next(ticks))
        d.exchange('secret_stage', b'private-auth-key', b'private-reply')
        d.stage('secret label')
        snapshot = d.snapshot()
        self.assertTrue(snapshot['captureIncomplete'])
        self.assertTrue(all(e['txHex'] is None and e['rxHex'] is None for e in snapshot['events']))
        self.assertNotIn('secret', repr(snapshot))
        self.assertTrue(all(e['atMs'] >= 0 for e in snapshot['events']))

    def test_exchange_callback_api_preserves_started_timestamp_and_thread_safe_snapshot(self):
        from joy_loading_diagnostics import on_diagnostic
        d = LoadingDiagnostics(4)
        observer = on_diagnostic(d)
        self.assertIsNone(observer('loading_and_aligning', b'not-allowed', None,
                                   started=10.25, kind='exchange'))
        threads = [threading.Thread(target=lambda: [d.stage('stage_' + str(i)) for i in range(60)])
                   for _ in range(4)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        snap = d.snapshot()
        self.assertEqual(snap['totalEvents'], snap['evictedEvents'] + len(snap['events']))
        self.assertEqual([e['seq'] for e in snap['events']], sorted(e['seq'] for e in snap['events']))

    def test_redacted_bounded_immutable_snapshot_and_failure(self):
        d=LoadingDiagnostics(7)
        d.stage('checking_precheck')
        d.exchange('checking_precheck', b'\x00\x01\x60', b'\x00\x01\x61')
        d.failure('checking_precheck', 'malformed_reply', ValueError('secret-device-key'))
        s=d.snapshot()
        self.assertEqual(s['failure'], {'stage':'checking_precheck','code':'malformed_reply','errorType':'ValueError'})
        self.assertNotIn('secret-device-key', repr(s))
        s['events'][0]['stage']='mutated'
        self.assertEqual(d.snapshot()['events'][0]['stage'], 'checking_precheck')
        for i in range(520): d.stage('checking_precheck_' + str(i))
        s=d.snapshot()
        self.assertLessEqual(len(s['events']),512)
        self.assertGreater(s['evictedEvents'],0)
        self.assertEqual(s['totalEvents'],s['evictedEvents']+len(s['events']))

    def test_unknown_and_oversized_capture_creates_gap(self):
        d=LoadingDiagnostics(1)
        d.exchange('stage', b'\x00secret', b'x'*600)
        s=d.snapshot()
        self.assertTrue(s['captureIncomplete'])
        self.assertTrue(any(e['kind']=='capture_gap' for e in s['events']))
        self.assertNotIn('secret',repr(s))

if __name__=='__main__': unittest.main()
