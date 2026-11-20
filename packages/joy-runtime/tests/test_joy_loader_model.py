"""Inert policy tests: synthetic events, no transport, worker or hardware."""
import importlib,importlib.util,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))

class LoaderModelTests(unittest.TestCase):
 def make(self,height=12,timeout=30):
  self.assertIsNotNone(importlib.util.find_spec('joy_loader_model'),'inert loader model is not implemented')
  return importlib.import_module('joy_loader_model').LoaderModel(height,timeout=timeout)
 def measuring(self):
  m=self.make();m.handle('start',now=0);m.handle('gripped',now=1);m.handle('safe_profile_verified',now=2);return m
 def test_constructor_is_inert(self):
  m=self.make();self.assertEqual(m.state,'idle');self.assertEqual(m.actions,())
 def test_start_requires_dimensions_ready_light_and_sensor(self):
  m=self.make();self.assertEqual(m.handle('start',now=0),('configure_dimensions','blink_ready','arm_sensor'));self.assertEqual(m.state,'waiting_for_mat')
 def test_ack_does_not_mean_gripped_or_complete(self):
  m=self.make();m.handle('start',now=0);self.assertEqual(m.handle('ack',now=1),());self.assertEqual(m.state,'waiting_for_mat')
 def test_grip_stops_at_noncut_profile_barrier(self):
  m=self.make();m.handle('start',now=0);self.assertEqual(m.handle('gripped',now=1),('set_ready_led','verify_noncut_profile'));self.assertEqual(m.state,'awaiting_safe_profile')
 def test_measurement_cannot_start_before_grip(self):
  m=self.make();m.handle('start',now=0)
  with self.assertRaises(RuntimeError):m.handle('safe_profile_verified',now=1)
  self.assertEqual(m.state,'waiting_for_mat')
 def test_verified_profile_allows_measurement(self):
  m=self.make();m.handle('start',now=0);m.handle('gripped',now=1);self.assertEqual(m.handle('safe_profile_verified',now=2),('start_measurement',));self.assertEqual(m.state,'measuring')
 def test_busy_measurement_is_not_completion(self):
  m=self.measuring();self.assertEqual(m.handle('measurement',now=3,busy=True,length_inches=12),('poll_measurement',));self.assertEqual(m.state,'measuring')
 def test_measured_completion_disarms_without_cut(self):
  m=self.measuring();self.assertEqual(m.handle('measurement',now=3,busy=False,length_inches=12),('disarm_sensor',));self.assertEqual(m.state,'complete')
 def test_short_material_fails_without_retry(self):
  m=self.measuring();self.assertEqual(m.handle('measurement',now=3,busy=False,length_inches=6),('disarm_sensor',));self.assertEqual(m.state,'failed');self.assertEqual(m.error,'material_too_short')
 def test_cancel_is_idempotent_in_each_active_stage(self):
  for events in [[],['start'],['start','gripped'],['start','gripped','safe_profile_verified']]:
   with self.subTest(events=events):
    m=self.make()
    for i,e in enumerate(events):m.handle(e,now=i)
    a=m.handle('cancel',now=4);self.assertEqual(a,('disarm_sensor',) if events else ());self.assertEqual(m.handle('cancel',now=5),());self.assertEqual(m.state,'cancelled')
 def test_timeout_disarms_without_starting_or_retrying(self):
  m=self.make(timeout=3);m.handle('start',now=0);self.assertEqual(m.handle('tick',now=3),('disarm_sensor',));self.assertEqual(m.error,'timeout')
 def test_session_loss_invalidates_grip(self):
  m=self.make();m.handle('start',now=0);m.handle('gripped',now=1);self.assertEqual(m.handle('session_lost',now=2),('disarm_sensor',));self.assertEqual(m.state,'failed')
  with self.assertRaises(RuntimeError):m.handle('safe_profile_verified',now=3)
 def test_invalid_measurements_fail_closed(self):
  for busy,value in [(True,float('nan')),(False,float('inf')),(False,-1),(1,12),(False,True),(False,25),(False,10**1000)]:
   with self.subTest(busy=busy,value=value):
    m=self.measuring();self.assertEqual(m.handle('measurement',now=3,busy=busy,length_inches=value),('disarm_sensor',));self.assertEqual(m.error,'invalid_measurement')
 def test_dimension_and_clock_validation(self):
  for height in [0,7,True,float('nan')]:
   with self.assertRaises(ValueError):self.make(height)
  m=self.make();m.handle('start',now=2)
  with self.assertRaises(ValueError):m.handle('ack',now=1)
 def test_terminal_state_rejects_stale_progress(self):
  m=self.measuring();m.handle('cancel',now=3)
  with self.assertRaises(RuntimeError):m.handle('measurement',now=4,busy=False,length_inches=12)

if __name__=='__main__':unittest.main()
