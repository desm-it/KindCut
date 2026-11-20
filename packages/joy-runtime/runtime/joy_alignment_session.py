"""Bounded fixed-position experiment; no discovery, open, job or readiness claim."""
from __future__ import annotations
from dataclasses import dataclass
import math
import time
from joy_measurement_experiment import BorrowerStreamState
from joy_protocol import clear_frame, request
from joy_alignment import build_alignment_candidate
from joy_draw_reply import parse_draw_ack_body
from joy_selected_status import project_selected_status


class OperationDeadline(TimeoutError):
    pass


class OperationCancelled(InterruptedError):
    pass


class MaterialLost(RuntimeError):
    pass


def _finite(value):
    if type(value) not in (int, float):
        raise ValueError('Expected finite non-bool clock seconds.')
    try:
        value = float(value)
    except OverflowError:
        raise ValueError('Clock seconds exceed range.') from None
    if not math.isfinite(value):
        raise ValueError('Expected finite clock seconds.')
    return value


class _Budget:
    """Cooperative deadlines: callbacks must return promptly; no thread interruption."""
    def __init__(self, timeout, clock, cancelled, sleep=time.sleep, *, cap=60):
        timeout = _finite(timeout)
        if not 0 < timeout <= cap:
            raise ValueError('timeout outside local admission range')
        if not all(callable(f) for f in (clock, cancelled, sleep)):
            raise TypeError('clock, cancellation and sleep callbacks required')
        self.clock, self.cancelled, self.sleep = clock, cancelled, sleep
        self.last = _finite(clock())
        self.end = self.last + timeout
        if not math.isfinite(self.end):
            raise ValueError('Deadline exceeds range')

    def remaining(self):
        flag = self.cancelled()
        if type(flag) is not bool:
            raise ValueError('Cancellation must return an explicit boolean')
        if flag:
            raise OperationCancelled('cancelled')
        now = _finite(self.clock())
        if now < self.last:
            raise ValueError('Monotonic clock moved backwards')
        self.last = now
        if now >= self.end:
            raise OperationDeadline('deadline exceeded')
        return self.end - now

    def pause(self, seconds=.1):
        self.sleep(min(seconds, self.remaining()))
        self.remaining()


class _Stream:
    """One synchronous request/reply. In-flight or parsing uncertainty poisons scope."""
    def __init__(self, session, guard, budget, material_present, *,
                 on_diagnostic=lambda *args, **kwargs: None, stage='positioning'):
        self.session, self.guard, self.budget, self.material_present = session, guard, budget, material_present
        self.sent = 0
        self.on_diagnostic, self.stage = on_diagnostic, stage
        self.diagnostic_capture_incomplete = False

    def observe(self, tx=None, rx=None, error=None, **metadata):
        try:
            self.on_diagnostic(self.stage, tx, rx, error, **metadata)
        except Exception:
            # Diagnostics must never poison an otherwise valid device stream.
            self.diagnostic_capture_incomplete = True

    def exchange(self, packet, parser):
        timeout = min(1.0, self.budget.remaining())
        if self.guard._invalidated or self.session.state != 'ready':
            self.guard.invalidate()
            raise ConnectionError('Borrowed session is no longer usable')
        started, raw, step = self.budget.last, None, 'send'
        try:
            self.sent += 1
            self.session.channel.send(packet, encrypted=True, timeout=timeout)
            step = 'receive'
            # A stop/error here leaves a request in flight: close-only cleanup.
            raw = self.session.channel.receive(min(1.0, self.budget.remaining()), require_encrypted=True)
            self.observe(packet, raw, started=started, kind='exchange')
            step = 'parse'
            if (type(raw) is not bytes or len(raw) < 2 or len(raw) > 514 or
                    raw[0] & 0x80 or int.from_bytes(raw[:2], 'big') != len(raw)-2):
                raise ValueError('Malformed normalized response frame')
            parsed = parser(raw[2:])
        except BaseException as error:
            self.observe(packet, raw, error, started=started,
                         kind='failure' if step == 'parse' else 'io_error',
                         code={'send':'send_failed','receive':'receive_failed','parse':'malformed_reply'}[step])
            self.guard.invalidate()
            raise
        # A fully consumed valid late/cancel reply does NOT poison the stream.
        try:
            self.budget.remaining()
        except BaseException as error:
            self.observe(error=error, kind='failure')
            raise
        return parsed

    def presence(self):
        try:
            return self._presence()
        except BaseException as error:
            self.observe(error=error, kind='failure',
                         code='material_absent' if isinstance(error, MaterialLost) else None)
            raise

    def _presence(self):
        self.budget.remaining()
        # Optional trusted external interlock. The actual wire-status presence
        # observation below is ALWAYS required, including worker-owned loading.
        if self.material_present is not None:
            present = self.material_present()
            if type(present) is not bool:
                raise ValueError('Material callback must return an explicit boolean')
            self.budget.remaining()
            if not present:
                raise MaterialLost('material absent')
        status = self.exchange(request('status'), lambda body: project_selected_status(body, context_byte_8=0))
        if not status.shared.raw_status_12 & 1:
            raise MaterialLost('material presence status lost')
        if status.shared.effective_error_u32:
            raise RuntimeError('Device reported an error during positioning')
        return status


@dataclass(frozen=True)
class AlignmentSessionResult:
    outcome: str
    physical_alignment_verified: bool = False
    sent_requests: int = 0
    accepted_requests: int = 0
    negative_error_u8: int | None = None
    diagnostic_capture_incomplete: bool = False


def run_post_measurement_alignment(*, session, borrower_stream_state: BorrowerStreamState,
        material_present, cancelled=lambda: False, motion_approved: bool,
        blade_removed_confirmed: bool, measurement_report: dict, point_mode: str,
        context_byte_8: int, timeout=5.0, clock=time.monotonic, sleep=time.sleep,
        max_status_polls=100, on_diagnostic=lambda *args, **kwargs: None):
    """Exact fixed source candidate; only caller-owned measured scope is admitted.

    The bound guard is a trusted caller precondition, not active-session identity
    or exclusivity proof. No raw native return value is invented from an ACK.
    Post-End polling uses the stricter local wire-getter conjunction90&&98,
    not native host-global overrides. Even this observation is NOT alignment proof.
    """
    if motion_approved is not True or blade_removed_confirmed is not True:
        raise PermissionError('Fresh motion approval and housing removal required')
    if type(measurement_report) is not dict or measurement_report.get('outcome') not in (
            'measurement_complete', 'precheck_already_satisfied'):
        raise ValueError('Successful measured-scope diagnostic report required')
    result = getattr(session, 'result', None)
    if (getattr(session, 'state', None) != 'ready' or result is None or
            result.selector != 8.164000001 or result.used_fallback is not False):
        raise ValueError('Initialized exact original-Joy non-fallback session required')
    if (type(borrower_stream_state) is not BorrowerStreamState or
            not borrower_stream_state._bound or borrower_stream_state._invalidated):
        raise ValueError('A usable measured-scope borrower signal is required')
    if type(context_byte_8) is not int or context_byte_8 != 0:
        raise ValueError('Explicit source context zero is required')
    if material_present is not None and not callable(material_present):
        raise TypeError('Material observation callback required')
    if type(max_status_polls) is not int or not 1 <= max_status_polls <= 1000:
        raise ValueError('Status poll count outside local resource bound')
    candidate = build_alignment_candidate(point_mode=point_mode)
    budget = _Budget(timeout, clock, cancelled, sleep, cap=10)
    stream = _Stream(session, borrower_stream_state, budget, material_present, on_diagnostic=on_diagnostic)
    accepted = 0
    for body in candidate.bodies:
        stream.presence()
        ack = stream.exchange(clear_frame(body), lambda payload, op=body[0]: parse_draw_ack_body(payload, op))
        if not ack.acknowledged:
            stream.observe(kind='failure', code='operation_failed')
            return AlignmentSessionResult('negative_ack_no_retry', False, stream.sent, accepted, ack.error_0d, stream.diagnostic_capture_incomplete)
        accepted += 1
    for _ in range(max_status_polls):
        status = stream.presence()
        if status.native_slot_90 and status.native_slot_98:
            budget.remaining()
            return AlignmentSessionResult('alignment_status_observed_unverified', False, stream.sent, accepted, diagnostic_capture_incomplete=stream.diagnostic_capture_incomplete)
        budget.pause()
    raise OperationDeadline('status poll budget exhausted')
