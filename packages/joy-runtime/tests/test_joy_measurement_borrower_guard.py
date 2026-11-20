"""Hardware-free borrower invalidation tests for the measured-session scope."""
import importlib
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
sys.path.insert(0, str(ROOT / 'tests'))
from test_joy_measurement_experiment import Session, Clock
api = importlib.import_module('joy_measurement_experiment')


def open_scope(session, guard=None, **kwargs):
    clock = Clock()
    return api.measured_session_scope(
        session, 12, motion_approved=True, blade_removed_confirmed=True,
        clock=clock, sleep=clock.sleep, hold_ready_seconds=0,
        borrower_stream_state=guard, **kwargs)


class BorrowerGuardTests(unittest.TestCase):
    def test_healthy_guard_keeps_normal_cleanup(self):
        guard = api.BorrowerStreamState()
        session = Session()
        with open_scope(session, guard):
            pass
        self.assertEqual([p[2:] for p in session.channel.sent[-2:]], [b'\x68\xff', b'\xed\x01'])

    def test_invalidation_skips_all_cleanup_protocol_sends(self):
        guard = api.BorrowerStreamState()
        session = Session()
        with open_scope(session, guard) as report:
            guard.invalidate()
            sent_at_invalidation = tuple(session.channel.sent)
        self.assertEqual(tuple(session.channel.sent), sent_at_invalidation)
        self.assertEqual(session.state, 'closed')
        self.assertFalse(report['cleanup']['abortSent'])
        self.assertFalse(report['cleanup']['disarmSent'])
        self.assertTrue(report['cleanup']['closeReturned'])
        self.assertEqual(report['cleanup']['disarmSkippedReason'], 'borrowed_stream_unusable')

    def test_borrower_exception_can_invalidate_and_propagates(self):
        guard = api.BorrowerStreamState()
        session = Session()
        sentinel = OSError('borrower stream uncertain')
        sent_at_invalidation: tuple[bytes, ...] = ()
        with self.assertRaisesRegex(OSError, 'borrower stream uncertain') as caught:
            with open_scope(session, guard):
                guard.invalidate()
                sent_at_invalidation = tuple(session.channel.sent)
                raise sentinel
        self.assertIs(caught.exception, sentinel)
        self.assertEqual(tuple(session.channel.sent), sent_at_invalidation)
        self.assertEqual(session.state, 'closed')

    def test_healthy_body_exception_still_runs_cleanup(self):
        guard = api.BorrowerStreamState()
        session = Session()
        with self.assertRaisesRegex(RuntimeError, 'sentinel'):
            with open_scope(session, guard):
                raise RuntimeError('sentinel')
        self.assertEqual([p[2:] for p in session.channel.sent[-2:]], [b'\x68\xff', b'\xed\x01'])

    def test_guard_is_one_scope_only_and_reuse_rejected_without_io(self):
        guard = api.BorrowerStreamState()
        with open_scope(Session(), guard):
            pass
        session = Session()
        with self.assertRaises(ValueError):
            open_scope(session, guard).__enter__()
        self.assertEqual(session.channel.sent, [])
        self.assertEqual(session.state, 'ready')

    def test_invalid_and_preinvalidated_guards_are_rejected_before_io(self):
        invalidated = api.BorrowerStreamState()
        invalidated.invalidate()
        for guard in (False, {}, object(), invalidated):
            with self.subTest(guard_type=type(guard).__name__):
                session = Session()
                with self.assertRaises((TypeError, ValueError)):
                    with open_scope(session, guard):
                        self.fail('Invalid guard must not enter the borrower scope')
                self.assertEqual(session.channel.sent, [])
                self.assertEqual(session.state, 'ready')

    def test_invalidation_is_idempotent_and_performs_no_io(self):
        guard = api.BorrowerStreamState()
        session = Session()
        with open_scope(session, guard):
            before = list(session.channel.sent)
            guard.invalidate(); guard.invalidate()
            self.assertEqual(session.channel.sent, before)

if __name__ == '__main__':
    unittest.main()
