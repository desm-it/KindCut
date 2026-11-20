"""Real worker with inert peers: general blade inputs do not grant motion approval."""
import copy,unittest
from typing import Any
import test_worker_job_api as fixture
from joy_job_program import compile_job_program
from joy_tool_return import ORIGIN_RETURN_RECORDS
from joy_blade_job import require_blade_job

def request():
 r:dict[str,Any]=fixture.RestrictedCutWorkerTests().request();r.pop('bladeTrial');r['bladeJob']='joy-blade-job-v1';r['plan']['material']['id']=218;r['settings']['materialId']=218;r['pressureRequests']=[223,220]
 r['plan']['groups'][0]['paths'][0]['steps'][2]['points'][0]['x']-=10
 r['plan']['groups'][0]['paths'].append({'id':'curve-and-inner-contour','steps':[{'op':'M','points':[{'x':140,'y':100}]},{'op':'C','points':[{'x':150,'y':80},{'x':180,'y':80},{'x':190,'y':100}]},{'op':'L','points':[{'x':190,'y':150}]},{'op':'L','points':[{'x':140,'y':150}]},{'op':'Z','points':[]},{'op':'M','points':[{'x':155,'y':110}]},{'op':'L','points':[{'x':160,'y':120}]},{'op':'L','points':[{'x':165,'y':110}]},{'op':'Z','points':[]}]})
 r['plan']['bounds'].update(maxX=190,maxY=150);r['programDigest']=compile_job_program(r['plan'],r['settings'],r['pressureResponsesHex'],r['pressureRequests']).digest
 return r

class GeneralBladeTests(unittest.TestCase):
 owner=fixture.WorkerJobTests.owner;wait=fixture.WorkerJobTests.wait
 def test_nonfixture_material_curve_holes_and_recipe_are_admitted(self):
  r=request();require_blade_job(r['plan'],r['settings'],r['pressureRequests'])
 def test_general_cut_needs_new_blade_go_and_preserves_every_record_and_pass(self):
  owner,session=self.owner()
  try:
   r=request();start=owner.handle(r);self.wait(owner,'waiting_for_go');before=list(session.channel.sent)
   with self.assertRaises(PermissionError):owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True})
   self.assertEqual(session.channel.sent,before)
   owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True,'bladeInstalledConfirmed':True})
   held=self.wait(owner,'retained_ready');p=compile_job_program(r['plan'],r['settings'],r['pressureResponsesHex'],r['pressureRequests'])
   expected=b''.join(x for index in range(len(p.passes[0].paths)) for a in p.passes for x in a.paths[index].records) # all passes of each source object
   sent=b''.join(packet[3:]for packet in session.channel.sent if packet[2]==0x43)
   self.assertEqual(sent,expected+b''.join(ORIGIN_RETURN_RECORDS));self.assertEqual(held['completedPasses'],2);self.assertEqual(held['acceptedRecords'],len(expected)//9);self.assertEqual(held['returnToOrigin'],'protocol_complete');self.assertFalse(held['diagnostics']['captureIncomplete'])
   owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':True});self.assertEqual(self.wait(owner)['phase'],'completed')
  finally:owner.close()
 def test_denied_marker_and_noncanonical_inputs_never_load(self):
  for mode in['both','missing','unknown','extra','nan']:
   owner,session=self.owner()
   try:
    r=request()
    if mode=='both':r['bladeTrial']='joy-20mm-square-v1'
    elif mode=='missing':r.pop('bladeJob')
    elif mode=='unknown':r['bladeJob']='wrong'
    elif mode=='extra':r['plan']['groups'][0]['paths'][0]['steps'][0]['points'][0]['approved']=True
    else:r['plan']['groups'][0]['paths'][0]['steps'][0]['points'][0]['x']=float('nan')
    with self.assertRaises((ValueError,PermissionError)):owner.handle(r)
    self.assertEqual(session.channel.sent,[])
   finally:owner.close()
 def test_pen_then_general_blade_uses_one_load_and_a_distinct_go(self):
  owner,session=self.owner()
  try:
   r=request();pen=fixture.WorkerJobTests().request();pen['plan']['material']['id']=218;pen['settings']['materialId']=218;pen['programDigest']=compile_job_program(pen['plan'],pen['settings'],pen['pressureResponsesHex'],pen['pressureRequests']).digest
   a=owner.handle(pen);self.wait(owner,'waiting_for_go');owner.handle({'op':'job','action':'go','operationId':a['operationId'],'toolConfirmed':True});self.wait(owner,'retained_ready')
   nxt={k:copy.deepcopy(r[k])for k in['plan','settings','pressureResponsesHex','pressureRequests','programDigest','jobTimeout','bladeJob']};nxt.update(op='job',action='next',operationId=a['operationId']);before=len(session.channel.sent);b=owner.handle(nxt);self.assertEqual(before,len(session.channel.sent));self.assertNotEqual(a['operationId'],b['operationId'])
   with self.assertRaises(PermissionError):owner.handle({'op':'job','action':'go','operationId':b['operationId'],'toolConfirmed':True})
   owner.handle({'op':'job','action':'go','operationId':b['operationId'],'toolConfirmed':True,'bladeInstalledConfirmed':True});held=self.wait(owner,'retained_ready');self.assertEqual(held['completedPasses'],2);self.assertEqual(sum(p[2]==0x11 for p in session.channel.sent),1)
  finally:owner.close()
 def test_two_pen_colours_then_blade_use_one_load_and_three_distinct_go_actions(self):
  owner,session=self.owner()
  try:
   blade=request();first:dict[str,Any]=fixture.WorkerJobTests().request();first['plan']['material']['id']=218;first['settings']['materialId']=218;first['plan']['groups'][0]['paths'][0]['color']='#445566'
   second:dict[str,Any]=copy.deepcopy(first);second['plan']['groups'][0]['paths'][0]['color']='#778899';second['plan']['groups'][0]['paths'][0]['id']='second-colour'
   for step in second['plan']['groups'][0]['paths'][0]['steps']:
    for point in step['points']:point['x']+=5
   requests=[first,second,blade];expected=b'';last_id=0
   for index,r in enumerate(requests):
    p=compile_job_program(r['plan'],r['settings'],r['pressureResponsesHex'],r['pressureRequests']);r['programDigest']=p.digest
    if index==0:a=owner.handle(r);self.wait(owner,'waiting_for_go')
    else:
     nxt={k:copy.deepcopy(r[k])for k in['plan','settings','pressureResponsesHex','pressureRequests','programDigest','jobTimeout']}
     if 'bladeJob'in r:nxt['bladeJob']=r['bladeJob']
     nxt.update(op='job',action='next',operationId=last_id);before=list(session.channel.sent);a=owner.handle(nxt);self.assertEqual(session.channel.sent,before)
     with self.assertRaises(ValueError):owner.handle({'op':'job','action':'go','operationId':last_id,'toolConfirmed':True})
     self.assertEqual(session.channel.sent,before)
    self.assertGreater(a['operationId'],last_id);last_id=a['operationId'];go={'op':'job','action':'go','operationId':last_id,'toolConfirmed':True}
    if index==2:go['bladeInstalledConfirmed']=True
    owner.handle(go);self.wait(owner,'retained_ready')
    data=(b''.join(rec for path_index in range(len(p.passes[0].paths)) for step in p.passes for rec in step.paths[path_index].records)if index==2 else b''.join(rec for step in p.passes for path in step.paths for rec in path.records))
    expected+=data+b''.join(ORIGIN_RETURN_RECORDS)
   actual=b''.join(packet[3:]for packet in session.channel.sent if packet[2]==0x43);self.assertEqual(actual,expected);self.assertEqual(sum(packet[2]==0x11 for packet in session.channel.sent),1)
   owner.handle({'op':'job','action':'end','operationId':last_id,'endApproved':True});self.assertEqual(self.wait(owner)['phase'],'completed')
  finally:owner.close()
if __name__=='__main__':unittest.main()
