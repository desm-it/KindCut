"""Hardware-free lease tests using the existing synthetic measurement peer."""
import importlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from test_joy_measurement_experiment import Session, Clock

class MeasurementScopeTests(unittest.TestCase):
    def api(self):
        return importlib.import_module('joy_measurement_experiment')

    def opts(self, clock):
        return dict(motion_approved=True, blade_removed_confirmed=True,
                    clock=clock, sleep=clock.sleep)

    def test_session_remains_armed_and_open_during_scope_then_cleans_on_exit(self):
        api = self.api(); session = Session(); clock = Clock()
        with api.measured_session_scope(session, 12, **self.opts(clock)) as report:
            self.assertIn(report['outcome'], ('measurement_complete', 'precheck_already_satisfied'))
            self.assertEqual(session.state, 'ready')
            self.assertFalse(any(packet[2:] in (bytes.fromhex('68ff'), bytes.fromhex('ed01')) for packet in session.channel.sent))
            self.assertFalse(report['cleanup']['closeReturned'])
        self.assertEqual(session.state, 'closed')
        self.assertTrue(report['cleanup']['closeReturned'])
        self.assertEqual(sum(p[2:] == bytes.fromhex('68ff') for p in session.channel.sent), 1)
        self.assertEqual(sum(p[2:] == bytes.fromhex('ed01') for p in session.channel.sent), 1)
        self.assertFalse(report['physicalLoadingVerified'])
        self.assertFalse(report['motionStoppedVerified'])

    def test_borrower_exception_propagates_after_cleanup(self):
        api=self.api(); session=Session(); clock=Clock(); error=RuntimeError('caller')
        with self.assertRaisesRegex(RuntimeError, 'caller'):
            with api.measured_session_scope(session, 12, **self.opts(clock)):
                raise error
        self.assertEqual(session.state, 'closed')
        self.assertEqual(sum(p[2:] == bytes.fromhex('68ff') for p in session.channel.sent), 1)

    def test_failed_measurement_never_yields_and_closes(self):
        api=self.api(); session=Session(malformed=True); clock=Clock(); entered=[]
        with self.assertRaises(api.MeasurementScopeFailed) as caught:
            with api.measured_session_scope(session, 12, **self.opts(clock)):
                entered.append(True)
        self.assertEqual(entered, [])
        self.assertEqual(caught.exception.report['outcome'], 'timeout')
        self.assertEqual(session.state, 'closed')

    def test_denied_approval_has_no_io_or_cleanup(self):
        api=self.api(); session=Session(); clock=Clock()
        with self.assertRaises(PermissionError):
            with api.measured_session_scope(session, 12, clock=clock, sleep=clock.sleep): pass
        self.assertEqual(session.channel.sent, [])
        self.assertEqual(session.state, 'ready')

    def test_scope_construction_is_lazy(self):
        api=self.api(); session=Session(); clock=Clock()
        scope=api.measured_session_scope(session, 12, **self.opts(clock))
        self.assertEqual(session.channel.sent, [])
        self.assertEqual(session.state, 'ready')

    def test_legacy_wrapper_still_returns_after_cleanup(self):
        api=self.api(); session=Session(); clock=Clock()
        report=api.run_measurement_experiment(session, 12, **self.opts(clock))
        self.assertEqual(session.state, 'closed')
        self.assertTrue(report['cleanup']['closeReturned'])

if __name__ == '__main__': unittest.main()
