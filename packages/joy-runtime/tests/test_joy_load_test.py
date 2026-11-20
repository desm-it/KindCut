"""Hardware-free runner boundary tests; no paired listing or Bluetooth."""
import contextlib
import importlib
import importlib.util
import io
import json
import os
import fcntl
import threading
import time
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))

class LoadTestRunnerTests(unittest.TestCase):
    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('joy_load_test'), 'load-only test runner is missing')
        return importlib.import_module('joy_load_test')

    def test_default_plan_has_no_external_effects(self):
        with patch('subprocess.run', side_effect=AssertionError('external effect')):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = self.api().main([])
            self.assertEqual(code, 0)
            self.assertIn('plan_only', out.getvalue())

    def test_execute_requires_all_approvals_before_discovery(self):
        api = self.api()
        for opts in [dict(), dict(session_approved=True), dict(session_approved=True, motion_approved=True)]:
            with self.assertRaises(PermissionError):
                api.run_load_test(discover=lambda: self.fail('discovery'), **opts)

    def test_invalid_limits_are_denied_before_discovery(self):
        api = self.api()
        for opts in [dict(height_inches=7), dict(timeout=float('nan')), dict(hold_ready_seconds=31), dict(timeout=True), dict(timeout=46)]:
            with self.assertRaises(ValueError):
                api.run_load_test(session_approved=True, motion_approved=True, blade_removed_confirmed=True,
                                  discover=lambda: self.fail('discovery'), **opts)

    def test_ambiguous_wrong_model_and_connected_devices_denied(self):
        api = self.api()
        device = dict(name='Joy-TEST', address='00:00:00:00:00:01', paired=True, connected=False)
        for values in [[], [device, {**device, 'address':'00:00:00:00:00:02'}],
                       [{**device, 'name':'Joy Xtra-TEST'}], [{**device, 'connected':True}],
                       [{**device, 'paired':False}], [{**device, 'address':'bad'}]]:
            with self.assertRaises(ValueError):
                api.select_device(values)

    def test_runner_uses_discovered_device_and_always_closes(self):
        api = self.api()
        calls = []
        class Service:
            session = SimpleNamespace(state='ready', result=SimpleNamespace(selector=8.164000001, used_fallback=False))
            def handle(self, request): calls.append(request)
            def close(self): calls.append('closed')
        device = dict(name='Joy-TEST', address='00:00:00:00:00:01', paired=True, connected=False)
        def experiment(session, height, **kwargs):
            self.assertEqual(height, 12)
            self.assertTrue(kwargs['motion_approved'])
            self.assertTrue(kwargs['blade_removed_confirmed'])
            self.assertEqual(kwargs['hold_ready_seconds'], 10)
            return {'outcome':'measurement_complete', 'physicalLoadingVerified':False}
        result = api.run_load_test(session_approved=True, motion_approved=True, blade_removed_confirmed=True,
            discover=lambda:[device], owner_check=lambda:calls.append('owner_checked'),
            service_factory=Service, experiment=experiment)
        self.assertEqual(result['outcome'], 'measurement_complete')
        self.assertEqual(calls[-1], 'closed')
        connect = next(x for x in calls if isinstance(x, dict))
        self.assertEqual(connect['address'], device['address'])
        self.assertNotIn('bundle', connect)
        self.assertEqual(calls.count('owner_checked'), 2)

    def test_runner_closes_on_experiment_failure(self):
        api = self.api()
        closed = []
        class Service:
            session = SimpleNamespace(state='ready', result=SimpleNamespace(selector=8.164000001, used_fallback=False))
            def handle(self, request): pass
            def close(self): closed.append(True)
        device = dict(name='Joy-TEST', address='00:00:00:00:00:01', paired=True, connected=False)
        def fail(*args, **kwargs): raise OSError('must not surface device identifiers')
        with self.assertRaises(OSError):
            api.run_load_test(session_approved=True, motion_approved=True, blade_removed_confirmed=True,
                discover=lambda:[device], owner_check=lambda:None, service_factory=Service, experiment=fail)
        self.assertEqual(closed, [True])

    def test_cli_full_pipe_output_fails_fast_and_restores_descriptor_flags(self):
        api = self.api()
        read_fd, write_fd = os.pipe()
        old_flags = fcntl.fcntl(write_fd, fcntl.F_GETFL)
        try:
            fcntl.fcntl(write_fd, fcntl.F_SETFL, old_flags | os.O_NONBLOCK)
            while True:
                try: os.write(write_fd, b'x' * 4096)
                except BlockingIOError: break
            fcntl.fcntl(write_fd, fcntl.F_SETFL, old_flags)
            saved = os.dup(1)
            os.dup2(write_fd, 1)
            try:
                called = []
                def fake_run(**kwargs):
                    called.append(True)
                    kwargs['on_trace'](b'\x00\x05abc', b'x')
                    called.append('after_trace')
                    return {'outcome':'failed','cleanup':{}}
                with patch.object(api, 'run_load_test', side_effect=fake_run), patch.object(api, 'signal', SimpleNamespace(SIGINT=2, SIGTERM=15, signal=lambda *args: None)):
                    started = time.monotonic()
                    result = []
                    thread = threading.Thread(target=lambda: result.append(api.main(['--execute','--approve-session-reset','--approve-motion','--blade-housing-removed'])))
                    thread.start(); thread.join(.5)
                    self.assertFalse(thread.is_alive(), 'stdout full pipe blocked CLI cleanup/return')
                    self.assertEqual(result, [2])
                    self.assertEqual(called, [True])
                self.assertEqual(fcntl.fcntl(1, fcntl.F_GETFL) & os.O_NONBLOCK, old_flags & os.O_NONBLOCK)
            finally:
                os.dup2(saved, 1); os.close(saved)
        finally:
            os.close(read_fd); os.close(write_fd)

    def test_cli_broken_pipe_returns_nonzero_without_recursive_logging(self):
        api = self.api()
        read_fd, write_fd = os.pipe(); os.close(read_fd)
        saved = os.dup(1); os.dup2(write_fd, 1)
        try:
            result = []
            with patch.object(api, 'run_load_test', return_value={'outcome':'failed','cleanup':{}}), patch.object(api, 'signal', SimpleNamespace(SIGINT=2, SIGTERM=15, signal=lambda *args: None)):
                thread=threading.Thread(target=lambda: result.append(api.main(['--execute','--approve-session-reset','--approve-motion','--blade-housing-removed'])))
                thread.start(); thread.join(.5)
                self.assertFalse(thread.is_alive(), 'broken pipe logging blocked')
                self.assertEqual(result,[2])
        finally:
            os.dup2(saved,1); os.close(saved); os.close(write_fd)

    def test_cli_partial_write_fails_closed(self):
        api=self.api()
        writes=[]
        with patch.object(api, '_write_record', side_effect=api.TelemetryOutputError('partial')):
            with patch.object(api, 'run_load_test', return_value={'outcome':'failed','cleanup':{}}):
                with contextlib.redirect_stdout(io.StringIO()):
                    code=api.main(['--execute','--approve-session-reset','--approve-motion','--blade-housing-removed'])
            self.assertEqual(code,2)

    def test_cli_preserves_full_normalized_reply_payload(self):
        api = self.api()
        payload = bytes.fromhex('30000000040c00000000000000')
        def fake_run(**kwargs):
            kwargs['on_trace'](b'\x00\x0d' + payload, payload)
            return {'outcome':'measurement_complete', 'physicalLoadingVerified':False,
                    'cleanup':{'abortReplyAccepted':True, 'disarmReplyReceived':True, 'closeReturned':True}}
        out = io.StringIO()
        with patch.object(api, 'run_load_test', side_effect=fake_run), contextlib.redirect_stdout(out):
            self.assertEqual(api.main(['--execute','--approve-session-reset','--approve-motion','--blade-housing-removed']), 0)
        import json
        records = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(records[0]['rx'], payload.hex())

    def test_cli_does_not_exit_success_on_cleanup_failure(self):
        api = self.api()
        for bad in ('abortReplyAccepted','disarmReplyReceived','closeReturned'):
            cleanup = dict(abortReplyAccepted=True, disarmReplyReceived=True, closeReturned=True)
            cleanup[bad] = False
            result = {'outcome':'measurement_complete', 'physicalLoadingVerified':False, 'cleanup':cleanup}
            with patch.object(api, 'run_load_test', return_value=result), contextlib.redirect_stdout(io.StringIO()):
                self.assertNotEqual(api.main(['--execute','--approve-session-reset','--approve-motion','--blade-housing-removed']), 0)

    def test_runner_enforces_session_gate_even_with_injected_experiment(self):
        from types import SimpleNamespace
        api = self.api()
        device = dict(name='Joy-TEST', address='00:00:00:00:00:01', paired=True, connected=False)
        for session in (object(), SimpleNamespace(state='new', result=None),
                        SimpleNamespace(state='ready', result=SimpleNamespace(selector=9, used_fallback=False)),
                        SimpleNamespace(state='ready', result=SimpleNamespace(selector=8.164000001, used_fallback=True))):
            closed = []
            class Service:
                def handle(self, request): self.session = session
                def close(self): closed.append(True)
            with self.assertRaises(ValueError):
                api.run_load_test(session_approved=True, motion_approved=True, blade_removed_confirmed=True,
                    discover=lambda:[device], owner_check=lambda:None, service_factory=Service,
                    experiment=lambda *a,**kw:self.fail('invalid session dispatched'))
            self.assertEqual(closed, [True])

    def test_cancel_during_init_closes_without_dispatching_motion(self):
        from types import SimpleNamespace
        api = self.api()
        flag = [False]; closed = []; stages = []
        device = dict(name='Joy-TEST', address='00:00:00:00:00:01', paired=True, connected=False)
        class Service:
            def handle(self, request):
                flag[0] = True
                self.session = SimpleNamespace(state='ready', result=SimpleNamespace(selector=8.164000001, used_fallback=False))
            def close(self): closed.append(True)
        result = api.run_load_test(session_approved=True, motion_approved=True, blade_removed_confirmed=True,
            discover=lambda:[device], owner_check=lambda:None, service_factory=Service,
            cancelled=lambda:flag[0], on_stage=stages.append,
            experiment=lambda *a,**kw:self.fail('motion after initialization cancellation'))
        self.assertEqual(result['outcome'], 'cancelled')
        self.assertEqual(closed, [True])
        self.assertIn('connecting_initializing_cancel_deferred', stages)

    def test_cancel_before_init_avoids_even_discovery(self):
        result = self.api().run_load_test(session_approved=True, motion_approved=True,
            blade_removed_confirmed=True, cancelled=lambda:True, owner_check=lambda:None,
            discover=lambda:self.fail('discovery after cancellation'))
        self.assertEqual(result['outcome'], 'cancelled')

    def test_cli_traces_and_stages_have_host_elapsed_time(self):
        api = self.api()
        def fake_run(**kwargs):
            kwargs['on_stage']('query_precheck')
            kwargs['on_trace'](bytes.fromhex('0005ee41400000'), bytes.fromhex('00ee8501ff'))
            return {'outcome':'measurement_complete', 'physicalLoadingVerified':False,
                    'cleanup':{'abortReplyAccepted':True,'disarmReplyReceived':True,'closeReturned':True}}
        out = io.StringIO()
        with patch.object(api,'run_load_test',side_effect=fake_run), contextlib.redirect_stdout(out):
            self.assertEqual(api.main(['--execute','--approve-session-reset','--approve-motion','--blade-housing-removed']),0)
        import json
        records = [json.loads(line) for line in out.getvalue().splitlines()]
        for record in records[:2]:
            self.assertIn('elapsedSeconds',record)
            self.assertGreaterEqual(record['elapsedSeconds'],0)
        self.assertLessEqual(records[0]['elapsedSeconds'],records[1]['elapsedSeconds'])
        self.assertEqual(records[1]['rx'],'00ee8501ff')

    def test_plan_separates_start_progress_and_finishing_from_alignment(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out): self.assertEqual(self.api().main([]),0)
        import json
        plan = json.loads(out.getvalue())
        self.assertEqual(plan.get('measurementPhases'),['precheck','start_acknowledgment','progress_queries','finishing_wait','observation'])
        self.assertIs(plan.get('startReplyIsCompletion'),False)
        self.assertIs(plan.get('xyPositioningIncluded'),False)
        self.assertEqual(plan.get('finishingWaitSeconds'),4)

if __name__ == '__main__': unittest.main()
