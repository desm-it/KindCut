"""Explicit original-Joy pen/precision configuration -> inert native bodies.

Ordinary caller04772c, pressure consumer03f478 and builders05168c/052164/050c7c
bind the selected count output and all explicit state to the three body types.
No presets, omitted-axis defaults, live calibration, transport or authorization.
All data remains caller-supplied/unverified; blade and other modes fail closed.
"""
from dataclasses import dataclass
import math
import re
import struct

from joy_pressure_table import decode_pressure_table
from joy_pressure_curve import interpolate_pressure_counts
from joy_tool_geometry import compile_tool_aware_candidate
from joy_tool_calibration import _f32


_KEYS = {'schemaVersion', 'materialId', 'tool', 'operation', 'mode', 'context',
         'profileId', 'calibrationSource', 'pressureRequest',
         'pressureResponsesHex', 'speeds', 'nonXY', 'geometry'}
_SPEED_KEYS = {'cutVelocity_ips', 'moveVelocity_ips',
               'cutAcceleration_ips2', 'moveAcceleration_ips2'}
_ORDER = ('cutVelocity', 'moveVelocity', 'cutAcceleration', 'moveAcceleration')
_FLAGS = ('p_bias_enabled', 'roc_threshold_enabled', 't_bias_enabled',
          'use_calc_offsets', 'centered_bl', 'tan_theta')
_BITS = (4, 6, 3, 2, 1, 0)


@dataclass(frozen=True)
class ResolvedConfiguration:
    material_id: int
    tool: str
    operation: str
    mode: str
    context: int
    profile_id: str
    requested_pressure_native: int
    position_counts: int
    pressure_rows: tuple
    speeds: tuple
    geometry_flags: int
    geometry_scalars: tuple
    geometry_nodes: tuple
    provenance: str = 'caller_supplied_unverified'
    physical_calibration_verified: bool = False


def _uint(value, name):
    if type(value) is not int or not 0 <= value <= 65535:
        raise ValueError(f'{name} must be a builtin uint16 integer.')
    return value


def _finite_positive(value, name):
    if type(value) not in (int, float):
        raise ValueError(f'{name} must be a finite positive builtin number.')
    try:
        number = float(value)
    except OverflowError:
        raise ValueError(f'{name} exceeds numeric range.') from None
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f'{name} must be finite and positive.')
    return number


def resolve_configuration(plan, configuration):
    """Resolve one matched pen/draw or fine-point-blade/cut group.

    Precision context0 and caller-supplied unverified calibration inputs are
    required for either tool; this resolver does not certify physical settings.
    """
    if type(plan) is not dict or type(configuration) is not dict or set(configuration) != _KEYS:
        raise ValueError('Configuration envelope is invalid or contains unknown/missing fields.')
    if configuration['schemaVersion'] != 1 or type(configuration['schemaVersion']) is not int:
        raise ValueError('Unsupported configuration schema.')
    groups = plan.get('groups') if type(plan) is dict else None
    if type(groups) is not list or len(groups) != 1 or type(groups[0]) is not dict:
        raise ValueError('Configuration requires exactly one selected tool group.')
    group = groups[0]
    tool, operation = configuration['tool'], configuration['operation']
    if (tool, operation) not in (('pen','draw'), ('fine_point_blade','cut')) or (group.get('tool'), group.get('operation')) != (tool, operation):
        raise ValueError('Configuration must match one supported tool/operation group.')
    material_id = configuration['materialId']
    material = plan.get('material')
    if type(material_id) is not int or type(material) is not dict or type(material.get('id')) is not int or material_id != material['id']:
        raise ValueError('Configuration material ID must exactly match the plan material ID.')
    if configuration['mode'] != 'precision' or type(configuration['mode']) is not str or configuration['context'] != 0 or type(configuration['context']) is not int:
        raise ValueError('Only normal-mat precision context 0 is admitted.')
    profile = configuration['profileId']
    if type(profile) is not str or not profile.strip() or len(profile) > 256:
        raise ValueError('Caller-supplied profile/provenance ID is required.')
    if configuration['calibrationSource'] != 'caller_supplied_unverified':
        raise ValueError('Calibration provenance must be caller_supplied_unverified.')
    pressure = _uint(configuration['pressureRequest'], 'pressureRequest')
    if pressure == 0:
        raise ValueError('Positive explicit pressure required; native fallback is not a material preset.')
    encoded = configuration['pressureResponsesHex']
    if type(encoded) is not list or len(encoded) != 16 or any(type(row) is not str or re.fullmatch(r'[0-9a-fA-F]{22}', row) is None for row in encoded):
        raise ValueError('Exactly sixteen strict 11-byte hex calibration responses are required.')
    rows = decode_pressure_table(tuple(bytes.fromhex(row) for row in encoded))
    counts = interpolate_pressure_counts(pressure, tuple((r.pressure_native, r.position_counts) for r in rows))
    speed_data = configuration['speeds']
    if type(speed_data) is not dict or set(speed_data) != _SPEED_KEYS:
        raise ValueError('All four explicit X/Y velocity and acceleration settings are required.')
    nonxy = configuration['nonXY']
    if type(nonxy) is not dict or set(nonxy) != {'unit', *_ORDER} or nonxy['unit'] != 'native_unverified':
        raise ValueError('All non-XY values and their unverified native-unit tag are required.')
    speeds = []
    for index, name in enumerate(_ORDER):
        key = name + ('_ips' if index < 2 else '_ips2')
        pair = speed_data[key]
        if type(pair) is not list or len(pair) != 2:
            raise ValueError(f'{key} must explicitly provide X and Y values.')
        tail = nonxy[name]
        if type(tail) is not list or len(tail) != 3:
            raise ValueError('ZA/ZB/theta values must all be supplied explicitly.')
        values = tuple(_finite_positive(v, key) for v in pair) + tuple(_f32(v) for v in tail)
        for axis, value in enumerate(values):
            word = _speed_word(value)
            if axis < 2 and word == 0:
                raise ValueError('Positive X/Y settings must survive native projection.')
        speeds.append(values)
    geometry = configuration['geometry']
    if (type(geometry) is not dict or set(geometry) != {'unit', 'flags', 'lift_threshold',
            'parallel_offset', 'lagging_offset', 'nodes'} or geometry['unit'] != 'native_unverified'):
        raise ValueError('All native geometry settings and their unverified unit tag are required.')
    flags = geometry['flags']
    if type(flags) is not dict or set(flags) != set(_FLAGS) or any(type(flags[k]) is not bool for k in _FLAGS):
        raise ValueError('Exactly six explicit native compensation booleans are required.')
    flag_word = sum(int(flags[k]) << bit for k, bit in zip(_FLAGS, _BITS))
    scalars = tuple(_f32(geometry[k]) for k in ('lift_threshold', 'parallel_offset', 'lagging_offset'))
    nodes = geometry['nodes']
    if type(nodes) is not list or len(nodes) != 5 or any(type(v) is not int or not 0 <= v <= 255 for v in nodes):
        raise ValueError('Exactly five native node bytes are required.')
    return ResolvedConfiguration(material_id, tool, operation, 'precision', 0, profile,
                                 pressure, counts, tuple(rows), tuple(speeds), flag_word, scalars, tuple(nodes))


def _speed_word(value):
    # 052484 FMUL S0,S0,S1 then 052488 FCVTAS W8,S0; repeated for all20
    # scalars. Pseudocode's cast is NOT truncation. Positive ties go away.
    value = _f32(value)
    if value < 0:
        raise ValueError('Negative speed/acceleration is not admitted.')
    product = _f32(value * 100.0)
    result = math.floor(product + .5)
    if not 0 <= result <= 65535:
        raise ValueError('Setting exceeds local uint16 serialization admission, not a firmware safe limit.')
    return result


def compile_configured_candidate(plan, configuration, *, batch_limit=56, max_records=100000):
    """Bind actual settings to inspection-only bodies; no framed send or job."""
    selected = resolve_configuration(plan, configuration)
    result = compile_tool_aware_candidate(plan, batch_limit=batch_limit, max_records=max_records)
    mat = plan['mat']
    # Ordinary04772c clamps its profile (not the separate0x11 mat dimensions)
    # to width>=4.8 and height>=12. 051794/0517cc FCVTPS rounds upward.
    width = math.ceil(max(4.8, mat['widthIn']))
    height = math.ceil(max(12, mat['heightIn']))
    if not 0 < width <= 255 or not 0 < height <= 255:
        raise ValueError('Profile dimensions exceed local byte serialization admission.')
    # c5abc branches on PBToolInfo ART at+1c, not TOOL at+18.
    # DRAW2 -> output through x3 is2; CUT1/tool2 -> x3 is0.
    # 047787c->051660 writes that byte to command+14 (wire offset10).
    # Caller sets command+11 iff selected parser is1/4; builder ORs reserved8.
    mode_byte = 2 if selected.tool == 'pen' else 0
    flags = 0x88 if selected.tool == 'pen' else 0x08
    machine = bytes([0x30, flags, 0, 0, width, height]) + bytes(4) + bytes([mode_byte]) + struct.pack('>H', selected.position_counts)
    words = tuple(_speed_word(v) for group in selected.speeds for v in group)
    speed = bytes([0x31]) + bytes([15]) * 5 + struct.pack('>20H', *words)
    geometry = bytes([0x3e, 0, selected.geometry_flags]) + struct.pack('>fff', *selected.geometry_scalars) + bytes(selected.geometry_nodes)
    templates = []
    if machine is not None:
        templates.append(dict(kind='machine_state', bodyHex=machine.hex()))
    templates.extend((dict(kind='speed_state', bodyHex=speed.hex()), dict(kind='geometry_state', bodyHex=geometry.hex())))
    result['configurationBodyTemplates'] = templates
    result['effectiveConfiguration'] = dict(materialId=selected.material_id, profileId=selected.profile_id,
        tool=selected.tool, operation=selected.operation, mode=selected.mode, context=selected.context,
        requestedPressureNative=selected.requested_pressure_native, positionCounts=selected.position_counts,
        machinePressureMode=mode_byte, machineFlags=flags,
        provenance=selected.provenance, physicalCalibrationVerified=False,
        nativeAxisOrder=['X', 'Y', 'ZA', 'ZB', 'theta'], nonXYUnits='native_unverified',
        geometryUnits='native_unverified', execution='unsupported')
    return result
