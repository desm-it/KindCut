import sys,unittest,time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from mat_control import mat_request,control_mat
class MatTests(unittest.TestCase):
 def test_fixed_requests_do_not_accept_cut_or_arbitrary_commands(self):
  self.assertEqual(mat_request('load'),bytes.fromhex('000484010100'))
  self.assertEqual(mat_request('unload'),bytes.fromhex('000484030100'))
  with self.assertRaises(ValueError):mat_request('cut')
 def test_approval_and_session_required_before_writes(self):
  s=SimpleNamespace(state='new')
  with self.assertRaises(PermissionError):control_mat(s,'load')
  with self.assertRaises(RuntimeError):control_mat(s,'load',motion_approved=True)
 def fixture(self,reply):
  sent=[];closed=[]
  s=SimpleNamespace(state='ready',channel=SimpleNamespace(send=lambda *a,**k:sent.append((a,k)),receive=lambda *a,**k:reply),_deadline=lambda t:time.monotonic()+t,_left=lambda d:max(.001,d-time.monotonic()),query_status=lambda **k:{'status_byte_1':104},close=lambda:closed.append(True))
  return s,sent,closed
 def test_acknowledgement_does_not_claim_mat_sensor_confirmation(self):
  s,sent,closed=self.fixture(bytes.fromhex('000414000000'));r=control_mat(s,'load',motion_approved=True)
  self.assertTrue(r['requestAcknowledged']);self.assertFalse(r['matPresenceVerified']);self.assertEqual(len(sent),1);self.assertEqual(closed,[])
 def test_unexpected_response_closes_without_retry(self):
  s,sent,closed=self.fixture(bytes.fromhex('000414010000'))
  with self.assertRaises(ValueError):control_mat(s,'load',motion_approved=True)
  self.assertEqual(len(sent),1);self.assertEqual(closed,[True])
 def test_explicit_device_rejection_remains_visible_without_retry_or_false_success(self):
  s,sent,closed=self.fixture(bytes.fromhex('000801840509ff701000'))
  result=control_mat(s,'unload',motion_approved=True)
  self.assertFalse(result['requestAcknowledged']);self.assertEqual(result['responseCode'],5)
  self.assertEqual(len(sent),1);self.assertEqual(closed,[])
if __name__=='__main__':unittest.main()
