"""Bounded source-backed sender for immutable native Joy job programs.

This executes only the normal single-tool setup/data/drain subset. It borrows,
never opens or cleans up, the caller's retained session. Acknowledgements and
status predicates are protocol observations, not physical completion claims.
"""
from __future__ import annotations
from dataclasses import dataclass
import math
import struct
import time

from joy_alignment_session import _Budget, _Stream, OperationCancelled, OperationDeadline, MaterialLost
from joy_measurement_experiment import BorrowerStreamState, _validate_control_reply
from joy_job_program import NativeJobProgram, JobPass, JobPath
from joy_protocol import clear_frame, request
from joy_selected_status import project_selected_status
from joy_tool_return import ORIGIN_RETURN_RECORDS, ORIGIN_RETURN_FRAME


class ExceptionJobRejected(RuntimeError):
    """Admission or unsupported protocol branch rejected before unsafe progress."""


@dataclass(frozen=True)
class JobExecutionResult:
    outcome: str
    accepted_records: int
    completed_passes: int
    physical_completion_verified: bool = False
    motion_stopped_verified: bool = False
    diagnostic_capture_incomplete: bool = False
    return_to_origin: str = 'protocol_complete'


def _validate(program):
    if type(program) is not NativeJobProgram:
        raise ExceptionJobRejected('Exact compiled NativeJobProgram required')
    if type(program.material_id) is not int or not 0 <= program.material_id <= 0xffffffff:
        raise ExceptionJobRejected('Invalid material identifier')
    if type(program.tool) is not str or not program.tool or type(program.operation) is not str or not program.operation:
        raise ExceptionJobRejected('Invalid selected tool or operation')
    if type(program.coordinate_frame) is not str or not program.coordinate_frame:
        raise ExceptionJobRejected('Invalid coordinate frame')
    if type(program.mat_height_inches) not in (int, float) or not math.isfinite(program.mat_height_inches):
        raise ExceptionJobRejected('Invalid mat height')
    from joy_mat_codec import dimensions
    dimensions(program.mat_height_inches,mat_mode=program.mat_mode)
    if type(program.passes) is not tuple or not 1 <= len(program.passes) <= 32:
        raise ExceptionJobRejected('Invalid pressure passes')
    total = 0
    for p in program.passes:
        if type(p) is not JobPass or type(p.pressure_request) is not int or not 1 <= p.pressure_request <= 65535:
            raise ExceptionJobRejected('Invalid pass')
        if type(p.configuration_bodies) is not tuple or len(p.configuration_bodies) != 3:
            raise ExceptionJobRejected('Expected explicit settings profile')
        if tuple(type(b) is bytes and 1 < len(b) <= 512 and b[0] == op for b, op in zip(p.configuration_bodies,(0x30,0x31,0x3e))) != (True,True,True):
            raise ExceptionJobRejected('Malformed settings bodies')
        if type(p.paths) is not tuple or not p.paths:
            raise ExceptionJobRejected('No paths')
        for path in p.paths:
            if type(path) is not JobPath or type(path.path_id) is not str or not path.path_id:
                raise ExceptionJobRejected('Invalid path')
            if type(path.records) is not tuple or not path.records:
                raise ExceptionJobRejected('Empty path')
            for record in path.records:
                if type(record) is not bytes or len(record) != 9 or record[0] not in (0,1,2):
                    raise ExceptionJobRejected('Invalid native record')
                x, y = struct.unpack('<ff', record[1:])
                if not math.isfinite(x) or not math.isfinite(y):
                    raise ExceptionJobRejected('Non-finite native coordinate')
            total += len(path.records)
            if total > 12000:
                raise ExceptionJobRejected('Record budget exceeded')
    if program.tool=='fine_point_blade':
        ids=tuple(path.path_id for path in program.passes[0].paths)
        if program.operation!='cut' or len(set(ids))!=len(ids) or any(
                tuple(path.path_id for path in step.paths)!=ids for step in program.passes):
            raise ExceptionJobRejected('Blade objects must match across every pressure pass')
    return total


def run_job_program(*, session, program, borrower_stream_state, motion_approved,
        tool_confirmed, timeout=60, clock=time.monotonic, sleep=time.sleep,
        cancelled=lambda: False, on_stage=lambda stage: None,
        on_progress=lambda value: None, on_diagnostic=lambda *args, **kwargs: None,
        max_status_polls=600, initial_batch_limit=56, pause_requested=lambda: False):
    """Run the positive-only normal job flow on a caller-owned retained session."""
    if motion_approved is not True or tool_confirmed is not True:
        raise ExceptionJobRejected('Fresh motion approval and explicit tool confirmation required')
    _validate(program)
    if program.coordinate_frame != ORIGIN_RETURN_FRAME:
        raise ExceptionJobRejected('Origin return requires the admitted job coordinate frame')
    if type(max_status_polls) is not int or not 1 <= max_status_polls <= 1000:
        raise ExceptionJobRejected('Invalid poll limit')
    if type(initial_batch_limit) is not int or not 1 <= initial_batch_limit <= 56:
        raise ExceptionJobRejected('Invalid initial batch limit')
    if type(borrower_stream_state) is not BorrowerStreamState or not borrower_stream_state._bound or borrower_stream_state._invalidated:
        raise ExceptionJobRejected('Usable caller-bound stream guard required')
    result = getattr(session, 'result', None)
    if getattr(session, 'state', None) != 'ready' or result is None or result.selector != 8.164000001 or result.used_fallback is not False:
        raise ExceptionJobRejected('Exact initialized non-fallback Joy session required')
    try:
        timeout_number = float(timeout)
    except (TypeError, ValueError, OverflowError):
        raise ExceptionJobRejected('Invalid timeout') from None
    if type(timeout) is bool or not math.isfinite(timeout_number) or not 0 < timeout_number <= 600:
        raise ExceptionJobRejected('Timeout outside host resource bound')
    if not callable(pause_requested):
        raise ExceptionJobRejected('Pause callback required')
    def pause_flag():
        value = pause_requested()
        if type(value) is not bool:
            raise ExceptionJobRejected('Pause must return an explicit boolean')
        return value
    pause_flag()  # Invalid control callbacks must fail before ANY device I/O.
    budget = _Budget(timeout_number, clock, cancelled, sleep, cap=600)
    stream = _Stream(session, borrower_stream_state, budget, None, on_diagnostic=on_diagnostic, stage='setting_up')
    observers_incomplete = False

    def observe(fn, *args):
        nonlocal observers_incomplete
        try: fn(*args)
        except Exception: observers_incomplete = True

    def stage(name):
        stream.stage = name
        observe(on_stage, name)

    def status():
        snap = stream.presence()
        raw = snap.shared
        if raw.raw_status_11 & 0x01 or raw.native_slot_78:
            raise ExceptionJobRejected('Unsupported error or pause/status branch')
        return snap

    def ack(body):
        checkpoint()
        if body[0] in (0x30, 0x31, 0x3e):
            stream.exchange(clear_frame(body), lambda payload: _validate_control_reply(body[0], body, payload))
            return initial_batch_limit
        response = stream.exchange(clear_frame(body), lambda payload, opcode=body[0]: _parse_ack(payload, opcode))
        if not response[0]:
            raise ExceptionJobRejected('Negative acknowledgement; no retry or replay')
        if body[0] == 0x43:
            flags_b, flags_c = response[1], response[2]
            if flags_b & 0x60 or flags_c & 0x02:
                raise ExceptionJobRejected('Unsupported feedback branch; no replay')
            return max(1, min(initial_batch_limit, response[3] or 1))
        return initial_batch_limit

    accepted, completed, next_limit = 0, 0, initial_batch_limit

    def drain(stage_name='draining'):
        stage(stage_name)
        for _ in range(max_status_polls):
            snap = status()
            stream.exchange(clear_frame(b'\x73'), _parse_interface)
            # dd338: raw slot70 is a WAIT condition, not an error. Interface
            # counters are telemetry only; never turn them into an empty flag.
            if not (snap.shared.raw_status_11 & 0x02) and snap.native_slot_98:
                break
            budget.pause(.05)
        else:
            raise OperationDeadline('Drain poll budget exhausted')
        for _ in range(max_status_polls):
            snap = status()
            if not (snap.shared.raw_status_11 & 0x02) and snap.native_slot_90 and snap.native_slot_98:
                return
            budget.pause(.05)
        raise OperationDeadline('Final status poll budget exhausted')

    def checkpoint(*, already_drained=False):
        # Application scheduling only: never a native pause/lift/stop command.
        # Called only outside exchanges; a consumed positive ACK advances the
        # cursor BEFORE this gate, and resume cannot resend that accepted slice.
        if not pause_flag():
            return
        previous_stage = stream.stage
        if already_drained:
            stage('pausing')
        else:
            drain('pausing')
        stage('paused')
        for _ in range(max_status_polls):
            if not pause_flag():
                break
            status()  # Still-owned healthy stream; material/error checks only.
            budget.pause(.25)  # Whole job deadline CONTINUES; no infinite wait.
        else:
            if pause_flag():
                raise OperationDeadline('Queue pause poll budget exhausted')
        budget.remaining()  # Resume cannot override cancel/expiry.
        stage(previous_stage)

    # Native075890 first invokes dda40 before End22/configuration. Requiring a
    # fresh read-only drain also avoids relying on a stale loader-ready snapshot.
    drain()
    checkpoint(already_drained=True)
    # Preserve each pressure's compiled records/settings, but finish a blade
    # object before travelling to the next. Pen scheduling remains pass-major.
    if program.tool=='fine_point_blade':
        last_object=len(program.passes[0].paths)-1
        units=((step,(step.paths[index],),index==last_object)
               for index in range(last_object+1) for step in program.passes)
    else:
        units=((step,step.paths,True) for step in program.passes)
    for pass_item,paths,completes_pass in units:
        stage('setting_up')
        status()
        ack(b'\x22\0\0\0')
        for body in pass_item.configuration_bodies:
            status(); ack(body)
        status(); ack(b'\x21\0\0\0')
        stage('sending')
        for path in paths:
            cursor = 0
            while cursor < len(path.records):
                checkpoint()
                status()
                batch = path.records[cursor:cursor + next_limit]
                next_limit = ack(b'\x43' + b''.join(batch))
                cursor += len(batch); accepted += len(batch)
                observe(on_progress, {'pathId':path.path_id,'acceptedRecords':accepted,
                                      'completedPasses':completed})
                checkpoint()
        # ACK acceptance is NOT drain/completion. Do not reset the profile for
        # another pressure pass until the normal source predicates have cleared.
        drain()
        checkpoint(already_drained=True)
        # Global progress counts recipe passes drained for EVERY object; it
        # must not become object_count * pass_count or reset between objects.
        if completes_pass:completed += 1
        observe(on_progress, {'acceptedRecords':accepted,'completedPasses':completed})
        budget.remaining()

    # Source deb90: a move-only path, not unload or coordinate-origin reset.
    # ALL pressure passes are drained first; these records are not drawing data.
    stage('returning_to_origin')
    observe(on_progress, {'returnToOrigin':'running','acceptedRecords':accepted,'completedPasses':completed})
    status(); ack(b'\x21\0\0\0')
    cursor=0
    while cursor<len(ORIGIN_RETURN_RECORDS):
        status()
        batch=ORIGIN_RETURN_RECORDS[cursor:cursor+next_limit]
        next_limit=ack(b'\x43'+b''.join(batch));cursor+=len(batch)
    status();ack(b'\x22\0\0\0')
    for _ in range(max_status_polls):
        snap=status()
        if not (snap.shared.raw_status_11 & 0x02) and snap.native_slot_90 and snap.native_slot_98:
            break
        budget.pause(.05)
    else:raise OperationDeadline('Origin return status poll budget exhausted')
    budget.remaining()
    observe(on_progress, {'returnToOrigin':'protocol_complete','acceptedRecords':accepted,'completedPasses':completed})

    return JobExecutionResult('protocol_completion_observed_unverified', accepted, completed,
        diagnostic_capture_incomplete=stream.diagnostic_capture_incomplete or observers_incomplete)


def _parse_ack(payload, expected):
    if type(payload) is not bytes or len(payload) not in (5,7,8) or payload[1] != expected:
        raise ValueError('Malformed or wrong-tag job acknowledgement')
    if payload[0] == 0 and len(payload) == 5:
        return True, payload[2], payload[3], payload[4]
    if payload[0] == 1 and len(payload) in (7,8):
        return False, payload[2], payload[3], payload[4]
    raise ValueError('Invalid job acknowledgement')


def _parse_interface(payload):
    if type(payload) is not bytes or len(payload) != 6 or payload[0] != 0x73:
        raise ValueError('Malformed interface-state response')
    return payload[1:]
