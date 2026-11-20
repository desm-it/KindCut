"""Object-major blade recipe order, with real compiler and inert transport only."""
import unittest,copy,json,hashlib
from dataclasses import replace
import test_joy_job_executor as executor_fixture
import test_worker_general_blade as blade_fixture
from joy_job_program import compile_job_program
import test_joy_job_program as pen_fixture
from joy_job_executor import run_job_program,ExceptionJobRejected
from joy_alignment_session import OperationCancelled
from joy_tool_return import ORIGIN_RETURN_RECORDS

def inputs():
 r=blade_fixture.request();r['pressureRequests']=[223,220,210];return r

def compiled():
 r=inputs();return compile_job_program(r['plan'],r['settings'],r['pressureResponsesHex'],r['pressureRequests'])

def object_records(p):return b''.join(record for index in range(len(p.passes[0].paths)) for step in p.passes for record in step.paths[index].records)

class ObjectPassOrderTests(unittest.TestCase):
 def test_blade_completes_every_pressure_pass_of_one_object_before_next(self):
  session,guard,_=executor_fixture.fixture();p=compiled()
  result=run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True,max_status_polls=5)
  data=b''.join(packet[3:]for packet in session.channel.sent if packet[2]==0x43)
  self.assertEqual(data,object_records(p)+b''.join(ORIGIN_RETURN_RECORDS));self.assertEqual(result.completed_passes,3);self.assertEqual(result.accepted_records,len(object_records(p))//9)
 def test_each_object_keeps_all_unequal_pressure_specific_configuration_bodies(self):
  session,guard,_=executor_fixture.fixture();p=compiled();run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True,max_status_polls=5)
  actual=[packet[2:]for packet in session.channel.sent if packet[2]in(0x30,0x31,0x3e)]
  expected=[body for _ in p.passes[0].paths for step in p.passes for body in step.configuration_bodies];self.assertEqual(actual,expected)
 def test_cancel_between_objects_never_sends_any_later_object_or_origin_return(self):
  session,guard,_=executor_fixture.fixture();p=compiled();first=b''.join(record for step in p.passes for record in step.paths[0].records);flag=[False]
  def progress(v):
   if v.get('acceptedRecords',0)>=len(first)//9:flag[0]=True
  with self.assertRaises(OperationCancelled):run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True,cancelled=lambda:flag[0],on_progress=progress,max_status_polls=5)
  self.assertEqual(b''.join(packet[3:]for packet in session.channel.sent if packet[2]==0x43),first)
 def test_misaligned_object_identity_across_recipe_passes_is_rejected_before_io(self):
  session,guard,_=executor_fixture.fixture();p=compiled();p=replace(p,passes=(p.passes[0],replace(p.passes[1],paths=tuple(reversed(p.passes[1].paths))),p.passes[2]))
  with self.assertRaises(ExceptionJobRejected):run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True)
  self.assertEqual(session.channel.sent,[])
 def test_blade_prepared_digest_binds_the_changed_execution_order(self):
  r=inputs();p=compiled();source={'plan':r['plan'],'settings':r['settings'],'calibration':r['pressureResponsesHex'],'pressures':r['pressureRequests'],'executionOrder':'object-major-v1'}
  self.assertEqual(p.digest,hashlib.sha256(json.dumps(source,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest())
 def test_pen_keeps_its_existing_pass_major_order_and_digest(self):
  plan,settings,rows,_=pen_fixture.inputs();other=copy.deepcopy(plan['groups'][0]['paths'][0]);other['id']='second-pen-path';plan['groups'][0]['paths'].append(other);pressures=[180,200];p=compile_job_program(plan,settings,rows,pressures)
  binding={'plan':plan,'settings':settings,'calibration':rows,'pressures':pressures};self.assertEqual(p.digest,hashlib.sha256(json.dumps(binding,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest())
  session,guard,_=executor_fixture.fixture();run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True,max_status_polls=5)
  self.assertEqual(b''.join(packet[3:]for packet in session.channel.sent if packet[2]==0x43),b''.join(r for step in p.passes for path in step.paths for r in path.records)+b''.join(ORIGIN_RETURN_RECORDS))
 def test_global_pass_progress_is_monotonic_and_never_multiplied_by_objects(self):
  session,guard,_=executor_fixture.fixture();p=compiled();seen=[];run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True,on_progress=seen.append,max_status_polls=5)
  counts=[v['completedPasses']for v in seen if 'completedPasses'in v];self.assertEqual(counts,sorted(counts));self.assertEqual(max(counts),3)
  first_count=sum(len(step.paths[0].records)for step in p.passes);self.assertTrue(all(v.get('completedPasses',0)==0 for v in seen if v.get('acceptedRecords',0)<=first_count));self.assertEqual(seen[-1]['returnToOrigin'],'protocol_complete')
 def test_negative_data_ack_never_advances_to_a_later_object_or_replays(self):
  session,guard,_=executor_fixture.fixture();p=compiled();original=session.channel.receive
  def receive(timeout,*,require_encrypted):
   if session.channel.sent[-1][2]==0x43:return bytes([0,7,1,0x43,0,0,0,1,0])
   return original(timeout,require_encrypted=require_encrypted)
  session.channel.receive=receive
  with self.assertRaises(ExceptionJobRejected):run_job_program(session=session,program=p,borrower_stream_state=guard,motion_approved=True,tool_confirmed=True,max_status_polls=5)
  # A valid negative ACK is rejected here; the caller-owned scope retires the session.
  data=[packet[3:]for packet in session.channel.sent if packet[2]==0x43];self.assertEqual(len(data),1);self.assertEqual(data[0],b''.join(p.passes[0].paths[0].records[:56]))
if __name__=='__main__':unittest.main()
