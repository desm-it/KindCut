import sys,json,base64,os,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from device_profile import load_joy_profile
class ProfileTests(unittest.TestCase):
 def test_bundled_profile_has_only_joy_and_no_generic_fallback(self):
  s=load_joy_profile();self.assertEqual(s.record_count,2);self.assertEqual(len(s.select(12,9).material),32)
  with self.assertRaises(ValueError):s.select(12,1)
  with self.assertRaises(ValueError):s.select(11,9)
 def test_invalid_profiles_fail_closed(self):
  source=json.loads((Path(__file__).resolve().parents[1]/'runtime/profiles/cricut-joy.json').read_text())
  with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as d:
   p=Path(d)/'profile.json'
   for mutate in [lambda v:v.update(machine=11),lambda v:v['capabilities'].update(cuts=True),lambda v:v['initializationRecords'][0].update(rawBase64=base64.b64encode(bytes(2)).decode()),lambda v:v['initializationRecords'][0].update(lower=float('nan'))]:
    v=json.loads(json.dumps(source));mutate(v);p.write_text(json.dumps(v))
    with self.assertRaises(ValueError):load_joy_profile(p)
 def test_default_profile_connect_uses_no_cache_or_keychain(self):
  from unittest.mock import patch
  from worker import RuntimeService
  class DeniedTransport:
   def open(self):raise RuntimeError('SYNTHETIC_TRANSPORT_STOP')
   def close(self):pass
  with patch('worker._store',side_effect=AssertionError('Imported material must not be needed')):
   with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_TRANSPORT_STOP'):
    RuntimeService(platform='darwin',transport_factory=lambda _:DeniedTransport()).handle({'op':'connect','hardwareApproved':True,'cryptoResetApproved':True,'address':'00:11:22:33:44:55'})
if __name__=='__main__':unittest.main()
