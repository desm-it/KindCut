"""Program-bound job capture, without widening the load-only recorder's policy.

Geometry/configuration may be logged only when it derives from this admitted
program. Loading/cleanup retain their existing fixed recipe allowlist. Nothing
here authorizes an exchange; this observer is bounded and never reads secrets.
"""
from joy_loading_diagnostics import (LoadingDiagnostics, _load_frames,
                                     MAX_HEX_CHARS, ERROR_TYPES)
from joy_protocol import clear_frame


class JobDiagnostics(LoadingDiagnostics):
    # Object-major setup/drain bursts need a larger, still bounded snapshot.
    # At 1024 events and 1024 hex chars per direction this fits the 4 MiB RPC cap.
    event_limit=1024
    def __init__(self,operation_id,program,**options):
        super().__init__(operation_id,**options)
        self._frames = _load_frames() | frozenset(clear_frame(body)
            for step in program.passes for body in step.configuration_bodies)
        self._frames |= frozenset(clear_frame(body) for body in
                                  (b'\x21\x00\x00\x00',b'\x22\x00\x00\x00',b'\x73'))
        self._records = frozenset(record for step in program.passes
                                  for path in step.paths for record in path.records)

    @staticmethod
    def _label(value):
        if type(value)is str and value in ('setting_up','sending','draining','pausing','paused','returning_to_origin','retained_ready'):
            return value,True
        return LoadingDiagnostics._label(value)

    def _allowed(self,packet):
        if type(packet)is not bytes:return False
        if packet in self._frames:return True
        if (len(packet)<12 or packet[0]&0x80 or packet[2]!=0x43 or
                int.from_bytes(packet[:2],'big')!=len(packet)-2 or
                (len(packet)-3)%9 or not 1<=(len(packet)-3)//9<=56):return False
        return all(packet[i:i+9] in self._records for i in range(3,len(packet),9))

    def exchange(self,stage,tx=None,rx=None,error=None,*,started=None,kind='exchange',code=None):
        # Same bounded storage/error semantics as LoadingDiagnostics.exchange;
        # the changed allowlist is instance/program-specific, never a global edit.
        with self._lock:
            safe,valid=self._label(stage)
            from joy_tool_return import ORIGIN_RETURN_RECORDS
            return_frame=(stage=='returning_to_origin' and type(tx)is bytes and
                tx in (clear_frame(b'\x43'+ORIGIN_RETURN_RECORDS[0]),clear_frame(b'\x43'+b''.join(ORIGIN_RETURN_RECORDS))))
            if (not valid or type(tx)is not bytes or not (return_frame or self._allowed(tx)) or
                    (rx is not None and(type(rx)is not bytes or len(rx)>MAX_HEX_CHARS//2)) or
                    len(tx)*2>MAX_HEX_CHARS):
                self._incomplete=True
                self._append('capture_gap',safe if valid else 'unknown_stage',
                             code='capture_incomplete',started=started)
                return
            ec=self._code(error,code)
            if error is not None:
                kind='io_error'
                if self._failure is None:
                    name=type(error).__name__
                    self._failure={'stage':safe,'code':ec,
                                   'errorType':name if name in ERROR_TYPES else 'UnknownError'}
                    self._last_stage=safe
            if kind not in ('exchange','io_error','cleanup','stage','failure'):kind='exchange'
            self._append(kind,safe,tx.hex(),rx.hex()if rx is not None else None,ec,started)
