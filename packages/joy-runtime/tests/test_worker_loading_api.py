"""Real JSON loading API against inert measurement/alignment peers; no device I/O."""
import importlib
import io
import json
import sys
import time
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
worker = importlib.import_module('worker')
from test_joy_measurement_experiment import Session, Clock
from test_joy_retained_composition import LoaderPeer


class LoadingApiTests(unittest.TestCase):
    def owner(self):
        clock = Clock()
        session: Any = Session()
        session.channel = LoaderPeer(clock)
        service = worker.RuntimeService(platform='darwin')
        service.session = session
        service._summary = {'state': 'ready'}
        # Trusted test dependencies only, never selectable from JSON.
        service._loading_clock = clock
        service._loading_sleep = clock.sleep
        return service, session

    def start(self, service, **changes):
        request = dict(op='loading', action='start', heightInches=12,
                       timeout=30, motionApproved=True, bladeRemovedConfirmed=True)
        request.update(changes)
        return service.handle(request)

    def wait(self, service, phase=None):
        end = time.monotonic() + 3
        while time.monotonic() < end:
            result = service.handle({'op': 'loading', 'action': 'status'})
            if (result['phase'] == phase if phase else not result['active']):
                return result
            time.sleep(.005)
        self.fail('bounded inert loading task did not reach expected phase')

    def assert_inert_metadata(self, result):
        for field in ('physicalLoadingVerified', 'physicalAlignmentVerified',
                      'motionStoppedVerified', 'jobStarted'):
            self.assertIs(result[field], False)

    def test_real_start_wait_go_and_cleanup_preserve_exclusive_owner(self):
        service, session = self.owner()
        try:
            started = self.start(service)
            self.assertTrue(started['active'])
            pending = self.wait(service, 'waiting_for_go')
            self.assert_inert_metadata(pending)
            self.assertEqual(session.state, 'ready')
            self.assertFalse(any(p[2:] == b'\xed\x01' for p in session.channel.sent))
            before = tuple(session.channel.sent)
            for op in ('status', 'mat', 'disconnect', 'connect'):
                with self.subTest(op=op), self.assertRaisesRegex(RuntimeError, 'owned'):
                    service.handle({'op': op})
            self.assertEqual(tuple(session.channel.sent), before)
            service.handle({'op': 'loading', 'action': 'go', 'operationId': started['operationId']})
            done = self.wait(service)
            self.assertEqual(done['phase'], 'completed')
            self.assertTrue(done['sessionRetired'])
            self.assert_inert_metadata(done)
            self.assertIsNone(service.session)
            self.assertEqual(session.state, 'closed')
            self.assertEqual(sum(p[2] == 0x21 for p in session.channel.sent), 1)
            self.assertEqual(sum(p[2] == 0x22 for p in session.channel.sent), 1)
        finally:
            service.close()

    def test_cancel_is_signal_only_and_eventually_retires_session(self):
        service, session = self.owner()
        try:
            result = self.start(service)
            self.wait(service, 'waiting_for_go')
            response = service.handle({'op': 'loading', 'action': 'cancel', 'operationId': result['operationId']})
            self.assert_inert_metadata(response)
            done = self.wait(service)
            self.assertEqual(done['phase'], 'cancelled')
            self.assertTrue(done['sessionRetired'])
            self.assertEqual(session.state, 'closed')
        finally:
            service.close()

    def test_missing_approvals_do_not_touch_the_session(self):
        for field in ('motionApproved', 'bladeRemovedConfirmed'):
            for value in (False, 1, 'true', None):
                service, session = self.owner()
                with self.subTest(field=field, value=value), self.assertRaises(PermissionError):
                    self.start(service, **{field: value})
                self.assertEqual(session.channel.sent, [])
                self.assertIs(service.session, session)
                service.close()

    def test_request_shape_is_closed_and_invalid_before_io(self):
        for changes in ({'heightInches': True}, {'heightInches': 13}, {'timeout': float('nan')},
                        {'timeout': 61}, {'timeout': True}, {'materialPresent': True},
                        {'pointMode': 'batch'}, {'job': {}}, {'config': {}}):
            service, session = self.owner()
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.start(service, **changes)
            self.assertEqual(session.channel.sent, [])
            self.assertIs(service.session, session)
            service.close()

    def test_wrong_operation_id_and_renderer_presence_claim_are_rejected(self):
        service, session = self.owner()
        try:
            result = self.start(service)
            self.wait(service, 'waiting_for_go')
            for changes in ({'operationId': result['operationId'] + 1},
                            {'operationId': True}, {'operationId': result['operationId'], 'materialPresent': True}):
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    service.handle({'op': 'loading', 'action': 'go', **changes})
            self.assertEqual(service.handle({'op': 'loading', 'action': 'status'})['phase'], 'waiting_for_go')
        finally:
            service.close()

    def test_second_start_cannot_replace_active_owner(self):
        service, session = self.owner()
        try:
            self.start(service)
            self.wait(service, 'waiting_for_go')
            with self.assertRaisesRegex(RuntimeError, 'owned'):
                self.start(service)
        finally:
            service.close()

    def test_real_status_material_removal_fails_without_renderer_assertion(self):
        service, session = self.owner()
        try:
            self.start(service)
            self.wait(service, 'waiting_for_go')
            session.channel.lost = True
            done = self.wait(service)
            self.assertEqual(done['phase'], 'failed')
            self.assertTrue(done['sessionRetired'])
            self.assert_inert_metadata(done)
        finally:
            service.close()

    def test_uncertain_status_reply_closes_without_more_protocol_sends(self):
        service, session = self.owner()
        try:
            self.start(service)
            self.wait(service, 'waiting_for_go')
            session.channel.failure = OSError('private synthetic failure')
            done = self.wait(service)
            self.assertEqual(done['phase'], 'failed')
            self.assertEqual(tuple(session.channel.sent), session.channel.snapshot)
            self.assertNotIn('private', json.dumps(done))
        finally:
            service.close()

    def test_shutdown_cancels_and_joins_task_before_returning(self):
        service, session = self.owner()
        self.start(service)
        self.wait(service, 'waiting_for_go')
        service.close()
        self.assertEqual(session.state, 'closed')
        self.assertFalse(service.handle({'op': 'loading', 'action': 'status'})['active'])
        self.assertIsNone(service.session)

    def test_eof_cleans_up_started_task_without_waiting_for_go(self):
        service, session = self.owner()
        source = io.BytesIO((json.dumps(dict(id=1, op='loading', action='start', heightInches=12,
                             timeout=30, motionApproved=True, bladeRemovedConfirmed=True)) + '\n').encode())
        output = io.StringIO()
        worker.serve(source, output, service)
        reply = json.loads(output.getvalue())
        self.assertTrue(reply['ok'])
        self.assertFalse(service.handle({'op': 'loading', 'action': 'status'})['active'])
        self.assertEqual(session.state, 'closed')


    def test_capability_and_inert_idle_status_are_advertised_without_a_task(self):
        service = worker.RuntimeService()
        self.assertIn('loading', service.handle({'op': 'probe'})['capabilities'])
        result = service.handle({'op': 'loading', 'action': 'status'})
        self.assertEqual(result['phase'], 'idle')
        self.assertEqual(result['operationId'], 0)
        self.assertFalse(result['active'])
        self.assert_inert_metadata(result)
        service.close()

    def test_prep_deadline_does_not_retire_retained_ready_session(self):
        service, session = self.owner()
        try:
            self.start(service)
            pending = self.wait(service, 'waiting_for_go')
            service._loading_clock.sleep(100)
            still_ready = service.handle({'op': 'loading', 'action': 'status'})
            self.assertTrue(still_ready['active'])
            self.assertEqual(still_ready['phase'], 'waiting_for_go')
            self.assertEqual(session.state, 'ready')
            service.handle({'op': 'loading', 'action': 'cancel', 'operationId': pending['operationId']})
            result = self.wait(service)
            self.assertEqual(result['phase'], 'cancelled')
            self.assertTrue(result['sessionRetired'])
            self.assert_inert_metadata(result)
        finally:
            service.close()


if __name__ == '__main__':
    unittest.main()
