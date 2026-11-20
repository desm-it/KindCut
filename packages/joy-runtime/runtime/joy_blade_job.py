"""General original-Joy fine-point blade source admission; no device authority."""
import re
from joy_blade_trial import _canonical, _number
BLADE_JOB_ID='joy-blade-job-v1'
class BladeJobError(ValueError):pass

def require_blade_job(plan,settings,pressure_requests):
    try:
        if type(plan)is not dict or type(plan.get('mat'))is not dict:raise BladeJobError('Exact mat required')
        mat=plan['mat']
        if not {'widthIn','heightIn'}<=set(mat) or set(mat)-{'widthIn','heightIn','mode'}:raise BladeJobError('Unsupported mat fields')
        _canonical({**plan,'mat':{k:mat[k]for k in('widthIn','heightIn')}})
        from joy_configuration_workflow import validate_settings
        validate_settings(settings)
        if (type(plan['schemaVersion'])is not int or plan['schemaVersion']!=2 or plan['machine']!='cricut_joy'
                or plan['unit']!='pt72' or plan['execution']!='unsupported' or plan['coordinateFrame']!='kindcut_canvas_pt72_v1'):
            raise BladeJobError('Unsupported original-Joy point plan')
        if settings['tool']!='fine_point_blade' or settings['operation']!='cut' or settings['mode']!='precision':raise BladeJobError('Exact precision blade settings required')
        mat,material=plan['mat'],plan['material']
        if type(material['id'])is not int or not 1<=material['id']<=0xffffffff or settings['materialId']!=material['id']:raise BladeJobError('Material identity mismatch')
        if (not all(_number(mat[k])for k in('widthIn','heightIn'))or not 0<mat['widthIn']<=4.5 or not ('mode'not in mat and mat['heightIn']in(6.5,12)or type(mat.get('mode'))is str and mat['mode']=='card' and mat['widthIn']==4.5 and mat['heightIn']==6.25)):raise BladeJobError('Unsupported mat dimensions')
        if any(not _number(material[k])or not 0<material[k]<=mat[k]for k in('widthIn','heightIn')):raise BladeJobError('Material does not fit mat')
        if material['id']==535 and mat.get('mode')!='card':raise BladeJobError('Insert cards require CardMat mode')
        b=plan['bounds']
        if any(not _number(v)for v in b.values())or b['minX']>b['maxX']or b['minY']>b['maxY']:raise BladeJobError('Invalid bounds')
        c=plan['clipping']
        if c['policy']not in('clip','reject')or type(c['clippedPathIds'])is not list or type(c['omittedPathIds'])is not list or c['clippedPathIds']or c['omittedPathIds']:raise BladeJobError('Clipped or omitted blade paths are not admitted')
        groups=plan['groups']
        if len(groups)!=1 or groups[0]['tool']!='fine_point_blade' or groups[0]['operation']!='cut':raise BladeJobError('One fine-point cut group required')
        paths=groups[0]['paths'];ids=set();count=0
        if not 1<=len(paths)<=1000:raise BladeJobError('Path budget exceeded')
        for path in paths:
            pid=path['id']
            if type(pid)is not str or not 1<=len(pid)<=256 or pid in ids:raise BladeJobError('Unique path identities required')
            ids.add(pid)
            if 'color'in path and(type(path['color'])is not str or re.fullmatch('#[0-9a-fA-F]{6}',path['color'])is None):raise BladeJobError('Invalid path colour')
            active=drawn=False
            if not path['steps']:raise BladeJobError('Empty blade path')
            for step in path['steps']:
                op,points=step['op'],step['points'];arity={'M':1,'L':1,'C':3,'Z':0}.get(op);count+=1
                if arity is None or type(points)is not list or len(points)!=arity or count>100000:raise BladeJobError('Invalid point representation or resource budget')
                if op=='M':active=True
                else:
                    if not active:raise BladeJobError('Subpath must begin with M')
                    if op=='Z':active=False
                    else:drawn=True
                if any(not _number(p[k])or abs(p[k])>1e9 for p in points for k in('x','y')):raise BladeJobError('Nonfinite or excessive coordinates')
            if not drawn:raise BladeJobError('A blade path needs drawing segments')
        if(type(pressure_requests)is not list or not 1<=len(pressure_requests)<=32 or any(type(v)is not int or not 1<=v<=65535 for v in pressure_requests)or pressure_requests[0]!=settings['pressureRequest']):raise BladeJobError('Explicit valid pressure recipe required')
    except BladeJobError:raise
    except Exception as exc:raise BladeJobError('Malformed general blade job')from exc
