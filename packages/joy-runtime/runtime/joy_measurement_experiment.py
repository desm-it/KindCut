"""Explicit developer measurement experiment, NOT normal app loading support.

No discovery/open/import/startup effects. Caller supplies an exclusive initialized
Joy session. Requires fresh motion approval AND operator-confirmed removal of
blade housing. The profile below is a statically source-derived model-12 NORMAL
MAT fallback (tooltype 4 / ART_DRAW 2), including Joy's native motion/geometry
fallbacks and wire conversions. It is not captured traffic, a recovered cached
material override, or physically validated. Positive cached MAT overrides are a
separate path and are not synthesized here. No cut/path/job opcodes.

Model completion means typed measurement evidence ONLY. Cleanup attempts abort,
then ED01 and close; none proves rollers stopped or mat position. This explicit
experimental route is not normal loading or ordinary tool/material presets.

Injected clock, cancellation provider and telemetry callbacks are trusted caller
functions: they must return promptly without device I/O. Sleep must honor its
requested duration; session/channel operations must honor their I/O timeouts.
Deadlines are cooperative, not hard bounds against a contract-violating dependency.
"""
import struct
import time
import math
from contextlib import contextmanager
from typing import NotRequired, TypedDict
from joy_protocol import clear_frame, parse_status, request
from joy_mat_codec import dimensions, measurement_request, parse_measurement



def measurement_profile(height_inches, *, mat_mode=0):
    dimensions(height_inches,mat_mode=mat_mode)  # Exact supported-size/type validation.
    # Native 05168c flags: DrawBool contributes 0x80; additional bit is 0x08.
    # The caller's Mat pair is (height, 4.0); width clamp 4.8 and dimensions use
    # FCVTPS (ceil), so 4.8 -> 5 and a 6.5-inch height -> 7.
    machine = bytes([0x30, 0x88, 0, 0, 5, math.ceil(height_inches), 0, 0, 0, 0, 2, 0, 0])
    # Joy12 fallback X/Y[cutVel,moveVel,cutAcc,moveAcc]=[3,3,10,10].
    # Z-A/Z-B=[4,4,20,38.599998474121094]; theta=[10,10,25,250].
    # Native 051... performs F32 multiply by 100 then FCVTAS (nearest, ties away).
    def native_scaled(value):
        f32 = struct.unpack('<f', struct.pack('<f', value))[0]
        product_f32 = struct.unpack('<f', struct.pack('<f', f32 * 100.0))[0]
        return math.floor(product_f32 + 0.5)  # All source fallback values are positive.

    groups = (
        (3.0, 3.0, 4.0, 4.0, 10.0),
        (3.0, 3.0, 4.0, 4.0, 10.0),
        (10.0, 10.0, 20.0, 20.0, 25.0),
        (10.0, 10.0, 38.599998474121094, 38.599998474121094, 250.0),
    )
    values = tuple(native_scaled(v) for group in groups for v in group)
    speed = bytes([0x31]) + b'\x0f' * 5 + struct.pack('>20H', *values)
    # 3E slot0 selects geometry flags02; remaining geometry values/nodes are 0.
    geometry = b'\x3e\x00\x02' + bytes(17)
    return tuple(clear_frame(p) for p in (machine, speed, geometry))


class _Cancelled(Exception):
    pass


class CleanupReport(TypedDict):
    abortSent: bool
    abortReplyAccepted: bool
    disarmSent: bool
    disarmReplyReceived: bool
    closeReturned: bool
    disarmSkippedReason: NotRequired[str]


class ExperimentReport(TypedDict):
    outcome: str
    physicalLoadingVerified: bool
    motionStoppedVerified: bool
    controlRepliesOpaque: bool
    cleanup: CleanupReport
    measuredInches: NotRequired[float]
    measurementStartAcknowledged: NotRequired[bool]
    initiallyMeasuredInches: NotRequired[float]
    error: NotRequired[str]
    captureIncomplete: NotRequired[bool]


class BorrowerStreamState:
    """One-shot trusted borrower signal, not a lock or ownership capability.

    Invalidate before leaving the borrower scope after any uncertain I/O. The
    signal is irreversible/idempotent through this API and performs no I/O.
    The caller must serialize use; concurrent mutation is not supported.
    """
    def __init__(self):
        self._invalidated = False
        self._bound = False

    def invalidate(self):
        self._invalidated = True


class MeasurementScopeFailed(Exception):
    def __init__(self, report):
        super().__init__('Measurement scope did not complete')
        self.report = report


@contextmanager
def measured_session_scope(session, height_inches, *, mat_mode=0, motion_approved=False,
                               blade_removed_confirmed=False, timeout=45,
                               hold_ready_seconds=10,
                               clock=time.monotonic, sleep=time.sleep,
                               cancelled=lambda: False, on_stage=lambda stage: None,
                               on_trace=lambda packet, reply: None,
                               on_diagnostic=lambda *args, **kwargs: None,
                               borrower_stream_state=None):
    """Borrow an initialized caller-owned session through observation only.

    This does not acquire or verify exclusive ownership and adds no channel
    mutex; the caller must own and serialize all use of the session/channel.
    Yields only successful measurement evidence, then always runs bounded cleanup.
    The report's physical-loading and stopped-motion fields remain unverified.
    """
    if borrower_stream_state is not None:
        if type(borrower_stream_state) is not BorrowerStreamState:
            raise TypeError('borrower_stream_state must be BorrowerStreamState or None')
        if borrower_stream_state._bound or borrower_stream_state._invalidated:
            raise ValueError('Borrower stream state is invalid or already bound')
        borrower_stream_state._bound = True
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 45:
        raise ValueError('timeout must be finite numeric seconds greater than 0 and at most 45')

    if (isinstance(hold_ready_seconds, bool) or not isinstance(hold_ready_seconds, (int, float))
            or not math.isfinite(hold_ready_seconds) or not 0 <= hold_ready_seconds <= 30):
        raise ValueError('hold_ready_seconds must be finite numeric seconds from 0 through 30')
    if motion_approved is not True or blade_removed_confirmed is not True:
        raise PermissionError('Fresh approval and physically removed blade housing required')
    result = getattr(session, 'result', None)
    if (session.state != 'ready' or result is None
            or result.selector != 8.164000001 or result.used_fallback is not False):
        raise ValueError('Only the initialized, previously observed original-Joy selector is allowed')
    profile = measurement_profile(height_inches,mat_mode=mat_mode)
    dim = dimensions(height_inches,mat_mode=mat_mode)
    arm, disarm = clear_frame(b'\xed\x02'), clear_frame(b'\xed\x01')
    abort = clear_frame(b'\x68\xff')
    led_wait, led_ready = clear_frame(b'\x79\x04'), clear_frame(b'\x79\x02')
    begin, query = measurement_request(height_inches), measurement_request(0)
    status_request = request('status')
    allowed = frozenset((*profile, dim, arm, disarm, abort, led_wait, led_ready, begin, query, status_request))
    start = clock()
    deadline = start + timeout
    armed = False
    channel_usable = True
    report: ExperimentReport = {
        'outcome': 'failed', 'physicalLoadingVerified': False,
        'motionStoppedVerified': False, 'controlRepliesOpaque': True,
        'cleanup': {'abortSent': False, 'abortReplyAccepted': False, 'disarmSent': False, 'disarmReplyReceived': False, 'closeReturned': False},
    }
    report['measurementStartAcknowledged'] = False
    report['captureIncomplete'] = False

    def diagnostic(stage_name, tx=None, rx=None, error=None, *, started=None,
                   kind='exchange', code=None):
        try:
            on_diagnostic(stage_name, tx, rx, error, started=started, kind=kind, code=code)
        except Exception:
            report['captureIncomplete'] = True

    current_stage = ['checking_precheck']
    def stage(value):
        current_stage[0] = value
        diagnostic(value, kind='stage')
        on_stage(value)

    def left():
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError('Measurement experiment deadline')
        return remaining

    def checkpoint():
        if cancelled():
            raise _Cancelled()
        left()

    def exchange(packet):
        nonlocal channel_usable
        checkpoint()
        if packet not in allowed:
            raise ValueError('Packet is outside the fixed experiment recipe')
        started = clock()
        try:
            session.channel.send(packet, encrypted=True, timeout=min(2, left()))
        except Exception as error:
            diagnostic(current_stage[0], packet, None, error, started=started, code='send_failed')
            channel_usable = False
            raise
        try:
            frame = session.channel.receive(min(2, left()), require_encrypted=True)
        except Exception as error:
            diagnostic(current_stage[0], packet, None, error, started=started, code='receive_failed')
            channel_usable = False
            raise
        # Capture the exact reply before frame or semantic validation.
        diagnostic(current_stage[0], packet, frame, started=started)
        if len(frame) < 3 or int.from_bytes(frame[:2], 'big') != len(frame) - 2:
            error = ValueError('Malformed normalized response frame')
            diagnostic(current_stage[0], packet, frame, error, started=started, code='malformed_reply')
            channel_usable = False
            raise error
        payload = frame[2:]
        on_trace(packet, payload)
        checkpoint()
        return payload

    def control(packet):
        payload = exchange(packet)
        op = packet[2]
        _validate_control_reply(op, packet[2:], payload)

    def cleanup_stage(name):
        # Observability failure must not prevent best-effort stop/close.
        try:
            diagnostic(name, kind='cleanup')
            on_stage(name)
        except Exception:
            pass

    try:
        stage('configuring')
        control(dim); control(led_wait)
        armed = True
        control(arm)
        stage('waiting_for_mat')
        while True:
            if cancelled(): raise _Cancelled()
            status = parse_status(exchange(status_request), include_extra=False)
            if status['status_byte_2'] & 1: break
            sleep(min(.2, left()))
        stage('gripped')
        control(led_ready); sleep(.5); control(led_ready)
        stage('query_precheck')
        # eb674 consumes float+18 and ERROR flag+1d, not raw state+1c.
        # _parse_query raises on the explicit error prefix; never busy-poll
        # a byte whose enum/firmware meaning has not been established.
        _, length = _parse_query(exchange(query))
        report['initiallyMeasuredInches'] = length
        report['measuredInches'] = length
        presence=parse_status(exchange(status_request),include_extra=False)
        if presence['status_byte_2'] & 1 == 0: raise ValueError('Mat presence lost after precheck')
        if length + .001 >= height_inches:
            report['outcome']='precheck_already_satisfied'
        else:
            status=parse_status(exchange(status_request),include_extra=False)
            if status['status_byte_2'] & 1 == 0: raise ValueError('Mat presence lost before profile')
            for packet in profile: control(packet)
            stage('starting_measurement')
            status=parse_status(exchange(status_request),include_extra=False)
            if status['status_byte_2'] & 1 == 0: raise ValueError('Mat presence lost before measurement start')
            start_reply=exchange(begin)
            if not _valid_start_reply(start_reply): raise ValueError('Rejected measurement start response')
            report['measurementStartAcknowledged']=True
            stage('measuring_y')
            stage('polling_measurement')
            prior=length; stalled=clock()
            while True:
                if cancelled(): raise _Cancelled()
                status=parse_status(exchange(status_request),include_extra=False)
                if status['status_byte_2'] & 1 == 0: raise ValueError('Mat presence lost during measurement')
                _,length=_parse_query(exchange(query)); report['measuredInches']=length
                if length != prior: prior=length; stalled=clock()
                elif clock()-stalled >= 3: raise TimeoutError('Measurement progress stalled')
                if length + .001 >= height_inches: break
                sleep(min(.2,left()))
            stage('finishing_measurement')
            finish=max(0,int((height_inches/3)*1000))/1000
            finish_end=clock()+finish
            while clock()<finish_end:
                if cancelled(): raise _Cancelled()
                status=parse_status(exchange(status_request),include_extra=False)
                if status['status_byte_2'] & 1 == 0: raise ValueError('Mat presence lost during finishing wait')
                sleep(min(.1,max(0,finish_end-clock()),left()))
            checkpoint()
            report['outcome']='measurement_complete'
        if report['outcome'] in ('measurement_complete','precheck_already_satisfied'):
            checkpoint()
            stage('ready_for_observation')
            checkpoint()
            hold_deadline=min(deadline,clock()+hold_ready_seconds)
            while clock()<hold_deadline:
                if cancelled(): raise _Cancelled()
                status=parse_status(exchange(status_request),include_extra=False)
                if status['status_byte_2'] & 1 == 0: raise ValueError('Mat-presence status lost during observation hold')
                sleep(min(.2,max(0,hold_deadline-clock()),left()))
            checkpoint()
    except _Cancelled as error:
        diagnostic(current_stage[0], error=error, kind='failure', code='cancelled')
        report['outcome'] = 'cancelled'
        raise MeasurementScopeFailed(report) from None
    except TimeoutError as error:
        diagnostic(current_stage[0], error=error, kind='failure', code='deadline')
        report['outcome'] = 'timeout'
        raise MeasurementScopeFailed(report) from None
    except Exception as error:
        diagnostic(current_stage[0], error=error, kind='failure', code='operation_failed')
        report['outcome'] = 'failed'
        report['error'] = type(error).__name__  # Never surface arbitrary transport text/identifiers.
        raise MeasurementScopeFailed(report) from None
    else:
        if report['outcome'] not in ('measurement_complete', 'precheck_already_satisfied'):
            raise MeasurementScopeFailed(report)
        # Borrow the caller-owned initialized session; caller serializes channel use.
        yield report
    finally:
        # Reserve bounded cleanup time even after the operation deadline. Do not
        # consult cancellation here: it must not suppress the stop/disarm attempt.
        cleanup_deadline = clock() + 8

        def cleanup_left():
            remaining = cleanup_deadline - clock()
            if remaining <= 0:
                raise TimeoutError('Cleanup I/O deadline')
            return min(2, remaining)

        borrower_invalidated = borrower_stream_state is not None and borrower_stream_state._invalidated
        if borrower_invalidated:
            channel_usable = False
        if armed and channel_usable:
            cleanup_stage('aborting')
            cleanup_started = clock()
            try:
                session.channel.send(abort, encrypted=True, timeout=cleanup_left())
                report['cleanup']['abortSent'] = True
                frame = session.channel.receive(cleanup_left(), require_encrypted=True)
                diagnostic('aborting', abort, frame, started=cleanup_started, kind='cleanup')
                if len(frame) >= 3 and int.from_bytes(frame[:2], 'big') == len(frame)-2:
                    payload = frame[2:]
                    report['cleanup']['abortReplyAccepted'] = len(payload) in (5,7,8) and payload[0] == 0 and payload[1] == 0x68
                    try:
                        on_trace(abort, payload)
                    except Exception:
                        pass
                if not report['cleanup']['abortReplyAccepted']:
                    raise ValueError('Uncertain abort exchange; discard stream')
            except Exception as error:
                diagnostic('aborting', abort, None, error, started=cleanup_started,
                           kind='cleanup', code='cleanup_failed')
                channel_usable = False
                report['cleanup']['abortReplyAccepted'] = False
        if armed and channel_usable:
            cleanup_stage('disarming')
            cleanup_started = clock()
            try:
                session.channel.send(disarm, encrypted=True, timeout=cleanup_left())
                report['cleanup']['disarmSent'] = True
                frame = session.channel.receive(cleanup_left(), require_encrypted=True)
                diagnostic('disarming', disarm, frame, started=cleanup_started, kind='cleanup')
                report['cleanup']['disarmReplyReceived'] = frame == clear_frame(bytes.fromhex('00ed0501ff'))
                if len(frame) >= 2:
                    try:
                        on_trace(disarm, frame[2:])
                    except Exception:
                        pass
            except Exception as error:
                diagnostic('disarming', disarm, None, error, started=cleanup_started,
                           kind='cleanup', code='cleanup_failed')
                report['cleanup']['disarmReplyReceived'] = False
        elif armed:
            report['cleanup']['disarmSkippedReason'] = ('borrowed_stream_unusable'
                if borrower_invalidated else 'channel_unusable')
            cleanup_stage('cleanup_unavailable')
        cleanup_stage('closing')
        try:
            session.close()
            report['cleanup']['closeReturned'] = True
            diagnostic('closing', kind='cleanup', code='close_returned')
        except Exception as error:
            report['cleanup']['closeReturned'] = False
            diagnostic('closing', error=error, kind='cleanup', code='close_failed')
    return report


def run_measurement_experiment(session, height_inches, *, motion_approved=False,
                               blade_removed_confirmed=False, timeout=45,
                               hold_ready_seconds=10, clock=time.monotonic,
                               sleep=time.sleep, cancelled=lambda: False,
                               on_stage=lambda stage: None,
                               on_trace=lambda packet, reply: None):
    """Legacy bounded experiment; report is returned only after cleanup/close."""
    try:
        with measured_session_scope(
                session, height_inches, motion_approved=motion_approved,
                blade_removed_confirmed=blade_removed_confirmed, timeout=timeout,
                hold_ready_seconds=hold_ready_seconds, clock=clock, sleep=sleep,
                cancelled=cancelled, on_stage=on_stage, on_trace=on_trace) as report:
            pass
    except MeasurementScopeFailed as failure:
        return failure.report
    return report


def _validate_control_reply(opcode, request_payload, payload):
    """Validate host-level response shape only; never interpret profile body values."""
    if payload.startswith(b'\x01'):
        raise ValueError('Explicit error response')
    # Native dimensions/profile/sensor handlers are no-ops; LED drops its
    # payload without consuming details. 0x11 vtable
    # 100433968+40 -> 100035d58; 30/31/3e bindings are in frame-contracts.md.
    # A positive correlated five-byte envelope is a stricter HOST policy,
    # not a vendor guarantee that settings were applied. Details are opaque.
    if opcode in (0x11, 0x79, 0xed, 0x30, 0x31, 0x3e) and len(payload) == 5 and payload[:2] == bytes([0, opcode]):
        return True
    generic = bytes([0, opcode, 5, 1, 255])
    if payload == generic:
        return True
    if len(payload) == len(request_payload) and payload and payload[0] == opcode:
        return True
    raise ValueError('Malformed, mismatched, or unrecognized control response')


def _parse_query(payload):
    """Return (error=False, raw float), not a guessed busy flag.

    Native 0483a8 removes prefix, stores the next byte at+1c, then reads
    four BE float bytes (zero-padding if short). eb674 checks error+1d,
    ignores+1c and compares the length with a +.001 adjustment. The caller
    applies that adjustment at target comparisons, retaining raw diagnostics.
    The accepted envelopes and 24-inch mat bound remain stricter HOST policy.
    A padded field is not proof of actual measured material or completion.
    """
    if type(payload) is not bytes or len(payload) not in (5,6,9):
        raise ValueError('Malformed EE progress response')
    if payload[0] == 1:
        raise ValueError('Explicit EE measurement error')
    if payload[0] not in (0,0xee) or (len(payload)==5 and payload[:2]!=b'\x00\xee'):
        raise ValueError('Mismatched EE progress response')
    length=struct.unpack('>f',payload[2:6].ljust(4,b'\x00'))[0]
    lower_ok=length>=0 or (len(payload)==5 and length+.001>=0)
    if not math.isfinite(length) or not lower_ok or length>24:
        raise ValueError('Invalid EE progress length')
    return False,length


def _valid_start_reply(payload):
    # ebba0 tests command execution only and discards response float/state.
    # Keep a correlated positive ACK or bounded typed envelope; never require
    # invented detail constants or use START's fields as measured progress.
    if type(payload) is not bytes or not payload or payload[0]==1:
        return False
    if len(payload)==5:
        return payload[:2]==b'\x00\xee'
    return len(payload) in (6,9) and payload[0] in (0,0xee)
