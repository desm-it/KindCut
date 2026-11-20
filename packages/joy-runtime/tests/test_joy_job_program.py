"""Program admission fixtures are SYNTHETIC; no worker, hardware or key reads."""
import copy
from dataclasses import FrozenInstanceError
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_joy_offline_job import plan
import test_joy_tool_configuration as fixture
from joy_job_program import compile_job_program


def inputs():
    config=fixture.ConfiguredCandidateTests().config()
    responses=config.pop('pressureResponsesHex');config.pop('calibrationSource')
    return plan(),config,responses,[180]

class JobProgramTests(unittest.TestCase):
    def test_source_program_preserves_every_pass_and_pressure(self):
        p,s,r,_=inputs()
        try:program=compile_job_program(p,s,r,[180,200,180])
        except NotImplementedError:self.fail('Explicit source inputs cannot yet compile an immutable multipass program')
        self.assertEqual(program.material_id,1)
        self.assertEqual(program.tool,'pen');self.assertEqual(program.operation,'draw')
        self.assertEqual([x.pressure_request for x in program.passes],[180,200,180])
        for step in program.passes:
            self.assertEqual([b[0]for b in step.configuration_bodies],[0x30,0x31,0x3e])
            self.assertEqual(len(step.paths),1)
            self.assertTrue(all(type(row)is bytes and len(row)==9 for row in step.paths[0].records))
        self.assertFalse(program.physical_calibration_verified)
        self.assertEqual(program.coordinate_frame,'kindcut_canvas_pt72_v1')
        self.assertEqual(len(program.digest),64)

    def test_program_is_deeply_frozen_and_detached_from_caller(self):
        p,s,r,pressures=inputs();original=copy.deepcopy((p,s,r,pressures))
        program=compile_job_program(p,s,r,pressures);again=compile_job_program(*original)
        p['groups'][0]['paths'][0]['id']='mutated';s['pressureRequest']=2;r[0]='00';pressures.append(2)
        self.assertEqual(program,again)
        with self.assertRaises(FrozenInstanceError):program.material_id=2
        with self.assertRaises(FrozenInstanceError):program.passes[0].pressure_request=2
        self.assertIsInstance(program.passes,tuple);self.assertIsInstance(program.passes[0].paths[0].records,tuple)

    def test_recipe_is_explicit_bounded_and_must_match_primary_setting(self):
        for pressures in ([],[True],[0],[-1],[65536],[180.0],[181],[180]*33,'180'):
            p,s,r,_=inputs()
            with self.subTest(pressures=pressures),self.assertRaises(ValueError):compile_job_program(p,s,r,pressures)

    def test_raw_inspection_candidate_or_material_mismatch_is_not_authority(self):
        p,s,r,pressures=inputs();p['material']['id']=2
        with self.assertRaises(ValueError):compile_job_program(p,s,r,pressures)
        p,s,r,pressures=inputs();p['kind']='native_joy_offline_candidate';p['batchBodiesHex']=['21000000']
        with self.assertRaises(ValueError):compile_job_program(p,s,r,pressures)
        p,s,r,pressures=inputs();r[0]='00'
        with self.assertRaises(ValueError):compile_job_program(p,s,r,pressures)

    def test_blade_and_pen_keep_distinct_source_bound_configuration(self):
        p,s,r,pressures=inputs()
        p['groups']=[{'tool':'fine_point_blade','operation':'cut','paths':[{'id':'blade','steps':[{'op':'M','points':[{'x':10,'y':20}]},{'op':'L','points':[{'x':30,'y':20}]}]}]}]
        p['bounds']={'minX':10,'minY':20,'maxX':30,'maxY':20};s['tool']='fine_point_blade';s['operation']='cut'
        program=compile_job_program(p,s,r,pressures)
        self.assertEqual(program.tool,'fine_point_blade');self.assertEqual(program.operation,'cut')
        self.assertEqual(program.passes[0].configuration_bodies[0][1],0x08)
        self.assertFalse(program.physical_calibration_verified)

if __name__=='__main__':unittest.main()
