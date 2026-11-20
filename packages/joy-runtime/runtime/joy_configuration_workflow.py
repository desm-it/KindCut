"""Offline profile validation and compile dispatch. No device/calibration defaults."""
import copy
import math
from joy_tool_configuration import _speed_word
from joy_tool_calibration import _f32

SETTINGS_KEYS={'schemaVersion','materialId','tool','operation','mode','context','profileId','pressureRequest','speeds','nonXY','geometry'}
SPEEDS=('cutVelocity','moveVelocity','cutAcceleration','moveAcceleration')
FLAGS={'p_bias_enabled','roc_threshold_enabled','t_bias_enabled','use_calc_offsets','centered_bl','tan_theta'}

def _obj(value,keys):
    if type(value) is not dict or set(value)!=set(keys):raise ValueError('Unexpected profile fields')
    return value

def validate_settings(value):
    """Validate a complete template without inventing device calibration rows."""
    s=_obj(value,SETTINGS_KEYS)
    if type(s['schemaVersion']) is not int or s['schemaVersion']!=1:raise ValueError('Unsupported profile schema')
    if type(s['materialId']) is not int or not 1<=s['materialId']<=9007199254740991:raise ValueError('Invalid material identity')
    if (s['tool'],s['operation']) not in (('pen','draw'),('fine_point_blade','cut')):raise ValueError('Unsupported tool')
    if type(s['context']) is not int or s['context']!=0 or s['mode']!='precision':raise ValueError('Only normal-mat precision is supported')
    if type(s['profileId']) is not str or not 1<=len(s['profileId'])<=80 or not all(c.isascii() and (c.isalnum() or c in '_-') for c in s['profileId']):raise ValueError('Invalid profile ID')
    if type(s['pressureRequest']) is not int or not 1<=s['pressureRequest']<=65535:raise ValueError('Explicit positive native pressure required')
    speed=_obj(s['speeds'],[k+('_ips' if i<2 else '_ips2')for i,k in enumerate(SPEEDS)])
    nonxy=_obj(s['nonXY'],{'unit',*SPEEDS})
    if nonxy['unit']!='native_unverified':raise ValueError('Unknown non-XY units')
    for i,k in enumerate(SPEEDS):
        pair=speed[k+('_ips' if i<2 else '_ips2')];tail=nonxy[k]
        if type(pair) is not list or len(pair)!=2 or type(tail) is not list or len(tail)!=3:raise ValueError('All five axes must be supplied')
        for j,v in enumerate(pair+tail):
            if type(v) not in (int,float):raise ValueError('Invalid axis scalar')
            if j<2 and (not math.isfinite(v) or v<=0 or _speed_word(v)==0):raise ValueError('Positive projected XY value required')
            _speed_word(v)
    g=_obj(s['geometry'],{'unit','flags','lift_threshold','parallel_offset','lagging_offset','nodes'})
    if g['unit']!='native_unverified':raise ValueError('Unknown geometry units')
    f=_obj(g['flags'],FLAGS)
    if any(type(v) is not bool for v in f.values()):raise ValueError('Explicit boolean geometry flags required')
    for k in ('lift_threshold','parallel_offset','lagging_offset'):_f32(g[k])
    if type(g['nodes']) is not list or len(g['nodes'])!=5 or any(type(v) is not int or not 0<=v<=255 for v in g['nodes']):raise ValueError('Five node bytes required')
    return copy.deepcopy(s)

def compile_profile(plan,settings,responses):
    from joy_tool_configuration import compile_configured_candidate
    settings=validate_settings(settings)
    return compile_configured_candidate(plan,{**settings,'calibrationSource':'caller_supplied_unverified','pressureResponsesHex':responses},max_records=12000)

def configuration_request(request):
    action=request.get('action')
    allowed={'id','op','action','settings'}|({'plan','pressureResponsesHex'}if action in ('compile','prepare_job')else set())
    if action=='prepare_job':allowed|={'pressureRequests'}
    if set(request)-allowed:raise ValueError('Unexpected configuration request fields')
    if action=='validate':return {'settings':validate_settings(request.get('settings'))}
    if action=='prepare_job':
        from joy_job_program import compile_job_program,program_metadata
        return program_metadata(compile_job_program(request.get('plan'),request.get('settings'),
            request.get('pressureResponsesHex'),request.get('pressureRequests')))
    if action=='compile':return compile_profile(request.get('plan'),request.get('settings'),request.get('pressureResponsesHex'))
    raise ValueError('Unsupported offline configuration action')
