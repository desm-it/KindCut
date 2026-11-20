"""Source c5abc/c5d3c policy, not pressure/preset/physical validity."""
import importlib
from pathlib import Path
import struct
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
class ToolGeometryTests(unittest.TestCase):
    def select(self,**kw):return importlib.import_module('joy_tool_geometry').select_tool_geometry(**kw)
    def test_pen_default_is_native_tool4_art2_curves1_and_options4(self):
        p=self.select(tool='pen',operation='draw')
        self.assertEqual(getattr(p,'parser_selector',None),1)
        self.assertEqual(getattr(p,'parser_options_word',None),4)
        self.assertEqual(getattr(p,'native_art_type',None),2)
        self.assertEqual(getattr(p,'native_tool_type',None),4)
        self.assertEqual(getattr(p,'physical_configuration',None),'unverified')

    def test_blade_default_requires_offset_algorithm2_not_generic_curves(self):
        p=self.select(tool='fine_point_blade',operation='cut')
        self.assertEqual(getattr(p,'parser_selector',None),2)
        self.assertEqual(getattr(p,'parser_options_word',None),2)
        self.assertEqual(getattr(p,'native_art_type',None),1)
        self.assertEqual(getattr(p,'offset_internal',None),struct.unpack('<d',bytes.fromhex('000000a04824f23f'))[0])

    def test_explicit_nonzero_algorithm_preserved_without_custom_offset(self):
        for tool,op in [('pen','draw'),('fine_point_blade','cut')]:
            for algorithm in (1,2,3,4,5):
                p=self.select(tool=tool,operation=op,algorithm_override=algorithm)
                self.assertEqual(getattr(p,'parser_selector',None),algorithm)

    def test_custom_offset_forces_selector2_even_over_override(self):
        p=self.select(tool='pen',operation='draw',algorithm_override=1,custom_offset=0)
        self.assertEqual(getattr(p,'parser_selector',None),2)
        self.assertEqual(getattr(p,'offset_internal',None),0)
        p=self.select(tool='fine_point_blade',operation='cut',custom_offset=.5)
        self.assertEqual(getattr(p,'offset_internal',None),.5)

    def test_strict_supported_pairs_enum_and_numeric_admission(self):
        for tool,op in [('pen','cut'),('fine_point_blade','draw'),('tangential_blade','cut'),(None,'draw')]:
            with self.assertRaises(ValueError):self.select(tool=tool,operation=op)
        for v in (True,-1,6,1.0,None):
            with self.assertRaises(ValueError):self.select(tool='pen',operation='draw',algorithm_override=v)
        for v in (True,-1,'1',float('nan'),float('inf'),1e300):
            with self.assertRaises(ValueError):self.select(tool='pen',operation='draw',custom_offset=v)
    def test_tool_aware_pen_candidate_uses_selector1_options4_and_current_pair_record(self):
        from test_joy_offline_job import plan
        m=importlib.import_module('joy_tool_geometry')
        result=m.compile_tool_aware_candidate(plan())
        self.assertEqual(result['strategy'],{'parserSelector':1,'optionsWord':4,'batchLimit':56})
        self.assertEqual(result['groups'][0]['paths'][0]['pointKinds'],[2,0,0,1,1,1,1,0,2])
        self.assertFalse(result['safetyValidated'])

    def test_tool_aware_blade_candidate_uses_selector2_kernel(self):
        from test_joy_offline_job import plan
        p=plan();g=p['groups'][0];g['tool']='fine_point_blade';g['operation']='cut'
        g['paths'][0]['steps']=[{'op':'M','points':[{'x':10,'y':20}]},{'op':'L','points':[{'x':30,'y':20}]}]
        r=importlib.import_module('joy_tool_geometry').compile_tool_aware_candidate(p)
        self.assertEqual(r['strategy']['parserSelector'],2)
        self.assertEqual(r['strategy']['optionsWord'],2)
        self.assertEqual(r['groups'][0]['strategy'],{'parserSelector':2,'optionsWord':2})

if __name__=='__main__':unittest.main()
