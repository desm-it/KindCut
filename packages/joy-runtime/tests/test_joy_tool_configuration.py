"""Offline config contract; no transport, hardware or dispatch."""
import copy
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_joy_offline_job import plan


class ConfiguredCandidateTests(unittest.TestCase):
    def module(self):
        return importlib.import_module('joy_tool_configuration')

    def config(self):
        return {
            'schemaVersion': 1, 'materialId': 1, 'tool': 'pen', 'operation': 'draw',
            'mode': 'precision', 'context': 0, 'profileId': 'fixture-profile-1',
            'calibrationSource': 'caller_supplied_unverified',
            'pressureRequest': 180,
            'nonXY': {'unit': 'native_unverified', 'cutVelocity': [9, 10, 11],
                      'moveVelocity': [12, 13, 14], 'cutAcceleration': [15, 16, 17],
                      'moveAcceleration': [18, 19, 20]},
            'geometry': {'unit': 'native_unverified',
                         'flags': dict(p_bias_enabled=True, roc_threshold_enabled=True,
                                       t_bias_enabled=True, use_calc_offsets=True,
                                       centered_bl=True, tan_theta=True),
                         'lift_threshold': 1.0, 'parallel_offset': 2.0, 'lagging_offset': 3.0,
                         'nodes': [1, 2, 3, 4, 5]},
            'pressureResponsesHex': [f'a0{n:04x}00000000{n:04x}{n * 10:04x}' for n in range(1, 17)],
            'speeds': {'cutVelocity_ips': [1.0, 1.0], 'moveVelocity_ips': [1.0, 1.0],
                       'cutAcceleration_ips2': [1.0, 1.0], 'moveAcceleration_ips2': [1.0, 1.0]},
        }

    def test_configured_consumer_binds_real_bodies_without_claiming_validation(self):
        p = plan(); before = copy.deepcopy(p); c = self.config(); cbefore = copy.deepcopy(c)
        result = self.module().compile_configured_candidate(p, c)
        self.assertEqual(len(result['configurationBodyTemplates']), 3)
        self.assertFalse(result['configurationValidated'])
        self.assertFalse(result['safetyValidated'])
        self.assertEqual(p, before); self.assertEqual(c, cbefore)

    def test_configured_blade_emits_all_three_source_bound_bodies(self):
        p=plan();p['groups']=[{'tool':'fine_point_blade','operation':'cut','paths':[{'id':'blade','steps':[{'op':'M','points':[{'x':10,'y':20}]},{'op':'L','points':[{'x':30,'y':20}]}]}]}]
        p['bounds']={'minX':10,'minY':20,'maxX':30,'maxY':20}
        c=self.config();c['tool']='fine_point_blade';c['operation']='cut'
        result=self.module().compile_configured_candidate(p,c)
        self.assertEqual([x['kind']for x in result['configurationBodyTemplates']],['machine_state','speed_state','geometry_state'])
        machine=bytes.fromhex(result['configurationBodyTemplates'][0]['bodyHex'])
        self.assertEqual(machine[1],0x08);self.assertEqual(machine[10],0)
        self.assertEqual(machine[-2:],bytes.fromhex('00a0'))
        self.assertEqual(result['strategy']['parserSelector'],2)
        self.assertEqual(result['strategy']['optionsWord'],2)
        self.assertFalse(result['configurationValidated']);self.assertFalse(result['safetyValidated'])
        self.assertEqual(result['execution'],'unsupported')

    def test_pen_pressure_mode_comes_from_art_draw2_not_tool_enum4(self):
        result=self.module().compile_configured_candidate(plan(),self.config())
        machine=bytes.fromhex(result['configurationBodyTemplates'][0]['bodyHex'])
        self.assertEqual(machine[1],0x88);self.assertEqual(machine[10],2)

    def test_resolver_uses_exact_material_and_rejects_unknown_or_unverified_claims(self):
        m = self.module()
        self.assertEqual(m.compile_configured_candidate(plan(), self.config())['execution'], 'unsupported')
        for key, value in [('safetyValidated', True), ('physicalCalibrationVerified', True), ('mystery', 1)]:
            c = self.config(); c[key] = value
            with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)
        c = self.config(); c['materialId'] = 2
        with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)

    def test_resolves_real_decoder_and_interpolator_on_explicit_fixture_without_mutation(self):
        m = self.module(); p = plan(); c = self.config(); before = copy.deepcopy(c)
        resolved = m.resolve_configuration(p, c)
        self.assertEqual(resolved.requested_pressure_native, 180)
        self.assertEqual(resolved.position_counts, 160)
        self.assertEqual(resolved.provenance, 'caller_supplied_unverified')
        self.assertFalse(resolved.physical_calibration_verified)
        self.assertEqual(c, before)

    def test_rejects_bool_nonfinite_and_mismatched_correlated_inputs(self):
        m = self.module()
        for field, value in [('pressureRequest', 0), ('pressureRequest', True), ('pressureRequest', float('inf')),
                             ('context', True), ('materialId', True)]:
            c = self.config(); c[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                m.resolve_configuration(plan(), c)
        c = self.config(); c['speeds']['cutVelocity_ips'][0] = float('nan')
        with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)
        c = self.config(); c['pressureResponsesHex'][0], c['pressureResponsesHex'][1] = c['pressureResponsesHex'][1], c['pressureResponsesHex'][0]
        with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)
        for key, value in [('mode', 'draft'), ('context', 1)]:
            c = self.config(); c[key] = value
            with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)

    def test_rejects_unmatched_tool_configuration_and_invalid_pressure_table(self):
        m = self.module()
        c = self.config(); c['tool'] = 'fine_point_blade'; c['operation'] = 'cut'
        with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)
        c = self.config(); c['pressureResponsesHex'][0] = '00'
        with self.assertRaises(ValueError): m.resolve_configuration(plan(), c)
