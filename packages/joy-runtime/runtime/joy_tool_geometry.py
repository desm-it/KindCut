"""Selected original-Joy geometry-policy subset of native c5abc/c5d3c.

This is NOT pressure/speed/tool calibration, an offset-geometry implementation,
or a hardware authorization. Other native tool/art combinations are rejected.
"""
from dataclasses import dataclass, field
from typing import Literal
import math
import struct

@dataclass(frozen=True)
class ToolGeometryPolicy:
    native_tool_type: int
    native_art_type: int
    parser_selector: int
    parser_options_word: int
    offset_internal: float
    native_model: int = field(default=12,init=False)
    physical_configuration: Literal['unverified'] = field(default='unverified',init=False)


def select_tool_geometry(*, tool: str, operation: str, algorithm_override: int = 0,
                         custom_offset: float | None = None) -> ToolGeometryPolicy:
    """Port only PEN_DT4/DRAW2 and DRAG_KNIFE2/CUT1 source branches.

    Nonzero algorithm override survives; explicit custom offset (including0)
    takes precedence and forces selector2. Native model12 default offset is the
    exact source double bits, not a guessed inches/mm conversion. Local custom
    offset admission0..72 is bounded policy, not a universal firmware limit.
    The parser OPTIONS word is the tool type, NOT another c5abc output enum:
    normal caller c5d3c passes its tool-type result by x3 to d8dc4.
    """
    if type(tool) is not str or type(operation) is not str or (tool,operation) not in (('pen','draw'),('fine_point_blade','cut')):
        raise ValueError('Unsupported selected-Joy tool/art combination.')
    if type(algorithm_override) is not int or not 0 <= algorithm_override <= 5:
        raise ValueError('Invalid native path algorithm enum.')
    native_tool,art,default = (4,2,1) if tool=='pen' else (2,1,2)
    offset = struct.unpack('<d',struct.pack('<Q',0x3ff22448a0000000))[0]
    selector = algorithm_override or default
    if custom_offset is not None:
        if type(custom_offset) not in (int,float):
            raise ValueError('Offset must be a finite builtin number.')
        try:
            offset = float(custom_offset)
        except OverflowError:
            raise ValueError('Offset exceeds range.') from None
        if not math.isfinite(offset) or not 0 <= offset <= 72:
            raise ValueError('Offset exceeds local admission range.')
        selector = 2
    return ToolGeometryPolicy(native_tool_type=native_tool,native_art_type=art,
        parser_selector=selector,parser_options_word=native_tool,offset_internal=offset)


def compile_tool_aware_candidate(plan, *, batch_limit=56, max_records=100000):
    """Compile explicit selector1 pen groups and selector2 blade groups."""
    if type(plan) is not dict or type(plan.get('groups')) is not list or not 1 <= len(plan['groups']) <= 2:
        raise ValueError('Invalid candidate tool groups.')
    policies = []
    for group in plan['groups']:
        if type(group) is not dict:
            raise ValueError('Invalid candidate group.')
        tool, operation = group.get('tool'), group.get('operation')
        if type(tool) is not str or type(operation) is not str:
            raise ValueError('Missing candidate tool or operation.')
        policies.append(select_tool_geometry(tool=tool, operation=operation))
    from joy_offline_job import compile_offline_job
    from dataclasses import asdict
    result = compile_offline_job(plan, parser_selector=1, options_word=4,
        batch_limit=batch_limit, max_records=max_records, group_policies=policies)
    result['toolGeometryPolicies'] = [asdict(policy) for policy in policies]
    return result
