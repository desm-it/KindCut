"""Pure profile schema and worker integration tests; all values synthetic."""
import copy
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_joy_tool_configuration as fixtures
from test_joy_offline_job import plan


def settings():
    value=fixtures.ConfiguredCandidateTests().config()
    del value['pressureResponsesHex'];del value['calibrationSource']
    return value

class ConfigurationWorkflowTests(unittest.TestCase):
    def module(self):return importlib.import_module('joy_configuration_workflow')
    def test_validates_settings_without_fabricating_calibration(self):
        s=settings();before=copy.deepcopy(s)
        result=self.module().validate_settings(s)
        self.assertEqual(result,s);self.assertEqual(s,before)
        self.assertNotIn('pressureResponsesHex',result)
    def test_rejects_unknown_fields_flags_nan_and_missing_axis(self):
        for change in [lambda s:s.update(safetyValidated=True),lambda s:s.update(pressureRequest=True),lambda s:s['nonXY'].pop('cutVelocity'),lambda s:s['geometry']['flags'].update(tan_theta=1),lambda s:s['speeds'].update(cutVelocity_ips=[float('nan'),1])]:
            s=settings();change(s)
            with self.assertRaises(ValueError):self.module().validate_settings(s)
    def test_compiles_actual_settings_and_table_without_device(self):
        s=settings();rows=fixtures.ConfiguredCandidateTests().config()['pressureResponsesHex']
        result=self.module().compile_profile(plan(),s,rows)
        self.assertEqual(result['execution'],'unsupported')
        self.assertFalse(result['safetyValidated'])
        self.assertEqual(len(result['configurationBodyTemplates']),3)
    def test_worker_exposes_inert_configuration_without_transport(self):
        from worker import RuntimeService
        service=RuntimeService(platform='darwin',transport_factory=lambda _:self.fail('No transport allowed'))
        result=service.handle({'op':'configuration','action':'validate','settings':settings()})
        self.assertEqual(result['settings'],settings())
        self.assertIsNone(service.session)
        with self.assertRaises(ValueError):service.handle({'op':'configuration','action':'validate','settings':settings(),'motionApproved':True})
    def test_calibration_requires_fresh_approval_and_exact_session_before_access(self):
        from worker import RuntimeService
        service=RuntimeService(platform='darwin',transport_factory=lambda _:self.fail('No transport allowed'))
        with self.assertRaises(PermissionError):service.handle({'op':'calibration','action':'read','readApproved':False,'timeout':8})
        with self.assertRaises(RuntimeError):service.handle({'op':'calibration','action':'read','readApproved':True,'timeout':8})
        self.assertIsNone(service.transport)
