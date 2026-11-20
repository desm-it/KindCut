"""Offline candidate pipeline; synthetic normalized plan, no device/SDK calls."""
import copy
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
def step(op,*pairs):return {'op':op,'points':[{'x':x,'y':y} for x,y in pairs]}
def plan():
    return {'schemaVersion':2,'machine':'cricut_joy','unit':'pt72','execution':'unsupported',
        'coordinateFrame':'kindcut_canvas_pt72_v1',
        'material':{'widthIn':1,'heightIn':1,'id':1},'mat':{'widthIn':4.5,'heightIn':12},
        'bounds':{'minX':0,'minY':0,'maxX':72,'maxY':72},
        'clipping':{'policy':'clip','clippedPathIds':[],'omittedPathIds':[]},
        'groups':[{'tool':'pen','operation':'draw','paths':[{'id':'art','color':'#000000',
            'steps':[step('M',(0,0)),step('L',(72,0)),step('C',(72,24),(24,72),(0,72)),step('Z')]}]}]}
class OfflineJobTests(unittest.TestCase):
    def module(self):return importlib.import_module('joy_offline_job')
    def compile(self,p=None,**kw):return self.module().compile_offline_job(plan() if p is None else p,parser_selector=0,options_word=0,**kw)

    def test_normalized_absolute_commands_map_to_source_records_without_flattening(self):
        r=self.module().path_records(plan()['groups'][0]['paths'][0]['steps'])
        self.assertEqual([(p.kind,p.x,p.y) for p in r],[(2,0,0),(0,72,0),(1,72,24),(1,24,72),(1,0,72),(0,0,0)])

    def test_close_does_not_duplicate_existing_endpoint_and_new_subpath_resets_start(self):
        r=self.module().path_records([step('M',(1,2)),step('L',(1,2)),step('Z'),step('M',(3,4)),step('L',(5,6)),step('Z')])
        self.assertEqual([(p.kind,p.x,p.y) for p in r],[(2,1,2),(0,1,2),(2,3,4),(0,5,6),(0,3,4)])

    def test_compiler_composes_transfer_and_fixed_batch_bodies_with_explicit_inert_labels(self):
        p=plan();snapshot=copy.deepcopy(p);r=self.compile(p,batch_limit=3)
        self.assertEqual(p,snapshot)
        self.assertEqual(r['execution'],'unsupported');self.assertIs(r['safetyValidated'],False)
        self.assertEqual(r['coordinateMapping'],'kindcut_canvas_pt72_v1')
        self.assertEqual(r['coordinateFrame'], {
            'id':'kindcut_canvas_pt72_v1', 'origin':'logical_canvas_top_left',
            'xAxis':'right', 'yAxis':'down', 'pointsPerInch':72,
            'nativeProjection':'pt72_divided_by_72',
            'physicalOrigin':'unverified', 'physicalAxes':'unverified',
            'vendorTransformStateUsed':False})
        self.assertEqual(r['batching'],'fixed_offline_chunks_not_live_flow_control')
        self.assertEqual(r['bodyTemplates'],{'beginDraw':'21000000','endDraw':'22000000'})
        q=r['groups'][0]['paths'][0];self.assertEqual(q['id'],'art');self.assertEqual(q['color'],'#000000')
        self.assertEqual(q['pointKinds'],[2,0,1,1,1,1,0,2])
        self.assertEqual([len(bytes.fromhex(b)) for b in q['batchBodiesHex']],[28,28,19])
        self.assertTrue(all(bytes.fromhex(b)[0]==0x43 for b in q['batchBodiesHex']))

    def test_blade_compiler_uses_group_specific_selector2_offset_and_keeps_policy_gates(self):
        from joy_tool_geometry import compile_tool_aware_candidate
        p=plan(); p['groups']=[{'tool':'fine_point_blade','operation':'cut','paths':[{'id':'blade','steps':[step('M',(10,10)),step('L',(20,10))]}]}]
        r=compile_tool_aware_candidate(p)
        self.assertEqual(r['strategy']['parserSelector'],2)
        self.assertEqual(r['strategy']['optionsWord'],2)
        self.assertFalse(r['safetyValidated']); self.assertFalse(r['configurationValidated'])
        self.assertEqual(r['execution'],'unsupported')
        self.assertEqual(r['groups'][0]['paths'][0]['pointKinds'][0],2)
        self.assertNotIn('actions',r); self.assertNotIn('send',r)

    def test_blade_allows_compensation_beyond_tight_source_bounds_but_inside_material(self):
        from joy_tool_geometry import compile_tool_aware_candidate
        p=plan(); p['bounds']={'minX':10,'minY':10,'maxX':20,'maxY':10}
        p['groups']=[{'tool':'fine_point_blade','operation':'cut','paths':[{'id':'tight','steps':[step('M',(10,10)),step('L',(20,10))]}]}]
        result=compile_tool_aware_candidate(p)
        self.assertGreater(result['bounds']['maxX'],20)
        self.assertEqual(p['bounds']['maxX'],20)

    def test_generic_pen_strategy_cannot_silently_compile_blade_group(self):
        p=plan();p['groups']=[{'tool':'fine_point_blade','operation':'cut','paths':[{'id':'blade','steps':[step('M',(10,10)),step('L',(20,10))]}]}]
        with self.assertRaises(ValueError):self.compile(p)

    def test_blade_compensation_rejects_geometry_outside_declared_bounds(self):
        from joy_tool_geometry import compile_tool_aware_candidate
        p=plan(); p['bounds']={'minX':0,'minY':0,'maxX':72,'maxY':72}
        p['groups']=[{'tool':'fine_point_blade','operation':'cut','paths':[{'id':'edge','steps':[step('M',(71.9,10)),step('L',(71.9,30))]}]}]
        with self.assertRaises(ValueError): compile_tool_aware_candidate(p)

    def test_mixed_groups_keep_group_specific_compiler_strategy(self):
        from joy_tool_geometry import compile_tool_aware_candidate
        p=plan(); p['groups'].append({'tool':'fine_point_blade','operation':'cut','paths':[{'id':'blade','steps':[step('M',(10,20)),step('L',(30,20))]}]})
        result=compile_tool_aware_candidate(p)
        self.assertEqual([g['strategy'] for g in result['groups']], [
            {'parserSelector':1,'optionsWord':4}, {'parserSelector':2,'optionsWord':2}])
        self.assertEqual(result['strategy']['parserSelector'],1)
        self.assertFalse(result['safetyValidated'])

    def test_tools_paths_and_metadata_preserve_order_without_implicit_tool_commands(self):
        p=plan();p['groups'].append({'tool':'fine_point_blade','operation':'cut','paths':[{'id':'blade','steps':[step('M',(10,10)),step('L',(20,10))]}]})
        with self.assertRaises(ValueError): self.compile(p)

    def test_rejects_unknown_strategy_options_and_job_budgets(self):
        m=self.module()
        for selector in (True,2,3,4,5,None):
            with self.assertRaises(ValueError):m.compile_offline_job(plan(),parser_selector=selector,options_word=0)
        for option in (True,-1,2**32,None):
            with self.assertRaises(ValueError):m.compile_offline_job(plan(),parser_selector=0,options_word=option)
        for limit in (True,0,57,None):
            with self.assertRaises(ValueError):self.compile(batch_limit=limit)
        for limit in (True,0,100001,None,5):
            with self.assertRaises(ValueError):self.compile(max_records=limit)

    def test_rejects_bad_step_shapes_and_implicit_or_relative_commands(self):
        m=self.module()
        cases=[[],[step('L',(1,1))],[step('M',(1,1))],[step('m',(1,1)),step('L',(2,2))],
            [step('M',(1,1)),step('C',(2,2))],[step('M',(1,1)),step('Z'),step('Z')],
            [step('M',(1,1)),step('L',(2,2)),step('Z'),step('L',(3,3))],
            [step('M',(1,1)),{'op':'L','points':[{'x':True,'y':0}]}],
            [step('M',(1,1)),{'op':'L','points':[{'x':1,'y':2,'z':3}]}]]
        for s in cases:
            with self.assertRaises(ValueError):m.path_records(s)

    def test_rejects_missing_foreign_legacy_and_claimed_physical_frames(self):
        for value in (None, '', 'vendor_current', 'kindcut_canvas_pt72_v2',
                      {'id':'kindcut_canvas_pt72_v1','physicalOrigin':'verified'}):
            p=plan();p['coordinateFrame']=value
            with self.subTest(frame=value), self.assertRaises(ValueError):
                self.compile(p)
        p=plan();del p['coordinateFrame']
        with self.assertRaises(ValueError):self.compile(p)
        p=plan();p['schemaVersion']=1
        with self.assertRaises(ValueError):self.compile(p)
        p=plan();p['vendorTransform']=[1,0,0,1,0,0]
        with self.assertRaises(ValueError):self.compile(p)

    def test_frame_projection_reaches_real_encoder_without_axis_flip_or_double_scale(self):
        import struct
        p=plan();p['material']['widthIn']=2
        p['bounds']={'minX':72,'minY':36,'maxX':144,'maxY':36}
        p['groups'][0]['paths'][0]['steps']=[step('M',(72,36)),step('L',(144,36))]
        r=self.compile(p)
        raw=bytes.fromhex(r['groups'][0]['paths'][0]['batchBodiesHex'][0])
        # First and last serialized records; actual interpolation may insert records.
        records=[struct.unpack('<Bff',raw[i:i+9]) for i in range(1,len(raw),9)]
        self.assertEqual(records[0][1:],(1.0,0.5))
        self.assertEqual(records[-1][1:],(2.0,0.5))
        self.assertFalse(r['configurationValidated'])
        self.assertFalse(r['safetyValidated'])
        self.assertEqual(r['execution'],'unsupported')

    def test_rejects_wrong_envelope_and_unknown_fields(self):
        for key,value in [('schemaVersion',True),('machine','cricut_maker'),('unit','in'),('execution','supported'),('groups',[])]:
            p=plan();p[key]=value
            with self.assertRaises(ValueError):self.compile(p)
        p=plan();p['send']=True
        with self.assertRaises(ValueError):self.compile(p)
        p=plan();p['groups'][0]['operation']='cut'
        with self.assertRaises(ValueError):self.compile(p)
        p=plan();p['groups'][0]['paths']*=2
        with self.assertRaises(ValueError):self.compile(p)

    def test_rejects_nonfinite_and_invalid_material_metadata(self):
        for section,key,value in [('mat','widthIn',5),('material','id',True),('material','heightIn',float('nan')),
                                   ('bounds','maxX',float('inf'))]:
            p=plan();p[section][key]=value
            with self.assertRaises(ValueError):self.compile(p)
        p=plan();p['groups'][0]['paths'][0]['steps'][1]['points'][0]['x']=1e-300
        with self.assertRaises(ValueError):self.compile(p)

    def test_worker_does_not_import_offline_compiler_or_add_job_dispatch(self):
        source=(Path(__file__).resolve().parents[1]/'runtime'/'worker.py').read_text()
        self.assertNotIn('joy_offline_job',source)
if __name__=='__main__':unittest.main()
