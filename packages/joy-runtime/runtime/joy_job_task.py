"""Single worker lease across load, explicit tool Go, job and guarded cleanup.

Only this owner thread touches its session. JSON controls signal/read state;
transport ownership and physical claims never come from renderer metadata.
Live blade admission is limited to the reviewed first-cut square; generic blade jobs remain blocked.
"""
import math
import json
import re
import threading
import time

from typing import Any
from joy_job_program import compile_job_program
from joy_job_diagnostics import JobDiagnostics
from joy_loading_diagnostics import on_diagnostic


class JoyJobTask:
    def __init__(self,owner):
        self.owner=owner
        self._lock=threading.RLock()
        self._thread=None
        self._cancel=threading.Event()
        self._go=threading.Event()
        self._pause=threading.Event()
        self._stream_guard=None
        self._session_identity=None
        self._resumable=False
        self._closing=False
        self._pending=None
        self._wake=threading.Event()
        self._end_requested=False
        self._loaded_binding=None
        self._sequence=0
        self._program=None
        self._diagnostics=None
        self._state:dict[str,Any]=self._snapshot('idle',active=False,retired=False)

    def _snapshot(self,phase,*,active,retired)->dict[str,Any]:
        program=self._program
        previous=getattr(self,'_state',{})
        return dict(operationId=self._sequence,phase=phase,active=active,sessionRetired=retired,
            jobStarted=previous.get('jobStarted',False),programDigest=program.digest if program else None,
            tool=program.tool if program else None,acceptedRecords=previous.get('acceptedRecords',0),
            completedPasses=previous.get('completedPasses',0),
            totalRecords=sum(len(path.records)for step in program.passes for path in step.paths)if program else 0,
            totalPasses=len(program.passes)if program else 0,
            physicalCompletionVerified=False,motionStoppedVerified=False,returnToOrigin=previous.get('returnToOrigin','pending'))

    def _response(self):
        result=dict(self._state)
        if self._diagnostics is not None:result['diagnostics']=self._diagnostics.snapshot()
        return result

    def _phase(self,stage):
        # The retained loader and executor publish only their declared phases.
        with self._lock:
            assert self._diagnostics is not None
            self._resumable=stage=='paused' and not self._cancel.is_set()
            self._diagnostics.stage(stage)
            self._state=self._snapshot(stage,active=True,retired=False)

    def _progress(self,value):
        with self._lock:
            if value.get('returnToOrigin')in('running','protocol_complete'):
                self._state['returnToOrigin']=value['returnToOrigin']
            accepted=value.get('acceptedRecords')
            completed=value.get('completedPasses')
            if type(accepted)is int and self._state['acceptedRecords']<=accepted<=self._state['totalRecords']:
                self._state['acceptedRecords']=accepted
            if type(completed)is int and self._state['completedPasses']<=completed<=self._state['totalPasses']:
                self._state['completedPasses']=completed

    def handle(self,request):
        action=request.get('action')
        if action not in ('start','status','go','cancel','pause','resume','next','end'):raise ValueError('Unsupported job action')
        allowed={'id','op','action'}
        if action=='start':
            allowed|={'plan','settings','pressureResponsesHex','pressureRequests','programDigest',
                      'motionApproved','bladeRemovedConfirmed','timeout','jobTimeout','bladeTrial','bladeJob'}
        elif action in ('go','cancel','pause','resume','end'):
            allowed|={'operationId'}
            if action=='go':allowed|={'toolConfirmed','bladeInstalledConfirmed'}
            if action=='resume':allowed|={'resumeApproved'}
            if action=='end':allowed|={'endApproved'}
        elif action=='next':
            allowed|={'operationId','plan','settings','pressureResponsesHex','pressureRequests','programDigest','jobTimeout','bladeTrial','bladeJob'}
        if set(request)-allowed:raise ValueError('Unexpected job request fields')
        with self._lock:
            if action=='status':return self._response()
            if action=='start':return self._start(request)
            if action=='next':return self._next(request)
            if action=='end':
                if (type(request.get('operationId'))is not int or request['operationId']!=self._sequence
                        or self._state['phase']!='retained_ready'):
                    raise ValueError('Job operation identity is stale')
                if request.get('endApproved') is not True:raise PermissionError('Explicit End approval required')
                self._healthy_retained()
                self._end_requested=True;self._wake.set()
                return self._response()
            if (type(request.get('operationId'))is not int or request['operationId']!=self._sequence):
                raise ValueError('Job operation identity is stale')
            if not self._state['active']:
                if action in ('pause','cancel') and self._state['phase'] in ('completed','cancelled','failed'):
                    return self._response() # Matching terminal race: metadata only.
                raise ValueError('Job operation identity is stale')
            if action in ('go','resume') and self._cancel.is_set():
                raise ValueError('Cancelled job cannot continue')
            cut=self._program is not None and self._program.tool=='fine_point_blade'
            if 'bladeInstalledConfirmed'in request and(not cut or action!='go'):raise ValueError('Blade confirmation forbidden for this operation')
            if cut and action in('pause','resume'):raise PermissionError('Cut pause/resume is disabled')
            if action=='pause':
                if self._state['phase']=='releasing':return self._response()
                if (not self._state['jobStarted'] or self._state['phase'] not in ('setting_up','sending','draining')
                        or self._pause.is_set() or self._cancel.is_set()):
                    raise ValueError('Job is not accepting a queue pause')
                self._pause.set()
            elif action=='resume':
                session=self.owner.session;guard=self._stream_guard
                if (self._state['phase']!='paused' or not self._pause.is_set() or not self._resumable
                        or session is None or id(session)!=self._session_identity or session.state!='ready'
                        or guard is None or not guard._bound or guard._invalidated):
                    raise ValueError('No healthy same-session queue pause to resume')
                if request.get('resumeApproved')is not True:
                    raise PermissionError('Fresh host resume clearance required')
                self._resumable=False;self._pause.clear()
            elif action=='go':
                if cut and request.get('bladeInstalledConfirmed')is not True:raise PermissionError('Fresh explicit blade installation confirmation required')
                if self._state['phase']!='waiting_for_go' or self._go.is_set():
                    raise ValueError('Job is not waiting for fresh tool Go')
                if request.get('toolConfirmed')is not True:
                    raise PermissionError('Fresh host pen/tool confirmation required')
                self._go.set()
            else:self._cancel.set()
            return self._response()

    def _start(self,request):
        if self._closing or self._state['active']:
            raise RuntimeError('Native Joy session operation already owned')
        if request.get('motionApproved')is not True or request.get('bladeRemovedConfirmed')is not True:
            raise PermissionError('Fresh motion approval and blade removal required; matching pen permitted for pen-only trial')
        timeout=request.get('timeout',30)
        job_timeout=request.get('jobTimeout',60)
        for value,cap in ((timeout,60),(job_timeout,600)):
            if type(value)not in(int,float)or not math.isfinite(value)or not 0<value<=cap:
                raise ValueError('Job deadline outside local admission range')
        digest=request.get('programDigest')
        if type(digest)is not str or re.fullmatch('[0-9a-f]{64}',digest)is None:
            raise ValueError('Exact canonical program digest required')
        from joy_blade_trial import BLADE_TRIAL_ID,require_blade_trial
        from joy_blade_job import BLADE_JOB_ID,require_blade_job
        settings=request.get('settings')
        cut=type(settings)is dict and settings.get('tool')=='fine_point_blade'
        if cut:
            if ('bladeTrial' in request)==('bladeJob' in request):raise PermissionError('Exactly one blade marker required')
            if 'bladeTrial' in request:
                if request.get('bladeTrial')!=BLADE_TRIAL_ID:raise PermissionError('Restricted first-cut marker required')
                require_blade_trial(request.get('plan'),settings,request.get('pressureRequests'))
            else:
                if request.get('bladeJob')!=BLADE_JOB_ID:raise PermissionError('General blade marker required')
                require_blade_job(request.get('plan'),settings,request.get('pressureRequests'))
        elif 'bladeTrial'in request or 'bladeJob' in request:raise PermissionError('Blade marker forbidden for pen jobs')
        program=compile_job_program(request.get('plan'),request.get('settings'),
            request.get('pressureResponsesHex'),request.get('pressureRequests'))
        if program.digest!=digest:raise ValueError('Prepared job source changed')
        from joy_job_executor import _validate
        _validate(program) # Entire executor resource/shape admission precedes loading I/O.
        if program.tool not in('pen','fine_point_blade'):raise PermissionError('Unsupported live tool')
        from joy_mat_codec import dimensions
        dimensions(program.mat_height_inches,mat_mode=program.mat_mode)
        if self.owner.platform!='darwin':raise RuntimeError('Native Joy currently supports macOS only')
        if not self.owner._operation_lock.acquire(blocking=False):
            raise RuntimeError('Native Joy session operation already owned')
        try:
            session=self.owner.session
            result=getattr(session,'result',None)
            if (session is None or self.owner._summary is None or session.state!='ready' or result is None
                    or result.selector!=8.164000001 or result.used_fallback is not False):
                raise RuntimeError('Exact initialized original-Joy session required')
            self._sequence+=1
            self._end_requested=False;self._pending=None;self._wake.clear()
            self._loaded_binding=self._binding(request,program)
            self._program=program
            self._cancel=threading.Event();self._go=threading.Event();self._pause=threading.Event()
            self._session_identity=id(session);self._stream_guard=None;self._resumable=False
            self._state={} # Never retain a previous operation's progress/jobStarted.
            self._diagnostics=JobDiagnostics(self._sequence,program,
                clock=getattr(self.owner,'_loading_clock',time.monotonic))
            self._state=self._snapshot('loading_and_aligning',active=True,retired=False)
            self._thread=threading.Thread(target=self._run,args=(timeout,job_timeout),
                name='kindcut-joy-job',daemon=True)
            self._thread.start()
        except BaseException:
            self._state=self._snapshot('failed',active=False,retired=False)
            self.owner._operation_lock.release()
            raise
        return self._response()

    @staticmethod
    def _binding(request,program):
        # Immutable physical setup, not the editable artwork or old cursor.
        return (program.coordinate_frame,json.dumps(request['plan']['mat'],sort_keys=True,separators=(',',':')),
                program.material_id,tuple(request['pressureResponsesHex']))

    def _healthy_retained(self):
        session=self.owner.session;guard=self._stream_guard
        if (self._closing or self._cancel.is_set() or self._end_requested or self._state['phase']!='retained_ready'
                or not self._state['active'] or session is None or id(session)!=self._session_identity
                or session.state!='ready' or guard is None or not guard._bound or guard._invalidated):
            raise ValueError('No healthy same-session retained mat is available')

    def _next(self,request):
        if self._program is not None and self._program.tool!='pen':raise PermissionError('First cut cannot admit another action')
        if type(request.get('operationId'))is not int or request['operationId']!=self._sequence:
            raise ValueError('Job operation identity is stale')
        self._healthy_retained()
        timeout=request.get('jobTimeout',60)
        if type(timeout)not in(int,float)or not math.isfinite(timeout)or not 0<timeout<=600:
            raise ValueError('Job deadline outside local admission range')
        digest=request.get('programDigest')
        if type(digest)is not str or re.fullmatch('[0-9a-f]{64}',digest)is None:
            raise ValueError('Exact canonical program digest required')
        program=compile_job_program(request.get('plan'),request.get('settings'),request.get('pressureResponsesHex'),request.get('pressureRequests'))
        from joy_job_executor import _validate
        _validate(program)
        from joy_blade_trial import BLADE_TRIAL_ID,require_blade_trial
        from joy_blade_job import BLADE_JOB_ID,require_blade_job
        cut=program.tool=='fine_point_blade'
        if cut:
            if self._state.get('returnToOrigin')!='protocol_complete' or ('bladeTrial' in request)==('bladeJob' in request):raise PermissionError('Returned pen owner and exactly one blade marker required')
            if 'bladeTrial' in request:
                if request.get('bladeTrial')!=BLADE_TRIAL_ID:raise PermissionError('Restricted blade marker required')
                require_blade_trial(request['plan'],request['settings'],request['pressureRequests'])
            else:
                if request.get('bladeJob')!=BLADE_JOB_ID:raise PermissionError('General blade marker required')
                require_blade_job(request['plan'],request['settings'],request['pressureRequests'])
        elif program.tool!='pen' or 'bladeTrial' in request or 'bladeJob' in request:raise PermissionError('Unsupported retained tool or marker')
        if program.digest!=digest or self._binding(request,program)!=self._loaded_binding:
            raise ValueError('Next action changed the loaded frame/material/calibration binding')
        self._sequence+=1;self._program=program
        self._go=threading.Event();self._pause=threading.Event();self._resumable=False
        self._diagnostics=JobDiagnostics(self._sequence,program,clock=getattr(self.owner,'_loading_clock',time.monotonic))
        self._diagnostics.stage('waiting_for_go');self._state={}
        self._state=self._snapshot('waiting_for_go',active=True,retired=False)
        self._pending=(program,timeout);self._wake.set()
        return self._response() # Metadata only. The owner awaits a NEW Go.

    def _diagnostic(self,*args,**kwargs):
        # The retained loader outlives an action. Route cleanup into CURRENT
        # diagnostics; never retain a previous operation's recorder closure.
        with self._lock:
            assert self._diagnostics is not None
            on_diagnostic(self._diagnostics)(*args,**kwargs)

    def _wait_next(self):
        from joy_alignment_session import OperationCancelled
        while True:
            with self._lock:
                if self._cancel.is_set():raise OperationCancelled('cancelled')
                if self._end_requested:return None
                if self._pending is not None:
                    pending=self._pending;self._pending=None;return pending
            self._wake.wait(.05);self._wake.clear() # No idle device I/O or deadline release.

    def _host_go(self,timeout):
        self._go.wait(min(timeout,.05))
        return self._go.is_set()

    def _run(self,timeout,job_timeout):
        phase='failed'
        program=self._program
        assert self._diagnostics is not None and program is not None
        callback=self._diagnostic
        try:
            from joy_job_executor import run_job_program
            from joy_alignment_session import OperationCancelled
            options=dict(height_inches=program.mat_height_inches,mat_mode=program.mat_mode,timeout=timeout,point_mode='scalar',
                motion_approved=True,blade_removed_confirmed=True,host_go=self._host_go,
                material_present=None,cancelled=self._cancel.is_set,
                clock=getattr(self.owner,'_loading_clock',time.monotonic),
                sleep=getattr(self.owner,'_loading_sleep',time.sleep),retain_ready=True,
                on_stage=self._phase,on_diagnostic=callback)
            with self.owner._retained_load_owned(**options)as loaded:
                first=True
                while True:
                    if not first:
                        while not self._go.wait(.05):
                            if self._cancel.is_set():raise OperationCancelled('cancelled before next Go')
                    if self._cancel.is_set():raise OperationCancelled('cancelled before execution')
                    with self._lock:
                        self._state['jobStarted']=True
                        self._state['returnToOrigin']='pending'
                        self._stream_guard=loaded.borrower_stream_state
                    # A new budget and mandatory presence/status exchange precede
                    # every program. No stale idle observation authorizes data.
                    result=run_job_program(session=self.owner.session,program=program,
                        borrower_stream_state=loaded.borrower_stream_state,motion_approved=True,
                        tool_confirmed=True,timeout=job_timeout,clock=options['clock'],sleep=options['sleep'],
                        cancelled=self._cancel.is_set,pause_requested=self._pause.is_set,
                        on_stage=self._phase,on_progress=self._progress,on_diagnostic=callback)
                    if result.outcome!='protocol_completion_observed_unverified':raise RuntimeError('Job protocol did not finish')
                    if result.diagnostic_capture_incomplete:raise RuntimeError('Job diagnostic capture incomplete')
                    with self._lock:
                        self._state['acceptedRecords']=result.accepted_records
                        self._state['completedPasses']=result.completed_passes
                    self._phase('retained_ready')
                    following=self._wait_next()
                    if following is None:
                        self._phase('releasing');break
                    program,job_timeout=following;first=False
            phase='completed'
        except Exception as error:
            phase='cancelled'if self._cancel.is_set()else'failed'
            if self._state.get('returnToOrigin')=='running':self._state['returnToOrigin']='failed'
            assert self._diagnostics is not None
            stage=self._diagnostics.snapshot()['lastStage']
            self._diagnostics.failure(stage,'cancelled'if phase=='cancelled'else'operation_failed',error)
        finally:
            with self._lock:self._resumable=False
            try:
                if self.owner.session is not None:
                    callback('closing',kind='cleanup')
                    self.owner._close_owned()
                    callback('closing',kind='cleanup',code='close_returned')
            except Exception as error:
                callback('closing',error=error,kind='cleanup',code='close_failed')
                phase='failed'
            finally:self.owner._operation_lock.release()
            assert self._diagnostics is not None
            diagnostic=self._diagnostics.snapshot()
            if phase=='completed'and(diagnostic['failure']is not None or diagnostic['captureIncomplete']):
                phase='failed'
            with self._lock:
                self._state=self._snapshot(phase,active=False,retired=self.owner.session is None)

    def shutdown(self):
        with self._lock:
            self._closing=True;self._cancel.set();self._wake.set();thread=self._thread
        if thread is not None:
            if thread is threading.current_thread():raise RuntimeError('Job owner cannot join itself')
            thread.join(5)
            if thread.is_alive():raise TimeoutError('Job owner did not finish bounded cleanup')
