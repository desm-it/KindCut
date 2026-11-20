"""Pure restricted first-cut admission. Not a physical-safety certification."""
import json,math
from pathlib import Path
from typing import NoReturn
_POLICY=json.loads((Path(__file__).resolve().parent/'profiles/first-cut-trial.json').read_text())
BLADE_TRIAL_ID=_POLICY['id']
class BladeTrialError(ValueError):pass
def _fail()->NoReturn:raise BladeTrialError('Restricted blade trial requires the exact preset, recipe and one closed20mm square.')
def _number(v):return type(v)in(int,float)and math.isfinite(v)
def _close(a,b):return _number(a)and _number(b)and abs(a-b)<=1e-6
def _same(a,b):
 if type(b)is dict:return type(a)is dict and a.keys()==b.keys()and all(_same(a[k],v)for k,v in b.items())
 if type(b)is list:return type(a)is list and len(a)==len(b)and all(_same(x,y)for x,y in zip(a,b))
 if type(b)is bool:return type(a)is bool and a==b
 if _number(b):return _number(a)and a==b
 return type(a)is type(b)and a==b
def _keys(obj,required,optional=()):
 if type(obj)is not dict or not set(required)<=obj.keys()or obj.keys()-set(required)-set(optional):_fail()
def _canonical(plan):
 _keys(plan,('schemaVersion','machine','unit','execution','coordinateFrame','material','mat','bounds','clipping','groups'))
 _keys(plan['material'],('widthIn','heightIn','id'));_keys(plan['mat'],('widthIn','heightIn'))
 _keys(plan['bounds'],('minX','minY','maxX','maxY'));_keys(plan['clipping'],('policy','clippedPathIds','omittedPathIds'))
 if type(plan['groups'])is not list:_fail()
 for group in plan['groups']:
  _keys(group,('tool','operation','paths'))
  if type(group['paths'])is not list:_fail()
  for path in group['paths']:
   _keys(path,('id','steps'),('color',))
   if type(path['steps'])is not list:_fail()
   for step in path['steps']:
    _keys(step,('op','points'))
    if type(step['points'])is not list:_fail()
    for point in step['points']:_keys(point,('x','y'))
def require_blade_trial(plan,settings,pressure_requests):
 if type(plan)is not dict or type(settings)is not dict:_fail()
 _canonical(plan)
 actual=dict(settings);actual.pop('profileId',None)
 if not _same(actual,_POLICY['settings'])or not _same(pressure_requests,_POLICY['pressureRequests']):_fail()
 if plan.get('schemaVersion')!=2 or type(plan.get('schemaVersion'))is not int or plan.get('machine')!='cricut_joy'or plan.get('coordinateFrame')!=_POLICY['coordinateFrame']or plan.get('unit')!='pt72'or plan.get('execution')!='unsupported':_fail()
 mat,material=plan.get('mat'),plan.get('material')
 if type(mat)is not dict or type(material)is not dict or type(material.get('id'))is not int or material['id']!=211:_fail()
 if not all(_close(mat.get(k),v)for k,v in _POLICY['mat'].items())or not all(_number(material.get(k))for k in('widthIn','heightIn')):_fail()
 groups=plan.get('groups')
 if type(groups)is not list or len(groups)!=1 or type(groups[0])is not dict:_fail()
 group=groups[0];paths=group.get('paths')
 if group.get('tool')!='fine_point_blade'or group.get('operation')!='cut'or type(paths)is not list or len(paths)!=1 or type(paths[0])is not dict:_fail()
 steps=paths[0].get('steps')
 if type(steps)is not list:_fail()
 closed=len(steps)in(5,6)and type(steps[-1])is dict and steps[-1].get('op')=='Z'and steps[-1].get('points')==[]
 lines=steps[:-1]if closed else steps
 if len(lines)not in(4,5)or(not closed and len(lines)!=5):_fail()
 points=[]
 for i,step in enumerate(lines):
  if type(step)is not dict or step.get('op')!=('M'if i==0 else'L')or type(step.get('points'))is not list or len(step['points'])!=1:_fail()
  point=step['points'][0]
  if type(point)is not dict or not _number(point.get('x'))or not _number(point.get('y')):_fail()
  points.append((point['x'],point['y']))
 if len(points)==5:
  if not all(_close(a,b)for a,b in zip(points.pop(),points[0])):_fail()
 if len(set(points))!=4:_fail()
 xs,ys=zip(*points);lowx,highx,lowy,highy=min(xs),max(xs),min(ys),max(ys);side=_POLICY['squareSideMm']*72/25.4
 if not _close(highx-lowx,side)or not _close(highy-lowy,side)or set(points)!={(lowx,lowy),(lowx,highy),(highx,lowy),(highx,highy)}:_fail()
 for a,b in zip(points,points[1:]+points[:1]):
  if not((_close(a[0],b[0])and not _close(a[1],b[1]))or(_close(a[1],b[1])and not _close(a[0],b[0]))):_fail()
 bounds=plan.get('bounds');clip=plan.get('clipping')
 if type(bounds)is not dict or not all(_close(bounds.get(k),v)for k,v in dict(minX=lowx,maxX=highx,minY=lowy,maxY=highy).items()):_fail()
 if type(clip)is not dict or clip.get('policy')not in('clip','reject')or clip.get('clippedPathIds')!=[]or clip.get('omittedPathIds')!=[]:_fail()
 margin=_POLICY['edgeMarginMm']*72/25.4
 if lowx<margin-1e-6 or lowy<margin-1e-6 or highx>min(mat['widthIn'],material['widthIn'])*72-margin+1e-6 or highy>min(mat['heightIn'],material['heightIn'])*72-margin+1e-6:_fail()
