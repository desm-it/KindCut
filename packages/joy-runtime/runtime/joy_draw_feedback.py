"""Recovered selected-Joy ACK getters and positive batch feedback policy.

Pure functions only: not a sender, clock, retry loop, queue-drain implementation,
or authority for trajectory completion. No worker/transport wiring.
"""
from dataclasses import dataclass
from joy_draw_reply import parse_draw_ack_body


@dataclass(frozen=True)
class DrawFeedback:
    acknowledged: bool
    reported_limit_byte: int
    native_b_bit5: bool
    native_b_bit6: bool
    native_c_bit1: bool
    native_flag_09: bool
    native_flag_0a: bool | None


def draw_feedback(payload: bytes, expected_opcode: int) -> DrawFeedback:
    """Map concrete ACK-vtable getters without inventing physical-state names.

    Selected batch object ACK base is root+0x70, vtable0x100437df8:
    slot30 ->037680 (+e); slot38 ->037688 (b bit5);
    slot40 ->037694 (b bit6); slot48 ->0376a0 (c bit1).
    All fields come from the already source-bound normalized body decoder.
    """
    ack = parse_draw_ack_body(payload, expected_opcode)
    return DrawFeedback(
        acknowledged=ack.acknowledged,
        reported_limit_byte=ack.detail_0e,
        native_b_bit5=bool(ack.detail_0b & 0x20),
        native_b_bit6=bool(ack.detail_0b & 0x40),
        native_c_bit1=bool(ack.detail_0c & 2),
        native_flag_09=ack.native_flag_09,
        native_flag_0a=ack.native_flag_0a,
    )


def next_batch_limit(payload: bytes, configured_max: int) -> int:
    """Port only c4420's positive-ACK update of the next dispatcher slice cap.

    The sender's successful transport/response branch is a caller precondition;
    this computes a value, never sends, retries, marks entries or drains a queue.
    Native source param_1 is long*: param_1+0x38 means BYTE OFFSET0x1c0,
    confirmed by c498c's str [x20,#0x1c0], also read by c4e18 dispatch.
    Cupid device vtable+70 ->03a174 reads configured maximum at byte+0x1bc.
    ACK getter+30 returns +e as an unsigned byte. Native floor-to1 then signed
    minimum agrees with Python below for admitted positive maxima1..1024.
    That maxima range is local resource admission, not a universal firmware limit.
    Negative ACK handling needs the separate machine-status/error path: do not
    invent an ACK-only retry/stop rule or call feedback a physical completion.
    """
    if type(configured_max) is not int or not 1 <= configured_max <= 1024:
        raise ValueError("Invalid configured local batch maximum.")
    feedback = draw_feedback(payload, 0x43)
    if not feedback.acknowledged:
        raise ValueError("Negative batch ACK requires the separate machine-status path.")
    return min(max(feedback.reported_limit_byte, 1), configured_max)
