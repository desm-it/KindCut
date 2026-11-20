"""Explicit CardMat contract, source recipes and actual worker with INERT peer only."""
import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_joy_job_program import inputs
import test_worker_job_api as worker_fixture
from joy_job_program import compile_job_program,program_metadata
from joy_mat_codec import dimensions
CATALOG=json.loads((Path(__file__).resolve().parents[3]/'apps/desktop/src/shell/joy-material-catalog.json').read_text())['materials']
def card(tool='pen'):
    p,_,rows,_=inputs();recipe=next(m for m in CATALOG if m['sourceMaterialId']==535 and m['tool']==tool)
    p['mat']={'widthIn':4.5,'heightIn':6.25,'mode':'card'};p['material'].update(id=535,heightIn=6.25)
    p['groups'][0].update(tool=tool,operation='draw' if tool=='pen' else 'cut')
    p['material']['widthIn']=4.5;p['bounds']={'minX':36,'minY':36,'maxX':54,'maxY':54}
    p['groups'][0]['paths']=[{'id':'cardshape','color':'#112233','steps':[{'op':'M','points':[{'x':36,'y':36}]},{'op':'L','points':[{'x':54,'y':36}]},{'op':'L','points':[{'x':54,'y':54}]},{'op':'L','points':[{'x':36,'y':54}]},{'op':'Z','points':[]}]}]
    return p,copy.deepcopy(recipe['settings']),rows,recipe['pressureRequests']
def request(args,action='start',**extra):
    p,s,r,pressures=args;program=compile_job_program(*args)
    result=dict(op='job',action=action,plan=p,settings=s,pressureResponsesHex=r,pressureRequests=pressures,programDigest=program.digest,jobTimeout=60)
    if action=='start':result.update(motionApproved=True,bladeRemovedConfirmed=True,timeout=30)
    result.update(extra);return result
class CardMatTests(unittest.TestCase):
    def test_explicit_mode_and_source_recipes_compile_without_transport(self):
        for tool,pressures in [('pen',[100]),('fine_point_blade',[150,150])]:
            args=card(tool);program=compile_job_program(*args)
            self.assertEqual(program.mat_mode,2);self.assertEqual(program.mat_height_inches,6.25)
            self.assertEqual([p.pressure_request for p in program.passes],pressures)
            self.assertEqual(program_metadata(program)['materialId'],535)
    def test_missing_unknown_or_inconsistent_modes_fail_before_io(self):
        for mat in [{'widthIn':4.5,'heightIn':6.25},{'widthIn':4.5,'heightIn':12},{'widthIn':4.5,'heightIn':6.5,'mode':'card'},{'widthIn':4,'heightIn':6.25,'mode':'card'},{'widthIn':4.5,'heightIn':6.25,'mode':'matless'},{'widthIn':4.5,'heightIn':6.25,'mode':True}]:
            args=list(card());args[0]['mat']=mat
            with self.subTest(mat=mat),self.assertRaises(ValueError):compile_job_program(*args)
    def test_card_dimensions_are_explicit_and_normal_vectors_unchanged(self):
        self.assertEqual(dimensions(6.25,mat_mode=2).hex(),'001211024099999a40c800000000000000000000')
        self.assertEqual(dimensions(6.5).hex(),'001211004099999a40d000000000000000000000')
        self.assertEqual(dimensions(12).hex(),'001211004099999a414000000000000000000000')
        for height,mode in [(6.25,0),(6.5,2),(12,2),(6.25,1),(6.25,True)]:
            with self.subTest(height=height,mode=mode),self.assertRaises(ValueError):dimensions(height,mat_mode=mode)
    def test_actual_worker_retains_card_mode_through_pen_then_two_blade_passes(self):
        f=worker_fixture.WorkerJobTests();owner,session=f.owner()
        try:
            start=owner.handle(request(card()));ready=f.wait(owner,'waiting_for_go')
            dims=[p for p in session.channel.sent if p[2]==0x11];self.assertEqual(dims,[dimensions(6.25,mat_mode=2)])
            self.assertFalse(any(p[2]in(0x43,0x73)for p in session.channel.sent))
            owner.handle(dict(op='job',action='go',operationId=start['operationId'],toolConfirmed=True));f.wait(owner,'retained_ready')
            bad=request(card('fine_point_blade'),'next',operationId=start['operationId'],bladeJob='joy-blade-job-v1');bad['plan']['mat'].pop('mode')
            before=list(session.channel.sent)
            with self.assertRaises(ValueError):owner.handle(bad)
            self.assertEqual(session.channel.sent,before)
            nxt=owner.handle(request(card('fine_point_blade'),'next',operationId=start['operationId'],bladeJob='joy-blade-job-v1'))
            self.assertEqual(nxt['phase'],'waiting_for_go');self.assertEqual(session.channel.sent,before)
            with self.assertRaises(PermissionError):owner.handle(dict(op='job',action='go',operationId=nxt['operationId'],toolConfirmed=True))
            self.assertEqual(session.channel.sent,before)
            owner.handle(dict(op='job',action='go',operationId=nxt['operationId'],toolConfirmed=True,bladeInstalledConfirmed=True));done=f.wait(owner,'retained_ready')
            self.assertEqual(done['completedPasses'],2)
            owner.handle(dict(op='job',action='end',operationId=nxt['operationId'],endApproved=True));end=f.wait(owner)
            self.assertEqual(end['phase'],'completed');self.assertTrue(end['sessionRetired']);self.assertFalse(end['motionStoppedVerified'])
        finally:owner.close()
    def test_standalone_loading_cannot_inject_card_mode(self):
        for extra in ({},{'matMode':2}):
            f=worker_fixture.WorkerJobTests();owner,session=f.owner()
            try:
                with self.assertRaises((ValueError,PermissionError)):owner.handle(dict(op='loading',action='start',heightInches=6.25,motionApproved=True,bladeRemovedConfirmed=True,**extra))
                self.assertEqual(session.channel.sent,[])
            finally:owner.close()
if __name__=='__main__':unittest.main()
