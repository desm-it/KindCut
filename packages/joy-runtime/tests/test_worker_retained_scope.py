"""Worker service owns the real retained loader against inert library peers."""
import importlib
import sys
from pathlib import Path
import threading
import unittest
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
RuntimeService = importlib.import_module('worker').RuntimeService
from test_joy_retained_composition import LoaderPeer
from test_joy_measurement_experiment import Session, Clock


class WorkerRetainedScopeTests(unittest.TestCase):
    def setup_owner(self):
        clock = Clock()
        session: Any = Session()
        session.channel = LoaderPeer(clock)
        service = RuntimeService(platform='darwin')
        service.session = session
        service._summary = {'state': 'ready'}
        options: dict[str, Any] = dict(height_inches=12, host_go=lambda timeout: True,
                       material_present=lambda: True, motion_approved=True,
                       blade_removed_confirmed=True, point_mode='scalar',
                       clock=clock, sleep=clock.sleep, timeout=30)
        return service, session, options

    def test_scope_denies_without_fresh_approval_and_preserves_idle_session(self):
        for field in ('motion_approved', 'blade_removed_confirmed'):
            for value in (False, None, 'true', 1):
                service, session, options = self.setup_owner()
                options[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(PermissionError):
                    with service.retained_load_scope(**options):
                        self.fail('entered')
                self.assertIs(service.session, session)
                self.assertEqual(session.state, 'ready')
                self.assertEqual(session.channel.sent, [])

    def test_actual_worker_owns_measure_align_go_and_caller_until_retirement(self):
        service, session, options = self.setup_owner()
        calls = []
        def go(timeout):
            calls.append(timeout)
            self.assertEqual(session.state, 'ready')
            self.assertFalse(any(p[2:] == b'\xed\x01' for p in session.channel.sent))
            for request in ({'op': 'status'}, {'op': 'disconnect'},
                            {'op': 'mat', 'action': 'grip', 'motionApproved': True}):
                with self.assertRaisesRegex(RuntimeError, 'owned'):
                    service.handle(request)
            with self.assertRaisesRegex(RuntimeError, 'owned'):
                service.close()
            return len(calls) == 2
        options['host_go'] = go
        with service.retained_load_scope(**options) as result:
            self.assertEqual(result.outcome, 'host_go_observed_no_job_started')
            self.assertFalse(result.physical_alignment_verified)
            self.assertEqual(session.state, 'ready')
            before = tuple(session.channel.sent)
            with self.assertRaisesRegex(RuntimeError, 'owned'):
                service.handle({'op': 'status'})
            self.assertEqual(tuple(session.channel.sent), before)
        self.assertEqual(len(calls), 2)
        self.assertEqual(sum(p[2] == 0x21 for p in session.channel.sent), 1)
        self.assertEqual(sum(p[2] == 0x22 for p in session.channel.sent), 1)
        self.assertEqual(session.state, 'closed')
        self.assertIsNone(service.session)
        self.assertIsNone(service.transport)
        self.assertIsNone(service._summary)
        self.assertEqual(service.handle({'op': 'probe'})['hardwareAccess'], False)

    def test_second_owner_thread_is_rejected_without_interleaved_io(self):
        service, session, options = self.setup_owner()
        errors = []
        def competing_owner():
            try:
                with service.retained_load_scope(**options):
                    errors.append('unexpected lease')
            except RuntimeError as error:
                errors.append(str(error))
        with service.retained_load_scope(**options):
            before = tuple(session.channel.sent)
            thread = threading.Thread(target=competing_owner)
            thread.start(); thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(errors), 1)
            self.assertIn('owned', errors[0])
            self.assertEqual(tuple(session.channel.sent), before)

    def test_borrower_fault_invalidates_before_real_scope_cleanup(self):
        service, session, options = self.setup_owner()
        error = OSError('inert borrower failure')
        before = ()
        with self.assertRaises(OSError) as caught:
            with service.retained_load_scope(**options) as result:
                result.borrower_stream_state.invalidate()
                before = tuple(session.channel.sent)
                raise error
        self.assertIs(caught.exception, error)
        self.assertEqual(tuple(session.channel.sent), before)
        self.assertIsNone(service.session)
        self.assertEqual(session.state, 'closed')
        self.assertEqual(service.handle({'op': 'probe'})['hardwareAccess'], False)

    def test_material_loss_pending_go_retires_worker_session_and_releases_owner(self):
        service, session, options = self.setup_owner()
        def go(timeout):
            session.channel.lost = True
            return False
        options['host_go'] = go
        with self.assertRaisesRegex(RuntimeError, 'material'):
            with service.retained_load_scope(**options):
                self.fail('entered')
        self.assertIsNone(service.session)
        self.assertEqual(session.state, 'closed')
        self.assertEqual(service.handle({'op': 'disconnect'}), {'state': 'disconnected'})

    def test_caller_error_is_not_replaced_by_secondary_close_error(self):
        service, session, options = self.setup_owner()
        original_close = session.close
        closes = []
        def close():
            closes.append(True)
            original_close()
            if len(closes) > 1:
                raise LookupError('secondary close failure')
        session.close = close
        primary = OSError('borrower failure')
        with self.assertRaises(OSError) as caught:
            with service.retained_load_scope(**options) as result:
                result.borrower_stream_state.invalidate()
                raise primary
        self.assertIs(caught.exception, primary)
        self.assertIsNone(service.session)
        self.assertEqual(service.handle({'op': 'probe'})['hardwareAccess'], False)

    def test_no_json_activation_or_uninitialized_scope(self):
        service = RuntimeService()
        with self.assertRaises(RuntimeError):
            with service.retained_load_scope(motion_approved=True, blade_removed_confirmed=True):
                self.fail('entered')
        for op in ('load', 'alignedLoad', 'go', 'retained_load_scope', 'cut'):
            with self.subTest(op=op), self.assertRaises(ValueError):
                service.handle({'op': op, 'motionApproved': True})
        self.assertEqual(service.handle({'op': 'probe'})['capabilities'],
                         ['provision', 'connect', 'status', 'mat', 'disconnect', 'loading', 'configuration', 'calibration', 'experimentalPenJob'])


if __name__ == '__main__':
    unittest.main()
