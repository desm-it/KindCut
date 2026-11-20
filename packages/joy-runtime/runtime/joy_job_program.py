"""Immutable, source-input-only job programs; compilation grants no device I/O.

Inspection candidates are never admitted as programs. Recompile exact settings
and all pressure passes using the existing source-bound compiler. Keep individual
records rather than treating fixed offline chunks as a live flow-control policy.
Physical axes, calibration and completion remain unverified.
"""
from dataclasses import dataclass
import hashlib
import json

from joy_configuration_workflow import compile_profile


@dataclass(frozen=True)
class JobPath:
    path_id: str
    records: tuple[bytes, ...]


@dataclass(frozen=True)
class JobPass:
    pressure_request: int
    configuration_bodies: tuple[bytes, ...]
    paths: tuple[JobPath, ...]


@dataclass(frozen=True)
class NativeJobProgram:
    digest: str
    material_id: int
    tool: str
    operation: str
    coordinate_frame: str
    mat_height_inches: float
    passes: tuple[JobPass, ...]
    physical_calibration_verified: bool = False
    mat_mode: int = 0


def compile_job_program(plan, settings, pressure_responses, pressure_requests):
    """Compile a bounded explicit single-tool recipe, without transport/authority.

    The32-pass/12000-record limits are local resource policy, not firmware limits
    or material presets. Initial pressure must agree with the selected profile;
    every later pass may request a different pressure and is preserved verbatim.
    Caller-provided calibration is unverified, never synthesized or read here.
    """
    if (type(pressure_requests) not in (list, tuple) or not 1 <= len(pressure_requests) <= 32
            or any(type(p) is not int or not 1 <= p <= 65535 for p in pressure_requests)):
        raise ValueError('Explicit bounded native pressure recipe required')
    if type(settings) is not dict or settings.get('pressureRequest') != pressure_requests[0]:
        raise ValueError('Primary recipe pressure must match the selected settings')
    passes = []
    for pressure in pressure_requests:
        candidate = compile_profile(plan, {**settings, 'pressureRequest': pressure}, pressure_responses)
        groups = candidate['groups']
        if len(groups) != 1:
            raise ValueError('One exact tool group required')
        paths = []
        for path in groups[0]['paths']:
            records = []
            for encoded in path['batchBodiesHex']:
                body = bytes.fromhex(encoded)
                if not body or body[0] != 0x43 or (len(body)-1) % 9:
                    raise ValueError('Compiler returned invalid record representation')
                records.extend(body[i:i+9] for i in range(1,len(body),9))
            if not records or len(records) != path['pointRecordCount']:
                raise ValueError('Compiler record count mismatch')
            paths.append(JobPath(path['id'], tuple(records)))
        bodies = tuple(bytes.fromhex(item['bodyHex']) for item in candidate['configurationBodyTemplates'])
        if tuple(b[0] for b in bodies) != (0x30,0x31,0x3e):
            raise ValueError('Incomplete source-bound configuration')
        passes.append(JobPass(pressure,bodies,tuple(paths)))
    # JSON hashing follows successful structural/finite admission. This binding
    # detects changed source inputs; it is not authentication or machine approval.
    binding={'plan':plan,'settings':settings,'calibration':pressure_responses,'pressures':list(pressure_requests)}
    if settings['tool']=='fine_point_blade':
        binding['executionOrder']='object-major-v1'
    source=json.dumps(binding,sort_keys=True,separators=(',',':'),allow_nan=False)
    mode = plan['mat'].get('mode')
    if settings['materialId']==535 and mode!='card':raise ValueError('Insert cards require explicit CardMat mode')
    height = float(plan['mat']['heightIn'])
    if mode is None:
        if height not in (6.5, 12): raise ValueError('Executable normal jobs require a supported mat height')
        mat_mode = 0
    elif type(mode) is str and mode == 'card':
        if height != 6.25 or float(plan['mat']['widthIn']) != 4.5:
            raise ValueError('Card mode requires exactly 4.5 by 6.25 inches')
        mat_mode = 2
    else:
        raise ValueError('Unsupported explicit mat mode')
    return NativeJobProgram(hashlib.sha256(source.encode()).hexdigest(),settings['materialId'],
        settings['tool'],settings['operation'],plan['coordinateFrame'],height,tuple(passes),mat_mode=mat_mode)


def program_metadata(program):
    """Safe preparation summary; no records, calibration rows or I/O authority."""
    if type(program)is not NativeJobProgram:raise ValueError('Exact compiled program required')
    return dict(programDigest=program.digest,tool=program.tool,operation=program.operation,
        materialId=program.material_id,passCount=len(program.passes),
        recordCount=sum(len(path.records)for step in program.passes for path in step.paths),
        pressureRequests=[step.pressure_request for step in program.passes],
        heightInches=program.mat_height_inches,physicalCalibrationVerified=False)
