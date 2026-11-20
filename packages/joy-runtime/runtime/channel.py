"""Framing/crypto integration with an explicitly supplied byte-stream transport.

Construction performs no I/O. Opening Bluetooth is the caller's separately
approved operation. No automatic startup/reset, retries or motion commands.
Timeout/corruption discards the session to avoid applying stale replies later.
A channel has one owner; concurrent exchanges are not supported.
"""
import math
import time
from joy_crypto import SessionCrypto

class FramedChannel:
    def __init__(self,transport,crypto=None):
        self.transport=transport
        self.crypto=crypto if crypto is not None else SessionCrypto()
        self._buffer=bytearray()
        self._closed=False

    @staticmethod
    def _timeout(timeout):
        timeout=float(timeout)
        if not math.isfinite(timeout) or not 0<=timeout<=120:
            raise ValueError('Timeout must be finite and within 0..120 seconds')
        return timeout

    def send(self,clear,*,encrypted=False,timeout=1):
        timeout=self._timeout(timeout)
        if self._closed:raise ConnectionError('Channel closed')
        if len(clear)<2 or clear[0]&0x80 or int.from_bytes(clear[:2],'big')!=len(clear)-2 or len(clear)>514:
            raise ValueError('Expected a complete clear Joy frame')
        try:
            data=self.crypto.encode(clear) if encrypted else clear
            if self.transport.write(data,timeout)!=len(data):
                raise ConnectionError('Incomplete write; completion is uncertain')
        except Exception:
            self.close()
            raise

    def receive(self,timeout,*,require_encrypted=None):
        timeout=self._timeout(timeout)
        if self._closed:raise ConnectionError('Channel closed')
        deadline=time.monotonic()+timeout
        try:
            while True:
                if len(self._buffer)>=2:
                    header=int.from_bytes(self._buffer[:2],'big');length=header&0x7fff
                    if length>512:raise ValueError('Receive frame exceeds 512 bytes')
                    if len(self._buffer)>=length+2:
                        if require_encrypted is not None and bool(header&0x8000)!=require_encrypted:
                            raise ValueError('Unexpected response encryption state')
                        frame=bytes(self._buffer[:length+2]);del self._buffer[:length+2]
                        return self.crypto.decode(frame) if header&0x8000 else frame
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('Timed out receiving a complete frame')
                data=self.transport.read(514,remaining)
                if data:
                    if len(data)>514:raise ValueError('Transport exceeded requested read size')
                    self._buffer.extend(data)
                else:
                    # Some adapters may return early; avoid a busy-loop.
                    time.sleep(min(.001,max(0,deadline-time.monotonic())))
        except Exception:
            self.close()
            raise

    def close(self):
        self._closed=True
        self._buffer.clear()
        self.crypto.reset()
        self.transport.close()
