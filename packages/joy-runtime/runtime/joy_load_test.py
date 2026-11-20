"""Developer load-only test entry point. Default invocation is an inert plan.

NOT normal app loading support. Never execute without fresh operator approval,
removed blade HOUSING, clear rollers and exclusive device ownership. Does not
import vendor data or implement jobs/paths/cuts. CLI flags are an accidental-use
interlock, not a substitute for the operator's current approval in the chat.
"""
import argparse
import json
import math
from pathlib import Path
import re
import os
import signal
import subprocess
import threading
import time
import stat
import io


class TelemetryOutputError(Exception):
    """CLI output could not be written without blocking or truncation."""


_cli_writer = None


def _write_record(record):
    data = (json.dumps(record, allow_nan=False, separators=(',', ':')) + '\n').encode('utf-8')
    if len(data) > 4096:
        raise TelemetryOutputError('Telemetry record too large')
    if _cli_writer is not None:
        _cli_writer(data)
        return
    # Captured StringIO is retained for hardware-free tests; it is explicitly
    # a trusted in-process sink, never used as an execution CLI fallback.
    import sys
    stream = sys.stdout
    if isinstance(stream, io.StringIO):
        stream.write(data.decode('utf-8'))
        stream.flush()
        return
    raise TelemetryOutputError('CLI output sink is not configured')


def select_device(devices):
    if not isinstance(devices, list) or len(devices) > 256:
        raise ValueError('Invalid discovered device list')
    candidates = []
    for item in devices:
        if not isinstance(item, dict):
            continue
        name, address = item.get('name'), item.get('address')
        if (isinstance(name, str) and len(name) <= 128
                and re.search(r'^joy(?:[- ]|$)', name, re.I)
                and not re.search(r'xtra|explore|maker|air', name, re.I)
                and isinstance(address, str)
                and re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', address)
                and item.get('paired') is True):
            candidates.append(item)
    if len(candidates) != 1 or candidates[0].get('connected') is not False:
        raise ValueError('Require one unambiguous paired, disconnected original Joy')
    return candidates[0]


def discover_devices():
    helper = Path(__file__).parent / 'bluetooth' / 'joy_rfcomm'
    result = subprocess.run([str(helper), '--devices'], check=True, capture_output=True,
                            text=True, timeout=8)
    if len(result.stdout) > 65536:
        raise ValueError('Device list too large')
    data = json.loads(result.stdout)
    if not isinstance(data, dict) or data.get('ok') is not True:
        raise ValueError('Device discovery failed')
    return data.get('devices')


def require_no_owner():
    # Conservative process snapshot, not an atomic cross-application lock. The
    # operator must quit KindCut and Design Space before this developer test.
    result = subprocess.run(['ps', '-axo', 'pid=,command='], check=True,
                            capture_output=True, text=True, timeout=3)
    ignored = {os.getpid(), os.getppid()}
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit() or int(parts[0]) in ignored:
            continue
        if re.search(r'(?:^|[/\s])joy_rfcomm(?:\s|$)|CricutDevice|worker\.py\s+--stdio', parts[1]):
            raise RuntimeError('Another possible device owner is active; quit it before testing')


def run_load_test(*, session_approved=False, motion_approved=False,
                  blade_removed_confirmed=False, height_inches=12, timeout=45,
                  hold_ready_seconds=10, discover=None, owner_check=None,
                  service_factory=None, experiment=None, cancelled=lambda:False,
                  on_stage=lambda stage:None, on_trace=lambda packet,reply:None):
    if any(value is not True for value in
           (session_approved, motion_approved, blade_removed_confirmed)):
        raise PermissionError('Fresh session-reset/motion approval and removed blade housing required')
    if type(height_inches) not in (int, float) or height_inches not in (6.5, 12):
        raise ValueError('Unsupported original-Joy mat')
    for value, maximum in ((timeout, 45), (hold_ready_seconds, 30)):
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
            raise ValueError('Invalid bounded deadline')
    if timeout <= 0:
        raise ValueError('Invalid bounded deadline')
    def cancel_report():
        return {'outcome':'cancelled', 'physicalLoadingVerified':False, 'motionStoppedVerified':False}
    if cancelled():
        return cancel_report()
    if service_factory is None:
        from worker import RuntimeService
        service_factory = RuntimeService
    if experiment is None:
        from joy_measurement_experiment import run_measurement_experiment
        experiment = run_measurement_experiment
    owner_check = require_no_owner if owner_check is None else owner_check
    discover = discover_devices if discover is None else discover
    owner_check()
    if cancelled():
        return cancel_report()
    device = select_device(discover())
    owner_check()  # Recheck after discovery, immediately before creating an owner.
    if cancelled():
        return cancel_report()
    service = service_factory()
    try:
        # Explicit policy: an in-progress bounded connection/crypto handshake
        # finishes or times out before cancellation is observed. No mat operation
        # is dispatched afterwards if cancellation arrived during initialization.
        on_stage('connecting_initializing_cancel_deferred')
        if cancelled():
            return cancel_report()
        service.handle({'op':'connect', 'address':device['address'],
                        'hardwareApproved':True, 'cryptoResetApproved':True, 'timeout':20})
        if cancelled():
            return cancel_report()
        session = service.session
        result = getattr(session, 'result', None)
        if (getattr(session, 'state', None) != 'ready' or result is None
                or getattr(result, 'selector', None) != 8.164000001
                or getattr(result, 'used_fallback', None) is not False):
            raise ValueError('Initialized original Joy with exact selector/no fallback required')
        return experiment(session, height_inches, motion_approved=True,
                          blade_removed_confirmed=True, timeout=timeout,
                          hold_ready_seconds=hold_ready_seconds, cancelled=cancelled,
                          on_stage=on_stage, on_trace=on_trace)
    finally:
        service.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--approve-session-reset', action='store_true')
    parser.add_argument('--approve-motion', action='store_true')
    parser.add_argument('--blade-housing-removed', action='store_true')
    parser.add_argument('--mat-height', type=float, choices=(6.5, 12), default=12)
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps({'mode':'plan_only', 'hardwareAccess':False, 'matHeight':args.mat_height,
            'maximumOperationSeconds':45, 'readyObservationSeconds':10,
            'measurementPhases':['precheck','start_acknowledgment','progress_queries','finishing_wait','observation'],
            'startReplyIsCompletion':False, 'xyPositioningIncluded':False,
            'finishingWaitSeconds':int((args.mat_height/3)*1000)/1000,
            'initializationChanges':['Bluetooth connection','crypto reset','key negotiation'],
            'initializationCancellation':'deferred until bounded connect/handshake returns or times out; no mat operation then',
            'motionScope':'sensor grip and firmware mat measurement only',
            'completion':'typed measurement then bounded observation; not physical proof',
            'cleanup':'best-effort abort68ff, sensor disarm, close; stop NOT verified',
            'cuts':False, 'requiresFreshApproval':True}, separators=(',',':')))
        return 0
    cancel = threading.Event()
    previous = {}
    started = time.monotonic()
    global _cli_writer
    fd = None
    old_blocking = None
    prior_writer = _cli_writer
    try:
        import sys
        if isinstance(sys.stdout, io.StringIO):
            # Test-only explicit capture path; CLI execution never reaches this.
            pass
        else:
            fd = sys.stdout.fileno()
            mode = os.fstat(fd).st_mode
            if not (stat.S_ISFIFO(mode) or sys.stdout.isatty()):
                return 2
            old_blocking = os.get_blocking(fd)
            os.set_blocking(fd, False)
            def write_nonblocking(data):
                try:
                    count = os.write(fd, data)
                except (BlockingIOError, BrokenPipeError, OSError) as exc:
                    raise TelemetryOutputError('CLI telemetry output unavailable') from exc
                if count != len(data):
                    raise TelemetryOutputError('Partial CLI telemetry write')
            _cli_writer = write_nonblocking
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGINT, signal.SIGTERM):
                previous[sig] = signal.signal(sig, lambda *_:cancel.set())
        report = run_load_test(session_approved=args.approve_session_reset,
            motion_approved=args.approve_motion, blade_removed_confirmed=args.blade_housing_removed,
            height_inches=args.mat_height, cancelled=cancel.is_set,
            on_stage=lambda stage:_write_record({'stage':stage,
                'elapsedSeconds':round(time.monotonic()-started,3)}),
            # Adapter traffic only: fixed controls/status/measurement, never
            # initialization/key negotiation, discovery IDs or provisioning.
            on_trace=lambda packet, reply:_write_record({
                'tx':packet[2:].hex(), 'rx':reply.hex(),
                'elapsedSeconds':round(time.monotonic()-started,3)}))
        cleanup = report.get('cleanup', {})
        # Accepted replies/returned close only; this is NOT physical stop proof.
        cleanup_accepted = all(cleanup.get(key) is True for key in
                               ('abortReplyAccepted', 'disarmReplyReceived', 'closeReturned'))
        report['cleanupExchangesAccepted'] = cleanup_accepted
        _write_record(report)
        return 0 if report.get('outcome') == 'measurement_complete' and cleanup_accepted else 1
    except Exception as error:
        # Never print exception text, discovery data, addresses, provisioning or keys.
        # Output failure is terminal: do not recursively log on a failed sink.
        try:
            _write_record({'outcome':'failed','error':type(error).__name__,
                           'physicalLoadingVerified':False,'motionStoppedVerified':False})
        except Exception:
            pass
        return 2
    finally:
        _cli_writer = prior_writer
        if fd is not None and old_blocking is not None:
            try:
                os.set_blocking(fd, old_blocking)
            except OSError:
                pass
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    raise SystemExit(main())
