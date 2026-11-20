"""Source-bound draw ACK bodies; no framing, transport, or completion claim.

All four selected draw response thunks reach FUN_100037188; FUN_100035eb4
supplies a length-delimited body extracted by the underlying connection reader.
Only that normalized body is accepted here. Upstream framing/authentication and
correlation remain the caller's separate responsibilities; this is not a packet
validator or a machine-state authority. Fixtures are source-derived/synthetic.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class DrawAcknowledgment:
    opcode: int
    acknowledged: bool
    detail_0b: int
    detail_0c: int
    detail_0e: int
    error_0d: int
    native_flag_09: bool
    # Positive branch does not write native +0xa: None means LEAVE UNCHANGED,
    # not False and not an assertion about a reused helper object's prior state.
    native_flag_0a: bool | None
    raw_payload: bytes


def parse_draw_ack_body(payload: bytes, expected_opcode: int) -> DrawAcknowledgment:
    """Port the selected commands' shared ACK shape, not physical execution state.

    00/tag/three opaque bytes (length5) sets the helper's acknowledged field.
    01/tag/three opaque bytes/error/trailing (length7 or8) clears that field.
    No terminator/detail-byte semantics are invented. Native +9/+a flag names
    are retained as offsets because their higher-level meanings are unresolved.
    """
    if type(expected_opcode) is not int or expected_opcode not in (0x21, 0x22, 0x42, 0x43):
        raise ValueError("Expected tag is not a source-bound draw opcode.")
    if type(payload) is not bytes or len(payload) not in (5, 7, 8):
        raise ValueError("Unexpected draw ACK body type or length.")
    if payload[1] != expected_opcode:
        raise ValueError("Draw ACK tag does not match the expected opcode.")
    acknowledged = payload[0] == 0 and len(payload) == 5
    negative = payload[0] == 1 and len(payload) in (7, 8)
    if not (acknowledged or negative):
        raise ValueError("Unexpected draw ACK prefix/length combination.")
    error = 0 if acknowledged else payload[5]
    return DrawAcknowledgment(
        opcode=payload[1], acknowledged=acknowledged,
        detail_0b=payload[2], detail_0c=payload[3], detail_0e=payload[4],
        error_0d=error,
        native_flag_09=(not acknowledged and error == 0x3c),
        # ARM64 037560..037580 uses UNSIGNED b.hi after error-0x35.
        # The four-bit mask therefore does NOT wrap to error bytes0x14/0x15.
        native_flag_0a=None if acknowledged else error in (0x35, 0x36, 0x54, 0x55),
        raw_payload=payload,
    )
