"""Offline deb90 positioning candidate and post-End raw wait condition.

Not an executor, retained loader, physical alignment proof or cut authorization.
No imports/operations that open devices, frame/encrypt/send or own a session.
"""
from dataclasses import dataclass, field
from typing import Literal
from joy_draw_codec import begin_draw_body, end_draw_body, scalar_draw_body
from joy_point_adapter import batch_body_from_internal
from joy_record_transfer import ParserRecord, transfer_records
from joy_selected_status import SelectedJoyStatus, project_selected_status

@dataclass(frozen=True)
class AlignmentCandidate:
    bodies: tuple[bytes, ...]
    point_mode: str
    parser_selector: int = field(default=1,init=False)
    parser_options_word: int = field(default=2,init=False)
    execution: Literal['unsupported'] = field(default='unsupported',init=False)
    physical_alignment_verified: bool = field(default=False,init=False)

@dataclass(frozen=True)
class AlignmentWaitDecision:
    action: str
    native_return_u32: int | None
    status: SelectedJoyStatus
    physical_alignment_verified: bool = field(default=False,init=False)


def build_alignment_candidate(*, point_mode: str) -> AlignmentCandidate:
    """Only the source's fixed initial target(4,.25), not arbitrary move input.

    ebdb4→deb90 builds M288/18, selector1/options2; transfer adds final kind2.
    deb90 itself brackets the dispatcher with ONE Begin and ONE End. c523c
    buffers/dispatches; it does not add another Begin/End. Caller MUST choose
    scalar/batch explicitly; no effective session mode is inferred here.
    Bodies omit mandatory execution/ACK/error/status/time/ownership gates.
    """
    if type(point_mode) is not str or point_mode not in ('scalar','batch'):
        raise ValueError('Explicit scalar or batch point mode required.')
    points = transfer_records((ParserRecord(2,288.,18.),),options_word=2,max_records=2)
    if point_mode == 'batch':
        bodies = (batch_body_from_internal(points,max_points=2),)
    else:
        bodies = tuple(scalar_draw_body(p.kind_bits,p.x_internal,p.y_internal) for p in points)
    return AlignmentCandidate(bodies=(begin_draw_body(),*bodies,end_draw_body()),point_mode=point_mode)


def alignment_wait_condition(payload: bytes, *, continuation_permitted: bool,
                             end_return_u32: int, status_return_u32: int,
                             context_byte_8: int, host_counter_45a4d8: int | None = None,
                             host_flag_45a504: int | None = None) -> AlignmentWaitDecision:
    """deb90 raw post-End branch; never physical completion/readiness.

    Preserve actual unsigned32 results, not nonzero→bool coercion: the native
    wait enters only when(status_return & end_return)==1. Other nonzero bit
    patterns can bypass that wait and still return1. Explicitly surface that
    bypass. Continuation-stop is also not alignment. Input/context validation
    even after failed calls is stricter local admission, not a native action.
    """
    if type(continuation_permitted) is not bool:
        raise ValueError('Explicit continuation boolean required.')
    for value in (end_return_u32,status_return_u32):
        if type(value) is not int or not 0 <= value <= 0xffffffff:
            raise ValueError('Explicit unsigned32 native call return required.')
    status = project_selected_status(payload,context_byte_8=context_byte_8,
        host_counter_45a4d8=host_counter_45a4d8,host_flag_45a504=host_flag_45a504)
    if status_return_u32 == 0:
        return AlignmentWaitDecision('native_call_failed',0xfffffff6,status)
    if end_return_u32 == 0:
        return AlignmentWaitDecision('native_call_failed',0xfffffff3,status)
    if status_return_u32 & end_return_u32 != 1:
        return AlignmentWaitDecision('native_wait_skipped',1,status)
    if not continuation_permitted:
        return AlignmentWaitDecision('continuation_stopped',None,status)
    if (status.native_slot_90 and status.native_slot_98) or status.shared.native_slot_78:
        return AlignmentWaitDecision('condition_met',1,status)
    return AlignmentWaitDecision('refresh_status',None,status)
