"""Bounded worker-owned experimental alignment task; never starts a job.

Control requests only signal/read this owner. Only its thread touches the leased
session. Device status, not renderer assertions, gates material presence.
"""
import math
import threading
import time

from joy_mat_codec import dimensions
from joy_alignment import build_alignment_candidate
from joy_loading_diagnostics import LoadingDiagnostics, on_diagnostic


class JoyLoadingTask:
    def __init__(self, owner):
        self.owner = owner
        self._lock = threading.RLock()
        self._thread = None
        self._cancel = threading.Event()
        self._go = threading.Event()
        self._closing = False
        self._sequence = 0
        self._state = self._snapshot('idle', active=False, retired=False)

    def _snapshot(self, phase, *, active, retired):
        value = dict(operationId=self._sequence, phase=phase, active=active,
                    sessionRetired=retired, physicalLoadingVerified=False,
                    physicalAlignmentVerified=False, motionStoppedVerified=False,
                    jobStarted=False)
        return value

    def _response(self):
        value = dict(self._state)
        if getattr(self, '_diagnostics', None) is not None:
            value['diagnostics'] = self._diagnostics.snapshot()
        return value

    def _phase(self, phase):
        with self._lock:
            if self._state['phase'] == phase:
                return
            self._diagnostics.stage(phase)
            self._state = self._snapshot(phase, active=True, retired=False)

    def _diagnostic_exchange(self, stage, tx=None, rx=None, error=None, **metadata):
        on_diagnostic(self._diagnostics)(stage, tx, rx, error=error, **metadata)

    def handle(self, request):
        action = request.get('action')
        if action not in ('start', 'status', 'go', 'cancel'):
            raise ValueError('Unsupported loading action')
        allowed = {'id', 'op', 'action'}
        allowed |= ({'heightInches', 'timeout', 'motionApproved', 'bladeRemovedConfirmed'}
                    if action == 'start' else {'operationId'} if action in ('go', 'cancel') else set())
        if set(request) - allowed:
            raise ValueError('Unsupported loading request field')
        with self._lock:
            if action == 'status':
                return self._response()
            if action == 'start':
                return self._start(request)
            operation_id = request.get('operationId')
            if type(operation_id) is not int or operation_id != self._sequence or not self._state['active']:
                raise ValueError('Loading operation identity is stale')
            if action == 'go':
                if self._state['phase'] != 'waiting_for_go':
                    raise ValueError('Loading has not reached the host-Go wait')
                self._go.set()
                self._phase('releasing')
            else:
                self._cancel.set()
            return self._response()

    def _start(self, request):
        if self._closing or self._state['active']:
            raise RuntimeError('Native Joy session operation already owned')
        if request.get('motionApproved') is not True or request.get('bladeRemovedConfirmed') is not True:
            raise PermissionError('Fresh motion approval and housing removal required')
        height = request.get('heightInches')
        dimensions(height)
        build_alignment_candidate(point_mode='scalar')
        timeout = request.get('timeout', 30)
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 60:
            raise ValueError('Loading deadline outside local admission range')
        if self.owner.platform != 'darwin':
            raise RuntimeError('Native Joy currently supports macOS only')
        if not self.owner._operation_lock.acquire(blocking=False):
            raise RuntimeError('Native Joy session operation already owned')
        try:
            session = self.owner.session
            result = getattr(session, 'result', None)
            if (session is None or self.owner._summary is None or session.state != 'ready'
                    or result is None or result.selector != 8.164000001 or result.used_fallback is not False):
                raise RuntimeError('Exact initialized original-Joy session required')
            self._sequence += 1
            self._cancel = threading.Event()
            self._go = threading.Event()
            self._diagnostics = LoadingDiagnostics(self._sequence,
                clock=getattr(self.owner, '_loading_clock', time.monotonic))
            self._diagnostics.stage('loading_and_aligning')
            self._state = self._snapshot('loading_and_aligning', active=True, retired=False)
            self._thread = threading.Thread(target=self._run, args=(height, timeout),
                                            name='kindcut-joy-loading', daemon=True)
            self._thread.start()
        except BaseException:
            self._state = self._snapshot('failed', active=False, retired=False)
            self.owner._operation_lock.release()
            raise
        return self._response()

    def _host_go(self, timeout):
        with self._lock:
            if not self._go.is_set():
                self._phase('waiting_for_go')
        # This is a host predicate, not a wire command. Never sleep unboundedly.
        self._go.wait(min(timeout, .05))
        return self._go.is_set()

    def _run(self, height, timeout):
        phase = 'failed'
        try:
            options = dict(height_inches=height, timeout=timeout, point_mode='scalar',
                           motion_approved=True, blade_removed_confirmed=True,
                           host_go=self._host_go, material_present=None,
                           cancelled=self._cancel.is_set,
                           clock=getattr(self.owner, '_loading_clock', time.monotonic),
                           sleep=getattr(self.owner, '_loading_sleep', time.sleep),
                           retain_ready=True, on_stage=self._phase,
                           on_diagnostic=self._diagnostic_exchange)
            with self.owner._retained_load_owned(**options):
                self._phase('releasing')
                # No job API, draw content or caller callback is dispatched here.
            phase = 'completed'
        except Exception as error:
            phase = 'cancelled' if self._cancel.is_set() else 'failed'
            failure_stage = self._diagnostics.snapshot()['lastStage']
            self._diagnostics.failure(failure_stage,
                'cancelled' if phase == 'cancelled' else 'operation_failed', error)
        finally:
            # The owned scope retires on normal/exceptional exits. Never permit
            # reuse after an entry failure, even if no scope was yielded.
            try:
                if self.owner.session is not None:
                    self._diagnostic_exchange('closing', kind='cleanup')
                    self.owner._close_owned()
                    self._diagnostic_exchange('closing', kind='cleanup', code='close_returned')
            except Exception as error:
                self._diagnostic_exchange('closing', error=error, kind='cleanup', code='close_failed')
                phase = 'failed'
            finally:
                self.owner._operation_lock.release()
            diagnostic = self._diagnostics.snapshot()
            if phase == 'completed' and (diagnostic['failure'] is not None or diagnostic['captureIncomplete']):
                # Only classify the terminal outcome; never send extra cleanup.
                phase = 'failed'
            with self._lock:
                self._state = self._snapshot(phase, active=False,
                                             retired=self.owner.session is None)

    def shutdown(self):
        with self._lock:
            self._closing = True
            thread = self._thread
            self._cancel.set()
        if thread is not None:
            if thread is threading.current_thread():
                raise RuntimeError('Loading owner cannot join itself')
            thread.join(5)
            if thread.is_alive():
                # Do not race in-flight I/O with a second cleanup sender.
                raise TimeoutError('Loading owner did not finish bounded cleanup')
