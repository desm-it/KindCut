"""Actual worker/job composition with SYNTHETIC peers; never opens hardware."""
import copy
import json
import sys
import time
import unittest
from typing import Any
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import worker
import test_worker_loading_api as loading_fixture
from test_joy_job_program import inputs
from joy_job_program import compile_job_program
from joy_tool_return import ORIGIN_RETURN_RECORDS

class WorkerJobTests(unittest.TestCase):
    def owner(self):
        owner,session=loading_fixture.LoadingApiTests().owner()
        original=session.channel.receive
        def receive(timeout,*,require_encrypted):
            op=session.channel.sent[-1][2]
            if op in (0x43,0x73):
                body=bytes([0,0x43,5,1,2])if op==0x43 else bytes([0x73,0,0,0,0,0])
                return len(body).to_bytes(2,'big')+body
            return original(timeout,require_encrypted=require_encrypted)
        session.channel.receive=receive
        return owner,session

    def request(self,**changes):
        p,s,r,pressures=inputs();program=compile_job_program(p,s,r,pressures)
        request=dict(op='job',action='start',plan=p,settings=s,pressureResponsesHex=r,
            pressureRequests=pressures,programDigest=program.digest,motionApproved=True,
            bladeRemovedConfirmed=True,timeout=30,jobTimeout=60)
        request.update(changes);return request

    def wait(self,owner,phase=None):
        end=time.monotonic()+4
        while time.monotonic()<end:
            state=owner.handle({'op':'job','action':'status'})
            if state['phase']==phase if phase else not state['active']:return state
            time.sleep(.005)
        self.fail('Inert real-worker job did not reach expected phase')

    def test_no_blade_confirmation_still_required_without_claiming_empty_clamp(self):
        for confirm in (False,1,None):
            owner,session=self.owner()
            try:
                with self.assertRaisesRegex(PermissionError,'blade'):
                    owner.handle(self.request(bladeRemovedConfirmed=confirm))
                self.assertEqual(session.channel.sent,[])
            finally:owner.close()

    def test_prepare_is_offline_metadata_not_an_executable_candidate(self):
        p,s,r,pressures=inputs();owner,session=self.owner()
        try:
            try:result=owner.handle(dict(op='configuration',action='prepare_job',plan=p,settings=s,pressureResponsesHex=r,pressureRequests=pressures))
            except ValueError:self.fail('Worker has no offline job-program preparation action')
            self.assertEqual(result['programDigest'],compile_job_program(p,s,r,pressures).digest)
            self.assertEqual(result['passCount'],1);self.assertEqual(result['tool'],'pen')
            self.assertFalse(result['physicalCalibrationVerified']);self.assertNotIn('candidate',result)
            self.assertEqual(session.channel.sent,[])
        finally:owner.close()

    def test_real_loading_go_job_drain_cleanup_is_single_owner(self):
        owner,session=self.owner()
        try:
            try:start=owner.handle(self.request())
            except ValueError:self.fail('Worker has no native job owner')
            ready=self.wait(owner,'waiting_for_go');self.assertFalse(ready['jobStarted'])
            self.assertFalse(any(packet[2] in (0x43,0x73)for packet in session.channel.sent))
            with self.assertRaisesRegex(RuntimeError,'owned'):owner.handle({'op':'status'})
            owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True})
            done=self.wait(owner,'retained_ready')
            self.assertEqual(done['phase'],'retained_ready');self.assertTrue(done['active']);self.assertFalse(done['sessionRetired'])
            self.assertNotIn(bytes.fromhex('000268ff'),session.channel.sent);self.assertNotIn(bytes.fromhex('0002ed01'),session.channel.sent)
            owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':True})
            done=self.wait(owner)
            self.assertEqual(done['phase'],'completed');self.assertTrue(done['sessionRetired'])
            self.assertTrue(done['jobStarted']);self.assertEqual(done['completedPasses'],1)
            self.assertEqual(done['acceptedRecords'],done['totalRecords'])
            self.assertFalse(done['physicalCompletionVerified']);self.assertFalse(done['motionStoppedVerified'])
            self.assertIsNone(owner.session);self.assertEqual(session.state,'closed')
            ops=[packet[2]for packet in session.channel.sent]
            self.assertIn(0x43,ops);self.assertIn(0x73,ops)
            self.assertEqual(ops.count(0x21),3);self.assertEqual(ops.count(0x22),3) # load + draw + return
            d=done['diagnostics'];self.assertFalse(d['captureIncomplete']);self.assertIsNone(d['failure'])
            self.assertTrue(any(e['txHex']and bytes.fromhex(e['txHex'])[2]==0x43 for e in d['events']))
        finally:owner.close()

    def test_denied_bad_digest_and_unknown_fields_do_not_send(self):
        changes=[{'motionApproved':False},{'bladeRemovedConfirmed':1},{'programDigest':'0'*64},
                 {'programDigest':'not-a-digest'},{'jobTimeout':True},{'timeout':float('nan')},
                 {'rawPackets':['000421000000']},{'toolConfirmed':True}]
        for change in changes:
            owner,session=self.owner()
            try:
                with self.subTest(change=change),self.assertRaises((ValueError,PermissionError)):
                    owner.handle(self.request(**change))
                self.assertEqual(session.channel.sent,[])
            finally:owner.close()

    def test_go_requires_fresh_tool_confirmation_and_operation_identity(self):
        owner,_=self.owner()
        try:
            start=owner.handle(self.request());self.wait(owner,'waiting_for_go')
            for change in ({'toolConfirmed':False},{'toolConfirmed':1},{'operationId':True},{'operationId':start['operationId']+1}):
                request={'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True,**change}
                with self.subTest(change=change),self.assertRaises((ValueError,PermissionError)):owner.handle(request)
            self.assertFalse(owner.handle({'op':'job','action':'status'})['jobStarted'])
            owner.handle({'op':'job','action':'cancel','operationId':start['operationId']})
            self.assertEqual(self.wait(owner)['phase'],'cancelled')
        finally:owner.close()

    def test_missing_material_after_go_cannot_send_path_data(self):
        owner,session=self.owner()
        try:
            start=owner.handle(self.request());self.wait(owner,'waiting_for_go')
            session.channel.lost=True
            try:owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True})
            except ValueError:pass # presence monitor may retire before the signal
            done=self.wait(owner)
            self.assertEqual(done['phase'],'failed')
            self.assertFalse(any(p[2]==0x43 for p in session.channel.sent))
        finally:owner.close()

class WorkerQueuePauseTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    request=WorkerJobTests.request
    wait=WorkerJobTests.wait
    # Deliberately exercise the actual worker/SDK owner with a blocked inert ACK.
    def paused_owner(self):
        import threading
        owner,session=self.owner();entered=threading.Event();release=threading.Event()
        old_receive=session.channel.receive;first=[True]
        def receive(timeout,*,require_encrypted):
            if session.channel.sent[-1][2]==0x43 and first[0]:
                first[0]=False;entered.set()
                if not release.wait(2):raise TimeoutError('Inert ACK release missing')
            return old_receive(timeout,require_encrypted=require_encrypted)
        session.channel.receive=receive
        old_sleep=owner._loading_sleep
        def sleep(dt):old_sleep(dt);time.sleep(.005)
        owner._loading_sleep=sleep
        start=owner.handle(self.request());self.wait(owner,'waiting_for_go')
        owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True})
        self.assertTrue(entered.wait(2))
        try:
            try:owner.handle({'op':'job','action':'pause','operationId':start['operationId']})
            except ValueError:self.fail('Worker has no queue-pause control')
        finally:release.set()
        return owner,session,start

    def test_owner_pause_and_fresh_resume_preserve_counts_and_physical_unknown(self):
        owner=None
        try:
            owner,session,start=self.paused_owner();paused=self.wait(owner,'paused')
            self.assertTrue(paused['active']);self.assertFalse(paused['motionStoppedVerified'])
            before=[p for p in session.channel.sent if p[2]==0x43]
            for change in ({'resumeApproved':False},{'resumeApproved':1},{'operationId':True},{'operationId':start['operationId']+1}):
                with self.subTest(change=change),self.assertRaises((PermissionError,ValueError)):
                    owner.handle({'op':'job','action':'resume','operationId':start['operationId'],'resumeApproved':True,**change})
            self.assertEqual([p for p in session.channel.sent if p[2]==0x43],before)
            owner.handle({'op':'job','action':'resume','operationId':start['operationId'],'resumeApproved':True})
            held=self.wait(owner,'retained_ready');self.assertTrue(held['active']);self.assertNotIn(bytes.fromhex('000268ff'),session.channel.sent)
            owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':True})
            done=self.wait(owner);self.assertEqual(done['phase'],'completed')
            self.assertEqual(done['acceptedRecords'],done['totalRecords'])
            self.assertFalse(done['diagnostics']['captureIncomplete']);self.assertFalse(done['motionStoppedVerified'])
            bodies=[p[2:]for p in session.channel.sent if p[2]==0x43]
            expected=b''.join(record for step in owner._job._program.passes for path in step.paths for record in path.records)
            self.assertEqual(b''.join(body[1:]for body in bodies),expected+b''.join(ORIGIN_RETURN_RECORDS))
            with self.assertRaises(ValueError):owner.handle({'op':'job','action':'resume','operationId':start['operationId'],'resumeApproved':True})
            # Late pause/cancel is metadata-only, not an erroneous job replay.
            for action in ('pause','cancel'):
                self.assertEqual(owner.handle({'op':'job','action':action,'operationId':start['operationId']})['phase'],'completed')
        finally:
            if owner is not None:owner.close()

    def test_cancel_paused_owner_never_releases_remaining_data_or_resumes(self):
        owner=None
        try:
            owner,session,start=self.paused_owner();self.wait(owner,'paused')
            count=sum(p[2]==0x43 for p in session.channel.sent)
            owner.handle({'op':'job','action':'cancel','operationId':start['operationId']})
            with self.assertRaises((PermissionError,ValueError)):
                owner.handle({'op':'job','action':'resume','operationId':start['operationId'],'resumeApproved':True})
            done=self.wait(owner);self.assertEqual(done['phase'],'cancelled');self.assertTrue(done['sessionRetired'])
            self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),count)
        finally:
            if owner is not None:owner.close()

    def test_invalidated_paused_stream_is_never_resumable(self):
        owner=None
        try:
            owner,session,start=self.paused_owner();self.wait(owner,'paused')
            count=sum(p[2]==0x43 for p in session.channel.sent)
            with owner._job._lock:
                owner._job._stream_guard.invalidate()
                with self.assertRaises(ValueError):
                    owner.handle({'op':'job','action':'resume','operationId':start['operationId'],'resumeApproved':True})
                owner._job._cancel.set()
            self.wait(owner)
            self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),count)
        finally:
            if owner is not None:owner.close()

class RetainedActionTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    request=WorkerJobTests.request
    wait=WorkerJobTests.wait
    def held(self):
        owner,session=self.owner();req=self.request();start=owner.handle(req);self.wait(owner,'waiting_for_go')
        owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True})
        self.wait(owner,'retained_ready');return owner,session,start,req
    def next_request(self,previous,opid)->dict[str,Any]:
        r={k:copy.deepcopy(previous[k])for k in ('plan','settings','pressureResponsesHex','pressureRequests','programDigest','jobTimeout')}
        for group in r['plan']['groups']:
            for path in group['paths']:
                for step in path['steps']:
                    for point in step['points']:point['x']+=10
        r['plan']['bounds']['minX']+=10;r['plan']['bounds']['maxX']+=10
        r['programDigest']=compile_job_program(r['plan'],r['settings'],r['pressureResponsesHex'],r['pressureRequests']).digest
        return dict(op='job',action='next',operationId=opid,**r)
    def test_two_distinct_programs_share_one_load_and_need_new_go_without_auto_release(self):
        owner,session,start,req=self.held()
        try:
            first=compile_job_program(req['plan'],req['settings'],req['pressureResponsesHex'],req['pressureRequests'])
            count=len(session.channel.sent);owner._loading_sleep(600);time.sleep(.08)
            held=owner.handle({'op':'job','action':'status'});self.assertEqual(held['phase'],'retained_ready');self.assertEqual(len(session.channel.sent),count)
            self.assertNotIn(bytes.fromhex('000268ff'),session.channel.sent);self.assertNotIn(bytes.fromhex('0002ed01'),session.channel.sent)
            with self.assertRaisesRegex(RuntimeError,'owned'):owner.handle({'op':'status'})
            nxt=self.next_request(req,start['operationId'])
            try:armed=owner.handle(nxt)
            except ValueError:self.fail('Next action is still rejected instead of retaining the loaded owner')
            self.assertGreater(armed['operationId'],start['operationId']);self.assertEqual(armed['phase'],'waiting_for_go');self.assertFalse(armed['jobStarted']);self.assertEqual(len(session.channel.sent),count)
            for action,fields in [('go',{'toolConfirmed':True}),('pause',{}),('end',{'endApproved':True})]:
                with self.subTest(action=action),self.assertRaises(ValueError):owner.handle(dict(op='job',action=action,operationId=start['operationId'],**fields))
            owner.handle({'op':'job','action':'go','operationId':armed['operationId'],'toolConfirmed':True})
            second=self.wait(owner,'retained_ready');self.assertEqual(second['diagnostics']['operationId'],armed['operationId']);self.assertFalse(second['diagnostics']['captureIncomplete'])
            next_program=compile_job_program(nxt['plan'],nxt['settings'],nxt['pressureResponsesHex'],nxt['pressureRequests'])
            wanted=b''.join(b''.join(r for step in p.passes for path in step.paths for r in path.records)+b''.join(ORIGIN_RETURN_RECORDS) for p in (first,next_program))
            actual=b''.join(p[3:]for p in session.channel.sent if p[2]==0x43);self.assertEqual(actual,wanted)
            self.assertEqual(sum(p[2]==0x11 for p in session.channel.sent),1);self.assertNotIn(bytes.fromhex('000268ff'),session.channel.sent)
            owner.handle({'op':'job','action':'end','operationId':armed['operationId'],'endApproved':True});done=self.wait(owner)
            self.assertEqual(done['phase'],'completed');self.assertEqual(done['diagnostics']['operationId'],armed['operationId']);self.assertFalse(done['diagnostics']['captureIncomplete']);self.assertFalse(done['motionStoppedVerified'])
            self.assertIsNone(owner.session);self.assertIn(bytes.fromhex('000268ff'),session.channel.sent)
        finally:owner.close()
    def test_end_requires_exact_approval_and_has_no_effect_on_refusal(self):
        owner,session,start,_=self.held()
        try:
            n=len(session.channel.sent)
            for approval in (False,1,None):
                with self.assertRaises(PermissionError):owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':approval})
            self.assertEqual(len(session.channel.sent),n);self.assertEqual(owner.handle({'op':'job','action':'status'})['phase'],'retained_ready')
        finally:owner.close()
    def test_foreign_loaded_binding_or_invalidated_stream_cannot_arm_next(self):
        owner,session,start,req=self.held()
        try:
            n=len(session.channel.sent)
            for mode in ('mat','material','calibration','field'):
                nxt=self.next_request(req,start['operationId'])
                if mode=='mat':nxt['plan']['mat']['heightIn']=6.5
                elif mode=='material':nxt['plan']['material']['id']=2;nxt['settings']['materialId']=2
                elif mode=='calibration':nxt['pressureResponsesHex'][0]=nxt['pressureResponsesHex'][1]
                else:nxt['motionApproved']=True
                if mode in ('mat','material'):
                    nxt['programDigest']=compile_job_program(nxt['plan'],nxt['settings'],nxt['pressureResponsesHex'],nxt['pressureRequests']).digest
                with self.subTest(mode=mode),self.assertRaises((ValueError,RuntimeError,PermissionError)):owner.handle(nxt)
            owner._job._stream_guard.invalidate()
            with self.assertRaises((ValueError,RuntimeError)):owner.handle(self.next_request(req,start['operationId']))
            self.assertEqual(len(session.channel.sent),n)
        finally:owner.close()

class RetainedActionFailureTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    request=WorkerJobTests.request
    wait=WorkerJobTests.wait
    held=RetainedActionTests.held
    next_request=RetainedActionTests.next_request
    def test_material_loss_before_new_go_prevents_all_second_action_data(self):
        owner,session,start,req=self.held()
        try:
            count=sum(p[2]==0x43 for p in session.channel.sent);armed=owner.handle(self.next_request(req,start['operationId']))
            session.channel.lost=True
            owner.handle({'op':'job','action':'go','operationId':armed['operationId'],'toolConfirmed':True})
            failed=self.wait(owner);self.assertEqual(failed['phase'],'failed');self.assertEqual(failed['acceptedRecords'],0)
            self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),count)
            self.assertEqual(failed['diagnostics']['operationId'],armed['operationId']);self.assertTrue(failed['sessionRetired'])
        finally:owner.close()
    def test_explicit_end_timeout_preserves_completed_action_and_never_replays(self):
        owner,session,start,_=self.held()
        try:
            count=sum(p[2]==0x43 for p in session.channel.sent);original=session.channel.receive
            def receive(timeout,*,require_encrypted):
                if session.channel.sent[-1]==bytes.fromhex('0002ed01'):raise TimeoutError('Inert reproduction of actual post-draw disarm timeout')
                return original(timeout,require_encrypted=require_encrypted)
            session.channel.receive=receive
            owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':True})
            failed=self.wait(owner);self.assertEqual(failed['phase'],'failed');self.assertEqual(failed['acceptedRecords'],failed['totalRecords']);self.assertEqual(failed['completedPasses'],failed['totalPasses'])
            self.assertEqual(failed['diagnostics']['failure'],{'stage':'disarming','code':'cleanup_failed','errorType':'TimeoutError'});self.assertTrue(failed['sessionRetired'])
            n=len(session.channel.sent)
            with self.assertRaises(ValueError):owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':True})
            self.assertEqual(len(session.channel.sent),n);self.assertEqual(sum(p[2]==0x43 for p in session.channel.sent),count)
        finally:owner.close()

class RestrictedCutWorkerTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    wait=WorkerJobTests.wait
    def request(self):
        x=json.loads((Path(__file__).resolve().parents[3]/'apps/desktop/native-tests/blade-trial.synthetic.json').read_text())
        request=WorkerJobTests().request();request.update(plan=x['plan'],settings=x['settings'],pressureRequests=x['pressures'],bladeTrial='joy-20mm-square-v1');request['programDigest']=compile_job_program(request['plan'],request['settings'],request['pressureResponsesHex'],request['pressureRequests']).digest;return request
    def test_restricted_three_pass_cut_requires_new_blade_go_and_explicit_end(self):
        owner,session=self.owner()
        try:
            req=self.request();start=owner.handle(req);ready=self.wait(owner,'waiting_for_go');self.assertEqual(ready['tool'],'fine_point_blade');self.assertEqual(ready['totalPasses'],3);before=len(session.channel.sent)
            for confirmed in [None,False,1]:
                go={'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True}
                if confirmed is not None:go['bladeInstalledConfirmed']=confirmed
                with self.assertRaises((PermissionError,ValueError)):owner.handle(go)
                self.assertEqual(len(session.channel.sent),before)
            owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True,'bladeInstalledConfirmed':True})
            held=self.wait(owner,'retained_ready');self.assertEqual(held['phase'],'retained_ready');self.assertEqual(held['completedPasses'],3);self.assertEqual(held['acceptedRecords'],held['totalRecords']);self.assertFalse(session.state=='closed')
            sent=list(session.channel.sent);self.assertNotIn(bytes.fromhex('000268ff'),sent)
            for action in ['pause','resume','next']:
                with self.assertRaises((PermissionError,ValueError)):owner.handle({'op':'job','action':action,'operationId':start['operationId']})
            self.assertEqual(session.channel.sent,sent)
            owner.handle({'op':'job','action':'end','operationId':start['operationId'],'endApproved':True});self.assertEqual(self.wait(owner)['phase'],'completed')
        finally:owner.close()
    def test_bad_policy_or_geometry_rejects_before_lease_or_io(self):
        for mutate in [lambda r:r.pop('bladeTrial'),lambda r:r.__setitem__('bladeTrial',True),lambda r:r['pressureRequests'].pop(),lambda r:r['plan']['groups'][0]['paths'][0]['steps'][1]['points'][0].__setitem__('x',100)]:
            owner,session=self.owner()
            try:
                req=self.request();mutate(req)
                with self.assertRaises((PermissionError,ValueError)):owner.handle(req)
                self.assertEqual(session.channel.sent,[]);self.assertTrue(owner._operation_lock.acquire(blocking=False));owner._operation_lock.release()
            finally:owner.close()
    def test_cut_cancellation_still_retires_the_loaded_session(self):
        owner,session=self.owner()
        try:
            start=owner.handle(self.request());self.wait(owner,'waiting_for_go');owner.handle({'op':'job','action':'cancel','operationId':start['operationId']});state=self.wait(owner);self.assertEqual(state['phase'],'cancelled');self.assertTrue(state['sessionRetired']);self.assertEqual(state['acceptedRecords'],0)
        finally:owner.close()

class PenToBladeWorkflowTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    wait=WorkerJobTests.wait
    def test_pen_then_blade_shares_one_load_and_requires_new_blade_go(self):
        owner,session=self.owner()
        try:
            blade=RestrictedCutWorkerTests().request()
            pen:dict[str,Any]=WorkerJobTests().request()
            # Same source material/mat and calibration, distinct frozen tool action.
            pen['plan']['material']['id']=211;pen['settings']['materialId']=211
            pen['programDigest']=compile_job_program(pen['plan'],pen['settings'],pen['pressureResponsesHex'],pen['pressureRequests']).digest
            start=owner.handle(pen);WorkerJobTests().wait(owner,'waiting_for_go')
            owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True})
            held=self.wait(owner,'retained_ready');self.assertEqual(held['returnToOrigin'],'protocol_complete')
            nxt={k:copy.deepcopy(blade[k])for k in ('plan','settings','pressureResponsesHex','pressureRequests','programDigest','jobTimeout','bladeTrial')}
            nxt.update(op='job',action='next',operationId=start['operationId'])
            before=len(session.channel.sent);armed=owner.handle(nxt)
            self.assertEqual(len(session.channel.sent),before);self.assertEqual(armed['phase'],'waiting_for_go')
            with self.assertRaises(PermissionError):owner.handle({'op':'job','action':'go','operationId':armed['operationId'],'toolConfirmed':True})
            owner.handle({'op':'job','action':'go','operationId':armed['operationId'],'toolConfirmed':True,'bladeInstalledConfirmed':True})
            done=self.wait(owner,'retained_ready');self.assertEqual(done['returnToOrigin'],'protocol_complete')
            self.assertEqual(done['completedPasses'],3);self.assertEqual(sum(p[2]==0x11 for p in session.channel.sent),1)
            self.assertNotIn(bytes.fromhex('000268ff'),session.channel.sent)
            self.assertFalse(done['diagnostics']['captureIncomplete'])
            with self.assertRaises(PermissionError):owner.handle({**nxt,'operationId':armed['operationId']})
        finally:owner.close()

class OriginReturnTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    wait=WorkerJobTests.wait
    request=RestrictedCutWorkerTests.request
    def test_three_pass_tool_has_one_return_after_all_data_before_retained(self):
        owner,session=self.owner()
        try:
            start=owner.handle(self.request());self.wait(owner,'waiting_for_go')
            owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True,'bladeInstalledConfirmed':True})
            held=self.wait(owner,'retained_ready')
            self.assertEqual(held.get('returnToOrigin'),'protocol_complete')
            self.assertEqual((held['acceptedRecords'],held['completedPasses']),(111,3))
            origin=bytes.fromhex('02'+'00'*8)
            bodies=[p[2:]for p in session.channel.sent]
            data=[b for b in bodies if b[0]==0x43]
            self.assertEqual(b''.join(b[1:]for b in data)[-18:],origin*2)
            self.assertEqual(sum(len(b[1:])//9 for b in data),113)
            self.assertEqual(sum(b==b'\x21\0\0\0'for b in bodies),5) # load + three passes + one return
            self.assertFalse(held['diagnostics']['captureIncomplete'])
            self.assertEqual(held['diagnostics']['lastStage'],'retained_ready')
        finally:owner.close()

class OriginFailureTests(unittest.TestCase):
    owner=WorkerJobTests.owner
    wait=WorkerJobTests.wait
    request=RestrictedCutWorkerTests.request
    def test_finishing_fault_never_becomes_retained_or_replays_completed_cut(self):
        for mode in ('timeout','negative','material'):
            owner,session=self.owner()
            try:
                original=session.channel.receive;origin_body=b'\x43'+b''.join(ORIGIN_RETURN_RECORDS)
                def receive(timeout,*,require_encrypted):
                    if session.channel.sent[-1][2:]==origin_body:
                        if mode=='timeout':raise TimeoutError('Inert origin return reply lost')
                        if mode=='negative':return bytes.fromhex('000701430501020100')
                        session.channel.lost=True
                    return original(timeout,require_encrypted=require_encrypted)
                session.channel.receive=receive
                start=owner.handle(self.request());self.wait(owner,'waiting_for_go')
                owner.handle({'op':'job','action':'go','operationId':start['operationId'],'toolConfirmed':True,'bladeInstalledConfirmed':True})
                failed=self.wait(owner);self.assertEqual(failed['phase'],'failed');self.assertEqual(failed['returnToOrigin'],'failed')
                self.assertEqual((failed['acceptedRecords'],failed['completedPasses']),(111,3))
                self.assertEqual(sum(p[2:]==origin_body for p in session.channel.sent),1)
                self.assertFalse(failed['physicalCompletionVerified']);self.assertTrue(failed['sessionRetired'])
                if mode=='timeout':self.assertEqual(session.channel.sent[-1][2:],origin_body)
            finally:owner.close()

if __name__=='__main__':unittest.main()
