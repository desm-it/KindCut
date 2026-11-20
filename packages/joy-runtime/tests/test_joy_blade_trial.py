"""Pure first-cut policy fixtures; no worker or hardware."""
import copy,json,sys,unittest,importlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
require_blade_trial=importlib.import_module('joy_blade_trial').require_blade_trial
ROOT=Path(__file__).resolve().parents[3]
def fixture():return json.loads((ROOT/'apps/desktop/native-tests/blade-trial.synthetic.json').read_text())
class BladeTrialTests(unittest.TestCase):
 def test_valid_source_square_and_settings(self):
  x=fixture();require_blade_trial(x['plan'],x['settings'],x['pressures'])
 def test_settings_recipe_and_literal_geometry_are_closed(self):
  for mutate in [lambda x:x['pressures'].pop(),lambda x:x['settings'].__setitem__('pressureRequest',True),lambda x:x['settings']['speeds']['moveVelocity_ips'].__setitem__(0,4),lambda x:x['plan'].__setitem__('coordinateFrame','foreign'),lambda x:x['plan']['groups'].append(copy.deepcopy(x['plan']['groups'][0])),lambda x:x['plan']['groups'][0]['paths'][0]['steps'][1]['points'][0].__setitem__('x',100),lambda x:x['plan']['groups'][0]['paths'][0]['steps'].__setitem__(slice(1,3),list(reversed(x['plan']['groups'][0]['paths'][0]['steps'][1:3]))),lambda x:x['plan']['mat'].__setitem__('widthIn','4.5'),lambda x:x['plan']['bounds'].__setitem__('minX',str(x['plan']['bounds']['minX'])),lambda x:x['plan']['clipping']['clippedPathIds'].append('clipped')]:
   x=fixture();mutate(x)
   with self.subTest(x=x),self.assertRaises(ValueError):require_blade_trial(x['plan'],x['settings'],x['pressures'])
 def test_explicit_closure_and_reordered_settings_are_semantic(self):
  x=fixture();steps=x['plan']['groups'][0]['paths'][0]['steps'];steps.insert(-1,{'op':'L','points':copy.deepcopy(steps[0]['points'])});x['settings']=dict(reversed(list(x['settings'].items())));require_blade_trial(x['plan'],x['settings'],x['pressures'])
 def test_unknown_fields_at_every_plan_level_are_rejected(self):
  for pick in [lambda p:p,lambda p:p['material'],lambda p:p['mat'],lambda p:p['bounds'],lambda p:p['clipping'],lambda p:p['groups'][0],lambda p:p['groups'][0]['paths'][0],lambda p:p['groups'][0]['paths'][0]['steps'][0],lambda p:p['groups'][0]['paths'][0]['steps'][0]['points'][0]]:
   x=fixture();pick(x['plan'])['unreviewed']=True
   with self.subTest(pick=pick),self.assertRaises(ValueError):require_blade_trial(x['plan'],x['settings'],x['pressures'])
if __name__=='__main__':unittest.main()
