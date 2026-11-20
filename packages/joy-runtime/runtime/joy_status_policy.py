"""Pure selected-Joy status projection and negative batch decision prefix.

Source: ZorroGetMachineStatusCommand vtable0x1004384c0 and c4420.
No command execution, polling, retry, queue drain, ready/completion/stop claims,
worker wiring or implicit host-global reads. All external context is explicit.
"""
from dataclasses import dataclass
from joy_protocol import MAX_PAYLOAD, parse_status
from joy_draw_reply import parse_draw_ack_body


@dataclass(frozen=True)
class MachineStatusProjection:
    raw_status_11: int
    raw_status_12: int
    raw_value_14: int
    effective_error_u32: int
    native_slot_78: bool
    native_slot_a8: bool
    extension: bytes


@dataclass(frozen=True)
class NativeBatchBranch:
    # Raw native return bits; None means further command gates, NOT success/retry.
    native_return_u32: int | None
    status_projection: MachineStatusProjection | None


def _byte(value: int, name: str) -> int:
    if type(value) is not int or not 0 <= value <= 255:
        raise ValueError(f"{name} must be an exact byte.")
    return value


def project_machine_status(payload: bytes, *, context_byte_8: int,
                           host_counter_45a4d8: int | None = None,
                           host_flag_45a504: int | None = None) -> MachineStatusProjection:
    """Project concrete getters from a normalized status snapshot plus context.

    Reuses existing parse_status, whose60000000 request/body contract matches
    selected parser061aa0. Zorro discards body3:5; raw bytes1/2 and BEu32[5:9]
    fill native11/12/14. No alternative wire format is introduced.
    061dec tests context BIT0 for error suppression. 061e4c/061f38 instead test
    EXACTLY1 for host overrides. Counter is signed32 (ASM cset gt); flag is byte.
    Context semantics are deliberately not named hardware/simulation/connection.
    """
    mode = _byte(context_byte_8, "context_byte_8")
    if type(payload) is not bytes or len(payload) > MAX_PAYLOAD:
        raise ValueError("Status must be a bounded immutable normalized body.")
    if host_counter_45a4d8 is not None and (type(host_counter_45a4d8) is not int or
            not -(2**31) <= host_counter_45a4d8 < 2**31):
        raise ValueError("Host counter must be signed32.")
    if host_flag_45a504 is not None:
        _byte(host_flag_45a504, "host_flag_45a504")
    raw = parse_status(payload, include_extra=False)
    if mode == 1:
        if host_counter_45a4d8 is None or host_flag_45a504 is None:
            raise ValueError("Exact context1 requires explicit host override values.")
        slot78 = host_counter_45a4d8 > 0
        slota8 = bool(host_flag_45a504 & 1)
    else:
        slot78 = bool(raw['status_byte_1'] & 4)
        slota8 = bool(raw['status_byte_2'] & 1)
    return MachineStatusProjection(
        raw_status_11=raw['status_byte_1'], raw_status_12=raw['status_byte_2'],
        raw_value_14=raw['value_be32'],
        effective_error_u32=0 if mode & 1 else raw['value_be32'],
        native_slot_78=slot78, native_slot_a8=slota8,
        extension=raw['extension'],
    )


def negative_batch_branch(ack_payload: bytes, status_payload: bytes | None, *,
                          status_call_returned_nonzero: bool,
                          context_byte_8: int | None = None,
                          host_counter_45a4d8: int | None = None,
                          host_flag_45a504: int | None = None) -> NativeBatchBranch:
    """Port only the proved negative-ACK prefix, without performing its calls.

    Caller must establish the outer draw execution/response branch. Status+10 is
    EXECUTION returning nonzero, not a getter/predicate or physical observation.
    The short-circuit order below is native: ACK9&&B5 ->2; false status call ->F6;
    A8 false ->E9; slot78 true ->2; then error35/36 ->D4, other error ->F3.
    Error0 requires additional command/sync/time/continuation gates, left explicit.
    """
    if type(status_call_returned_nonzero) is not bool:
        raise ValueError("Status-call result must be an explicit nonzero-result boolean.")
    ack = parse_draw_ack_body(ack_payload, 0x43)
    if ack.acknowledged:
        raise ValueError("Positive batch ACK uses the separate feedback path.")
    if ack.native_flag_09 and ack.detail_0b & 0x20:
        return NativeBatchBranch(2, None)
    if not status_call_returned_nonzero:
        return NativeBatchBranch(0xfffffff6, None)
    if status_payload is None or context_byte_8 is None:
        raise ValueError("Status branch requires explicit body and context.")
    view = project_machine_status(status_payload, context_byte_8=context_byte_8,
        host_counter_45a4d8=host_counter_45a4d8, host_flag_45a504=host_flag_45a504)
    if not view.native_slot_a8:
        result = 0xffffffe9
    elif view.native_slot_78:
        result = 2
    elif view.effective_error_u32 in (0x35, 0x36):
        result = 0xffffffd4
    elif view.effective_error_u32 != 0:
        result = 0xfffffff3
    else:
        result = None
    return NativeBatchBranch(result, view)
