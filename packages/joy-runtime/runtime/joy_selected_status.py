"""Actual Cupid→Athena kind9 status projection, with no I/O or readiness claim.

Cupid047f7c delegates kind9 to Athena04b268/04d980 (vtable434688), NOT
Zorro061934. The selected parser04daec retains the extra u16 for device+10c>11;
selected original-Joy construction sets10c=12. Normal status bytes/error and
three shared getter rules match the earlier inert projection, reused below.
"""
from dataclasses import dataclass, field
from typing import Literal
from joy_status_policy import MachineStatusProjection, project_machine_status
from joy_protocol import parse_status

@dataclass(frozen=True)
class SelectedJoyStatus:
    shared: MachineStatusProjection
    native_extra_u16: int
    native_slot_90: bool
    native_slot_98: bool
    native_model_10c: int = field(default=12,init=False)
    physical_state: Literal['unverified'] = field(default='unverified',init=False)


def project_selected_status(payload: bytes, *, context_byte_8: int,
                            host_counter_45a4d8: int | None = None,
                            host_flag_45a504: int | None = None) -> SelectedJoyStatus:
    """Project only selected-model raw getters, never a loaded/stopped state.

    04e000/04e020 return1 for context BIT0, otherwise byte11bits5/6.
    Even both true was captured DURING advancing measurement (pass34); their
    use in a native wait does not independently establish completed motion.
    """
    shared = project_machine_status(payload,context_byte_8=context_byte_8,
        host_counter_45a4d8=host_counter_45a4d8,host_flag_45a504=host_flag_45a504)
    raw = parse_status(payload,include_extra=True)
    return SelectedJoyStatus(shared=shared,native_extra_u16=raw['extra_u16_native'],
        native_slot_90=bool(context_byte_8 & 1 or raw['status_byte_1'] & 0x20),
        native_slot_98=bool(context_byte_8 & 1 or raw['status_byte_1'] & 0x40))
