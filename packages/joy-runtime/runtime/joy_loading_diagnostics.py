"""Bounded, secret-safe in-memory diagnostics for one loading attempt."""
import copy
from functools import lru_cache
import math
import re
import threading
import time

MAX_EVENTS = 512
MAX_HEX_CHARS = 1024
_LABEL = re.compile(r'^[a-z][a-z0-9_]{0,63}$')
_SAFE_STAGES = frozenset('loading_and_aligning checking_precheck configuring waiting_for_mat gripped query_precheck starting_measurement measuring_y polling_measurement finishing_measurement ready_for_observation aborting disarming cleanup_unavailable closing positioning alignment_stopped alignment_status_observed_unverified waiting_for_go start go release releasing send receive parse status failure exchange io_error failed completed cancelled timeout material_absent_before_host_go deadline_before_host_go cancelled_before_host_go host_go_observed_no_job_started negative_ack_no_retry'.split())
ERROR_TYPES = frozenset({'ValueError', 'TypeError', 'TimeoutError', 'OperationDeadline', 'OperationCancelled', 'MaterialLost', 'ConnectionError', 'OSError', 'RuntimeError', 'PermissionError', 'UnknownError'})
KNOWN_CODES = frozenset({'malformed_reply','send_failed','receive_failed','cancelled','deadline','material_absent','operation_failed','cleanup_failed','capture_incomplete','close_failed','close_returned'})

@lru_cache(maxsize=1)
def _load_frames():
    from joy_measurement_experiment import measurement_profile
    from joy_mat_codec import dimensions, measurement_request
    from joy_protocol import clear_frame, request
    frames=set()
    for height,mode in ((6.5,0),(12,0),(6.25,2)):
        frames.update(measurement_profile(height,mat_mode=mode)); frames.add(dimensions(height,mat_mode=mode)); frames.add(measurement_request(height))
    frames.update((measurement_request(0),request('status')))
    frames.update(clear_frame(bytes.fromhex(x)) for x in ('ed02','ed01','68ff','7904','7902'))
    try:
        from joy_alignment_session import build_alignment_candidate
        result=build_alignment_candidate(point_mode='scalar')
        bodies=result if isinstance(result,(tuple,list)) else getattr(result,'bodies',())
        frames.update(clear_frame(x) for x in bodies if type(x) is bytes)
    except (ImportError,TypeError,ValueError): pass
    return frozenset(frames)

class LoadingDiagnostics:
    event_limit=MAX_EVENTS
    def __init__(self,operation_id,*,clock=time.monotonic):
        self.operation_id=int(operation_id); self._clock=clock; self._lock=threading.RLock()
        self._events=[]; self._total=self._evicted=0; self._incomplete=False
        self._last_stage='loading_and_aligning'; self._failure=None
        try:
            self._origin=float(clock())
            if not math.isfinite(self._origin): raise ValueError()
        except Exception: self._origin=0.0; self._incomplete=True
    @staticmethod
    def _label(value):
        if type(value) is str and _LABEL.fullmatch(value) and value in _SAFE_STAGES: return value,True
        return 'unknown_stage',False
    def _ms(self,value=None):
        try:
            n=(float(self._clock() if value is None else value)-self._origin)*1000
            if math.isfinite(n) and n>=0:return n
        except Exception: pass
        self._incomplete=True
        return self._events[-1]['atMs'] if self._events else 0.0
    @staticmethod
    def _code(error=None,code=None):
        if code in KNOWN_CODES:return code
        if error is None:return None
        if isinstance(error,TimeoutError):return 'deadline'
        if isinstance(error,InterruptedError):return 'cancelled'
        if isinstance(error,OSError):return 'receive_failed'
        if isinstance(error,ValueError):return 'malformed_reply'
        return 'operation_failed'
    def _append(self,kind,stage,tx=None,rx=None,code=None,started=None):
        stage,valid=self._label(stage)
        if not valid:
            self._incomplete=True; kind='capture_gap'; tx=rx=None; code='capture_incomplete'
        at=self._ms(); at=max(at,self._events[-1]['atMs']) if self._events else at
        start=None if started is None else min(self._ms(started),at)
        self._events.append({'seq':self._total+1,'atMs':at,'startedMs':start,'kind':kind,'stage':stage,'txHex':tx,'rxHex':rx,'code':code})
        self._total+=1
        if len(self._events)>self.event_limit:self._events.pop(0);self._evicted+=1
    def stage(self,stage):
        with self._lock:
            safe,valid=self._label(stage)
            if not valid:self._incomplete=True;self._append('capture_gap','unknown_stage',code='capture_incomplete');return
            if safe==self._last_stage:return
            self._last_stage=safe;self._append('stage',safe)
    def exchange(self,stage,tx=None,rx=None,error=None,*,started=None,kind='exchange',code=None):
        with self._lock:
            safe,valid=self._label(stage)
            allowed=type(tx) is bytes and tx in _load_frames()
            rxok=rx is None or type(rx) is bytes and len(rx)<=MAX_HEX_CHARS//2
            if not valid or not allowed or not rxok:
                self._incomplete=True;self._append('capture_gap',safe if valid else 'unknown_stage',code='capture_incomplete',started=started);return
            txh=tx.hex();rxh=rx.hex() if rx is not None else None
            if len(txh)>MAX_HEX_CHARS or rxh is not None and len(rxh)>MAX_HEX_CHARS:
                self._incomplete=True;self._append('capture_gap',safe,code='capture_incomplete',started=started);return
            if error is not None:
                kind='io_error'; ec=self._code(error,code)
                if self._failure is None:
                    name=type(error).__name__;name=name if name in ERROR_TYPES else 'UnknownError'
                    self._failure={'stage':safe,'code':ec,'errorType':name};self._last_stage=safe
            else: ec=self._code(None,code)
            if kind not in ('exchange','io_error','cleanup','stage','failure'):kind='exchange'
            self._append(kind,safe,txh,rxh,ec,started)
    def failure(self,stage,code=None,error=None):
        with self._lock:
            if self._failure is not None:return
            safe,valid=self._label(stage)
            if not valid:self._incomplete=True
            name=type(error).__name__ if error is not None else 'UnknownError'
            if name not in ERROR_TYPES:name='UnknownError'
            ec=self._code(error,code) or 'operation_failed'
            self._failure={'stage':safe,'code':ec,'errorType':name};self._last_stage=safe;self._append('failure',safe,code=ec)
    def cleanup(self,stage,tx=None,rx=None,error=None,*,started=None,code=None):
        if tx is not None:self.exchange(stage,tx,rx,error,started=started,kind='cleanup',code=code);return
        with self._lock:
            self._append('cleanup',stage,code=self._code(error,code))
            if error is not None and self._failure is None:
                safe,valid=self._label(stage);name=type(error).__name__;name=name if name in ERROR_TYPES else 'UnknownError'
                self._failure={'stage':safe,'code':self._code(error,code),'errorType':name}
    def snapshot(self):
        with self._lock:return copy.deepcopy({'version':1,'operationId':self.operation_id,'lastStage':self._last_stage,'failure':self._failure,'events':self._events,'totalEvents':self._total,'evictedEvents':self._evicted,'captureIncomplete':self._incomplete})

def on_diagnostic(recorder):
    def callback(stage,tx=None,rx=None,error=None,*,started=None,kind='exchange',code=None):
        if kind=='stage':recorder.stage(stage)
        elif kind=='cleanup':recorder.cleanup(stage,tx,rx,error,started=started,code=code)
        elif kind=='failure':recorder.failure(stage,code,error)
        else:recorder.exchange(stage,tx,rx,error,started=started,kind=kind,code=code)
    return callback
