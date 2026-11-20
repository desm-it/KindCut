"""Synthetic protocol peer ONLY. No Bluetooth or real machine work."""
import importlib,importlib.util,struct,sys,unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
clear_frame = importlib.import_module('joy_protocol').clear_frame

class Clock:
 def __init__(self):self.now=0
 def __call__(self):return self.now
 def sleep(self,seconds):self.now+=seconds
class Peer:
 def __init__(self,fail=None,malformed=False):self.sent=[];self.fail=fail;self.malformed=malformed;self.statuses=iter([0,1]);self.measurements=iter([(True,0),(True,6),(False,12)]);self.ee_count=0
 def send(self,p,*,encrypted,timeout):
  assert encrypted is True and timeout>0;self.sent.append(p)
  if self.fail==p[2]:self.fail=None;raise OSError('synthetic transport failure')
 def receive(self,timeout,*,require_encrypted):
  assert require_encrypted is True and timeout>0;op=self.sent[-1][2]
  if op==0x60:return clear_frame(bytes([0x60,104,next(self.statuses,1)])+b'\0'*6)
  if op==0xee:
   self.ee_count+=1
   if self.ee_count==1:return clear_frame(bytes.fromhex('ee0000000000')) # synthetic typed EE0 precheck
   if self.ee_count==2:return clear_frame(bytes.fromhex('00ee8501ff')) # captured pass31 START ACK, not progress
   if self.malformed:return clear_frame(bytes.fromhex('00ee0501ff'))
   busy,length=next(self.measurements);return clear_frame(bytes([0xee,int(busy)])+struct.pack('>f',length))
  if op in (0x30,0x31,0x3e):return clear_frame(bytes([op])+bytes(len(self.sent[-1])-3))
  if op==0x68:return clear_frame(bytes.fromhex('0068000000'))
  return clear_frame(bytes([0,op,5,1,255]))
class Session:
 def __init__(self,**kw):self.channel=Peer(**kw);self.state='ready';self.result=SimpleNamespace(selector=8.164000001,used_fallback=False)
 def close(self):self.state='closed'

class MeasurementExperimentTests(unittest.TestCase):
 def api(self):
  self.assertIsNotNone(importlib.util.find_spec('joy_measurement_experiment'),'measurement experiment adapter is absent')
  return importlib.import_module('joy_measurement_experiment')
 def run_experiment(self,s=None,**kw):
  s=Session() if s is None else s;c=Clock();opts=dict(motion_approved=True,blade_removed_confirmed=True,clock=c,sleep=c.sleep);opts.update(kw)
  return self.api().run_measurement_experiment(s,12,**opts)
 def test_normal_mat_fallback_emits_native_draw_mode_and_ceil_dimensions(self):
  rows=self.api().measurement_profile(12)
  self.assertEqual(rows[0],bytes.fromhex('000d30880000050c00000000020000'))
  self.assertEqual(rows[0][3],0x88)  # cVarDrawBool bit 7 + flags bit 3
  self.assertEqual(rows[0][-3:],bytes.fromhex('020000'))  # mode 2; uint16 position 0
  self.assertEqual(self.api().measurement_profile(6.5)[0][7],7)
 def test_native_normal_mat_profile_includes_draw2_full_motion_and_geometry(self):
  rows=self.api().measurement_profile(12)
  self.assertEqual(rows[2],clear_frame(b'\x3e\x00\x02'+bytes(17)))
  p=rows[1][2:]
  self.assertEqual(p[:6],bytes.fromhex('310f0f0f0f0f'))
  self.assertEqual(struct.unpack('>20H',p[6:]),(300,300,400,400,1000)+(300,300,400,400,1000)+(1000,1000,2000,2000,2500)+(1000,1000,3860,3860,25000))
 def test_theta_move_velocity_is_native_ten_not_its_move_acceleration(self):
  # Native e2a00 theta+14 is10; +1c is250. Serializer52164 reads+14 for array2.
  words=struct.unpack('>20H',self.api().measurement_profile(12)[1][8:])
  self.assertEqual(words[9],1000)
  self.assertEqual(words[19],25000)
 def test_float_scaled_speed_uses_native_f32_then_round_nearest_away(self):
  rows=self.api().measurement_profile(12)
  # 38.599998474121094 F32 * 100 is rounded in F32 before FCVTAS -> 3860.
  self.assertIn(3860,struct.unpack('>20H',rows[1][8:]))
 def test_observed_type30_zero_payload_reply_is_accepted(self):
  self.assertEqual(clear_frame(bytes.fromhex('30000000040c00000000000000')),bytes.fromhex('000d30000000040c00000000000000'))
  self.assertEqual(self.run_experiment()['outcome'],'measurement_complete')
 def test_profile_reply_policy_rejects_wrong_opcode_error_and_bad_length(self):
  api=self.api(); self.assertTrue(hasattr(api,'_validate_control_reply'))
  for op,request_payload,reply in [(0x30,b'\x30\0',b'\x31\0\0'),(0x31,b'\x31\0',b'\x01\0'),(0x3e,b'\x3e\0',b'\x3e')]:
   with self.subTest(op=op),self.assertRaises(ValueError):api._validate_control_reply(op,request_payload,reply)
 def test_typed_echoes_are_accepted_but_body_is_opaque(self):
  api=self.api()
  for op in (0x30,0x31,0x3e):
   req=bytes([op,1,2]); self.assertTrue(api._validate_control_reply(op,req,bytes([op,9,8])))
 def test_hold_validation_precedes_all_io(self):
  for value in (-1,31,float('nan'),float('inf'),True,'1'):
   s=Session()
   with self.assertRaises(ValueError):self.run_experiment(s,hold_ready_seconds=value)
   self.assertEqual(s.channel.sent,[]);self.assertEqual(s.state,'ready')
 def test_ready_hold_keeps_session_open_and_armed(self):
  s=Session();c=Clock();stages=[];r=self.run_experiment(s,clock=c,sleep=c.sleep,hold_ready_seconds=1,on_stage=stages.append)
  self.assertIn('ready_for_observation',stages);self.assertEqual(s.state,'closed');self.assertEqual(r['outcome'],'measurement_complete')
  ops=[p[2] for p in s.channel.sent];self.assertEqual(ops[-2],0x68);self.assertEqual(ops[-1],0xed)
 def test_lost_mat_during_hold_fails_without_physical_success(self):
  s=Session();s.channel.statuses=iter([0,1,0]);r=self.run_experiment(s,hold_ready_seconds=1)
  self.assertEqual(r['outcome'],'failed');self.assertFalse(r['physicalLoadingVerified']);self.assertTrue(r['cleanup']['abortSent'])
 def test_cancel_during_hold_exits_without_success(self):
  s=Session();flag=[False]
  def stage(value):
   if value=='ready_for_observation':flag[0]=True
  r=self.run_experiment(s,hold_ready_seconds=1,cancelled=lambda:flag[0],on_stage=stage)
  self.assertEqual(r['outcome'],'cancelled');self.assertFalse(r['motionStoppedVerified']);self.assertTrue(r['cleanup']['abortSent'])
 def test_abort_failure_discards_stream_and_closes(self):
  s=Session();s.channel.fail=0x68;r=self.run_experiment(s)
  self.assertNotIn(b'\xed\x01',[p[2:] for p in s.channel.sent]);self.assertTrue(r['cleanup']['closeReturned']);self.assertFalse(r['cleanup']['abortReplyAccepted'])
 def test_timeout_budget_is_capped(self):
  class BudgetPeer(Peer):
   def send(self,p,*,encrypted,timeout):
    self.assert_budget(timeout);super().send(p,encrypted=encrypted,timeout=timeout)
   def assert_budget(self,timeout):assert 0<timeout<=2
  s=Session();s.channel=BudgetPeer();self.run_experiment(s,timeout=10,hold_ready_seconds=0)
 def test_geometry_profile_is_not_tool_actuation(self):
  self.assertEqual(self.api().measurement_profile(12)[2],clear_frame(b'\x3e\x00\x02'+bytes(17)))
 def test_unknown_size_is_denied(self):
  for height in [True,7,13]:
   with self.assertRaises(ValueError):self.api().measurement_profile(height)
 def test_both_operator_approvals_are_required_before_io(self):
  for opts in [dict(motion_approved=False),dict(blade_removed_confirmed=False)]:
   s=Session()
   with self.assertRaises(PermissionError):self.run_experiment(s,**opts)
   self.assertEqual(s.channel.sent,[]);self.assertEqual(s.state,'ready')
 def test_unknown_firmware_is_denied_before_io(self):
  s=Session();s.result.selector=9
  with self.assertRaises(ValueError):self.run_experiment(s)
  self.assertEqual(s.channel.sent,[])
 def test_inert_peer_exercises_full_measurement_and_cleanup(self):
  s=Session();r=self.run_experiment(s);self.assertEqual(r['outcome'],'measurement_complete');self.assertEqual(r['measuredInches'],12);self.assertFalse(r['physicalLoadingVerified']);self.assertTrue(r['cleanup']['disarmReplyReceived']);self.assertEqual(s.state,'closed')
  ops=[p[2] for p in s.channel.sent];self.assertTrue(set(ops)<={0x11,0x79,0xed,0x60,0x30,0x31,0x3e,0xee,0x68});self.assertEqual(ops.count(0x30),1);self.assertEqual(ops.count(0x31),1);self.assertEqual(ops.count(0x3e),1)
  self.assertLess(ops.index(0x31),[i for i,x in enumerate(ops) if x==0xee][1]);self.assertEqual(s.channel.sent[-1],clear_frame(bytes.fromhex('ed01')))
 def test_precheck_precedes_profile_and_start_ack_is_not_progress(self):
  s=Session();stages=[];r=self.run_experiment(s,on_stage=stages.append)
  ops=[p[2:] for p in s.channel.sent]
  ee_packets=[i for i,p in enumerate(s.channel.sent) if p[2]==0xee]
  self.assertEqual(len(ee_packets),5)
  self.assertLess(ee_packets[0],next(i for i,p in enumerate(s.channel.sent) if p[2]==0x30))
  self.assertEqual(r.get('measurementStartAcknowledged'),True)
  self.assertEqual(stages.count('starting_measurement'),1)
  self.assertEqual(stages.count('polling_measurement'),1)
  self.assertEqual(r.get('initiallyMeasuredInches'),0)
 def test_exact_captured_start_ack_not_mistaken_for_measurement(self):
  r=self.run_experiment()
  self.assertEqual(r['outcome'],'measurement_complete')
  self.assertEqual(r.get('initiallyMeasuredInches'),0)
  self.assertEqual(r['measuredInches'],12)
 def test_profile_io_failure_discards_without_starting_measurement(self):
  s=Session(fail=0x31);r=self.run_experiment(s);self.assertEqual(r['outcome'],'failed');self.assertEqual([p[2] for p in s.channel.sent].count(0xee),1);self.assertEqual(s.state,'closed');self.assertFalse(r['cleanup']['disarmReplyReceived']);self.assertEqual(r['cleanup']['disarmSkippedReason'],'channel_unusable')
 def test_ack_only_queries_cannot_complete_and_time_out_without_physical_success(self):
  r=self.run_experiment(Session(malformed=True));self.assertEqual(r['outcome'],'timeout');self.assertFalse(r['physicalLoadingVerified'])
 def test_timeout_waiting_for_insertion_never_starts_measurement(self):
  s=Session();s.channel.statuses=iter([0]*100);r=self.run_experiment(s,timeout=1);self.assertEqual(r['outcome'],'timeout');self.assertNotIn(0xee,[p[2] for p in s.channel.sent])
 def test_cancel_does_not_claim_motion_stopped(self):
  s=Session();r=self.run_experiment(s,cancelled=lambda:True);self.assertEqual(r['outcome'],'cancelled');self.assertFalse(r['motionStoppedVerified']);self.assertEqual(s.state,'closed')
 def test_expired_operation_still_reserves_cleanup_io_budget(self):
  class BudgetPeer(Peer):
   def __init__(self):super().__init__();self.cleanup_budgets=[];self.statuses=iter([0]*100)
   def send(self,p,*,encrypted,timeout):
    if p[2:] in (b'\x68\xff',b'\xed\x01'):self.cleanup_budgets.append(timeout)
    super().send(p,encrypted=encrypted,timeout=timeout)
  s=Session();s.channel=BudgetPeer();r=self.run_experiment(s,timeout=1)
  self.assertEqual(r['outcome'],'timeout');self.assertEqual(s.channel.cleanup_budgets,[2,2])
 def test_cleanup_replies_are_in_trace_and_cleanup_stages_are_visible(self):
  s=Session();trace=[];stages=[]
  self.run_experiment(s,on_trace=lambda p,r:trace.append((p,r)),on_stage=stages.append)
  self.assertEqual([p[2:] for p,_ in trace][-2:],[b'\x68\xff',b'\xed\x01'])
  self.assertEqual(stages[-3:],['aborting','disarming','closing'])
 def test_waiting_cue_occurs_only_after_sensor_arm_exchange(self):
  s=Session();snapshots=[]
  self.run_experiment(s,on_stage=lambda name:snapshots.append((name,[p[2:] for p in s.channel.sent])))
  waiting=next(ops for name,ops in snapshots if name=='waiting_for_mat')
  self.assertEqual(waiting[-1],b'\xed\x02')
 def test_observed_type30_actual_body_runs_through_adapter(self):
  class ObservedPeer(Peer):
   def receive(self,timeout,*,require_encrypted):
    if self.sent[-1][2]==0x30:return clear_frame(bytes.fromhex('30000000040c00000000000000'))
    return super().receive(timeout,require_encrypted=require_encrypted)
  s=Session();s.channel=ObservedPeer();self.assertEqual(self.run_experiment(s)['outcome'],'measurement_complete')
 def test_uncertain_abort_exchange_discards_stream_without_disarm(self):
  class UncertainPeer(Peer):
   def __init__(self):super().__init__();self.pending_abort=False;self.read_after_failure=False
   def send(self,p,*,encrypted,timeout):
    if p[2]==0x68:
     self.sent.append(p);self.pending_abort=True;raise OSError('uncertain write')
    super().send(p,encrypted=encrypted,timeout=timeout)
   def receive(self,timeout,*,require_encrypted):
    if self.pending_abort:
     self.read_after_failure=True;return clear_frame(bytes.fromhex('0068000000'))
    return super().receive(timeout,require_encrypted=require_encrypted)
  s=Session();s.channel=UncertainPeer();r=self.run_experiment(s)
  self.assertFalse(s.channel.read_after_failure)
  self.assertNotIn(b'\xed\x01',[p[2:] for p in s.channel.sent])
  self.assertFalse(r['cleanup']['disarmSent']);self.assertTrue(r['cleanup']['closeReturned'])
 def test_invalid_abort_reply_does_not_start_another_exchange(self):
  class WrongAbortPeer(Peer):
   def receive(self,timeout,*,require_encrypted):
    if self.sent[-1][2]==0x68:return clear_frame(bytes.fromhex('0067000000'))
    return super().receive(timeout,require_encrypted=require_encrypted)
  s=Session();s.channel=WrongAbortPeer();r=self.run_experiment(s)
  self.assertFalse(r['cleanup']['abortReplyAccepted']);self.assertFalse(r['cleanup']['disarmSent'])
  self.assertEqual(s.state,'closed')
if __name__=='__main__':unittest.main()
