"""Retain one caller-owned measurement/alignment session through host Go and use.

No discovery, opening, job or Go wire command. Explicit worker activation holds
the service lease; ownership of external aliases remains a caller precondition.
"""
from __future__ import annotations
from contextlib import contextmanager
from dataclasses import dataclass
import threading
import time
from typing import Callable, ContextManager
from joy_measurement_experiment import BorrowerStreamState, measured_session_scope, measurement_profile
from joy_alignment import build_alignment_candidate
from joy_alignment_session import (run_post_measurement_alignment, _Budget, _Stream,
                                   OperationDeadline, OperationCancelled, MaterialLost)

# The legacy scope validates both float/int budgets at runtime despite its
# unannotated integer default; retain the real function with an accurate call view.
_measurement_scope: Callable[..., ContextManager[dict]] = measured_session_scope


@dataclass(frozen=True)
class RetainedLoadOutcome:
    outcome: str
    measurement: object = None  # Diagnostics only, never command authority.
    alignment: object = None
    physical_alignment_verified: bool = False
    borrower_stream_state: BorrowerStreamState | None = None


class RetainedLoadFailed(RuntimeError):
    def __init__(self, result):
        self.result = result
        super().__init__(result.outcome)


class JoyRetainedLoader:
    def __init__(self, session, *, exclusive_session: bool):
        if exclusive_session is not True:
            raise PermissionError('Exclusive supplied-session ownership required')
        self._session = session
        self._lock = threading.Lock()
        self._active = False

    @contextmanager
    def loaded_scope(self, *, height_inches, host_go, material_present, mat_mode=0,
                     cancelled=lambda: False, motion_approved, blade_removed_confirmed,
                     point_mode, timeout=60, clock=time.monotonic, sleep=time.sleep,
                     max_go_polls=300, retain_ready=False, on_stage=lambda stage: None,
                     on_diagnostic=lambda *args, **kwargs: None):
        """Yield AFTER host Go while scope remains open/armed; close on exit.

        Callbacks must return promptly. The yielded signal must be invalidated
        before exit if caller-side I/O makes the stream uncertain. Body errors
        otherwise propagate unchanged after the existing bounded cleanup.
        A software predicate/Go observation does not prove physical readiness.
        """
        if not self._lock.acquire(blocking=False):
            raise RuntimeError('Session operation already owned')
        self._active = True
        try:
            if motion_approved is not True or blade_removed_confirmed is not True:
                raise PermissionError('Fresh motion approval and housing removal required')
            # None disables only an optional external interlock; _Stream always
            # checks actual wire status and material loss before positioning/Go.
            if not callable(host_go) or (material_present is not None and not callable(material_present)):
                raise TypeError('Host Go and material callbacks required')
            if type(max_go_polls) is not int or not 1 <= max_go_polls <= 1000:
                raise ValueError('Go poll count outside local resource bound')
            if type(retain_ready) is not bool or not callable(on_stage):
                raise ValueError('Explicit retained-ready mode and stage callback required')
            # Validate fixed recipe and mode before the first protocol operation.
            measurement_profile(height_inches,mat_mode=mat_mode)
            build_alignment_candidate(point_mode=point_mode)
            budget = _Budget(timeout, clock, cancelled, sleep)
            borrower = BorrowerStreamState()
            report = alignment = None
            yielded = False
            diagnostic_stage = ['loading_and_aligning']
            def phase(stage):
                diagnostic_stage[0] = stage
                on_stage(stage)
            @contextmanager
            def observed_body():
                # Exit before the measured scope: preserve failure BEFORE cleanup.
                try:
                    yield
                except BaseException as error:
                    try:
                        on_diagnostic(diagnostic_stage[0], error=error, kind='failure')
                    except Exception:
                        pass
                    raise
            def measurement_stage(stage):
                if stage in ('waiting_for_mat', 'gripped', 'measuring_y'):
                    phase(stage)
            try:
                with _measurement_scope(self._session, height_inches, mat_mode=mat_mode,
                        motion_approved=motion_approved,
                        blade_removed_confirmed=blade_removed_confirmed,
                        timeout=min(45, budget.remaining()), hold_ready_seconds=0,
                        clock=clock, sleep=sleep, cancelled=cancelled,
                        borrower_stream_state=borrower, on_stage=measurement_stage,
                        on_diagnostic=on_diagnostic) as report, observed_body():
                    phase('positioning')
                    alignment = run_post_measurement_alignment(session=self._session,
                        borrower_stream_state=borrower, material_present=material_present,
                        cancelled=cancelled, motion_approved=motion_approved,
                        blade_removed_confirmed=blade_removed_confirmed,
                        measurement_report=report, point_mode=point_mode, context_byte_8=0,
                        timeout=min(10, budget.remaining()), clock=clock, sleep=sleep, on_diagnostic=on_diagnostic)
                    budget.remaining()
                    if alignment.outcome != 'alignment_status_observed_unverified':
                        raise RetainedLoadFailed(RetainedLoadOutcome('alignment_stopped', report, alignment))
                    phase('waiting_for_go')
                    if retain_ready:
                        budget.end = float('inf')
                    stream = _Stream(self._session, borrower, budget, material_present,
                                     on_diagnostic=on_diagnostic, stage='waiting_for_go')
                    polls = 0
                    while retain_ready or polls < max_go_polls:
                        stream.presence()
                        go = host_go(min(.2, budget.remaining()))
                        if type(go) is not bool:
                            raise ValueError('Host Go must return an explicit boolean')
                        budget.remaining()
                        # A wait callback may have consumed time or lost the mat.
                        stream.presence()
                        if go:
                            result = RetainedLoadOutcome('host_go_observed_no_job_started',
                                                         report, alignment, False, borrower)
                            yielded = True
                            yield result
                            return
                        polls += 1
                        budget.pause()
                    raise OperationDeadline('Go poll budget exhausted')
            except (OperationDeadline, OperationCancelled, MaterialLost) as error:
                if yielded:
                    raise  # Never translate a caller-body exception.
                name = ('deadline_before_host_go' if isinstance(error, OperationDeadline) else
                        'cancelled_before_host_go' if isinstance(error, OperationCancelled) else
                        'material_absent_before_host_go')
                raise RetainedLoadFailed(RetainedLoadOutcome(name, report, alignment)) from error
        finally:
            self._active = False
            self._lock.release()

    def run(self, **options):
        """Compatibility/report API: unlike loaded_scope, returns AFTER cleanup."""
        try:
            with self.loaded_scope(**options) as result:
                return result
        except RetainedLoadFailed as error:
            return error.result
