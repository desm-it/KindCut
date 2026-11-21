"""Version 1 metadata and pure validators for existing job wire messages.
The version is deliberately not serialized as a new wire field.
"""
import json
import math
from pathlib import Path

CONTRACT_VERSION = 1
START_KEYS = {'op','action','plan','settings','pressureResponsesHex','pressureRequests','programDigest','motionApproved','bladeRemovedConfirmed','timeout','jobTimeout','bladeTrial','bladeJob'}
NEXT_KEYS = {'op','action','operationId','plan','settings','pressureResponsesHex','pressureRequests','programDigest','jobTimeout','bladeTrial','bladeJob'}

def validate_deadline(value, cap):
    """Worker-side finite positive deadline cap; host defaults remain separate."""
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= cap:
        raise ValueError('Job deadline outside local admission range')
    return value

def validate_job_request(value):
    if type(value) is not dict or value.get('op') != 'job': return False
    action = value.get('action')
    if action in ('start', 'next'):
        allowed = START_KEYS if action == 'start' else NEXT_KEYS
        required = allowed - {'bladeTrial', 'bladeJob'}
        if not required <= value.keys() or value.keys() - allowed: return False
        markers = [name for name in ('bladeTrial', 'bladeJob') if name in value]
        blade = type(value.get('settings')) is dict and value['settings'].get('tool') == 'fine_point_blade'
        if len(markers) != (1 if blade else 0) or any(type(value[m]) is not str for m in markers): return False
        if value.get('jobTimeout') != 60: return False
        if action == 'start' and (value.get('timeout') != 30 or value.get('motionApproved') is not True or value.get('bladeRemovedConfirmed') is not True): return False
        if type(value.get('programDigest')) is not str or len(value['programDigest']) != 64 or any(c not in '0123456789abcdef' for c in value['programDigest']): return False
        if type(value.get('pressureRequests')) is not list or not value['pressureRequests'] or any(type(p) is not int or not 1 <= p <= 65535 for p in value['pressureRequests']): return False
        if type(value.get('pressureResponsesHex')) is not list or any(type(row) is not str for row in value['pressureResponsesHex']): return False
    elif action == 'status':
        return set(value) == {'op', 'action'}
    elif action in ('go', 'cancel', 'pause', 'resume', 'end'):
        required = {'op', 'action', 'operationId'}
        if action == 'go':
            required.add('toolConfirmed')
            if value.get('bladeInstalledConfirmed') is True: required.add('bladeInstalledConfirmed')
            if value.get('toolConfirmed') is not True: return False
        elif action == 'resume':
            required.add('resumeApproved')
            if value.get('resumeApproved') is not True: return False
        elif action == 'end':
            required.add('endApproved')
            if value.get('endApproved') is not True: return False
        if set(value) != required: return False
    else: return False
    if action != 'start' and (type(value.get('operationId')) is not int or not 0 <= value['operationId'] <= 9007199254740991): return False
    return True

def load_vectors():
    return json.loads((Path(__file__).resolve().parents[1] / 'contracts' / 'job-rpc-vectors.json').read_text())
