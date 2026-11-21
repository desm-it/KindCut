"""Explicitly approved Windows RFCOMM byte stream; no constructor I/O.

Uses the same framing/crypto consumer as macOS. A failed/uncertain write retires
this transport permanently: it must never replay a full frame. Close interrupts
an in-flight connect/read/write without waiting for the operation lock. App and
worker Windows admission remain separately disabled until Windows acceptance.
"""
from contextlib import contextmanager
import math
import sys
import threading
import time
from .windows_endpoint import rfcomm_address
from .windows_winsock import WinsockSocket

MAX_BYTES = 512 * 1024


def _timeout(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError('Timeout must be a finite number in 0..120 seconds')
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 120:
        raise ValueError('Timeout must be a finite number in 0..120 seconds')
    return value


class WindowsBluetoothTransport:
    def __init__(self, address, *, allow_hardware=False, channel=None,
                 service_uuid=None, socket_factory=None, platform=None, clock=None):
        self.address = address
        self.allow_hardware = allow_hardware
        self._endpoint = rfcomm_address(address, channel=channel, service_uuid=service_uuid)
        self._factory = WinsockSocket if socket_factory is None else socket_factory
        self._platform = sys.platform if platform is None else platform
        self._clock = time.monotonic if clock is None else clock
        self._operation = threading.Lock()
        self._state = threading.Lock()
        self._socket = None
        self._pending = None
        self._quarantined = []
        self._retired = False

    @contextmanager
    def _claim(self):
        if not self._operation.acquire(blocking=False):
            raise RuntimeError('Concurrent transport operations are not supported')
        try:
            yield
        finally:
            self._operation.release()

    def _current(self):
        with self._state:
            if self._retired or self._socket is None:
                raise ConnectionError('Windows transport is not open')
            return self._socket

    def _discard(self):
        # Preserve the original I/O failure; close retains failed resources in
        # quarantine and the worker/session owner must still retire its process.
        try:
            self.close()
        except Exception:
            pass

    def open(self):
        if self.allow_hardware is not True:
            raise PermissionError('Bluetooth requires explicit allow_hardware=True')
        if self._platform != 'win32':
            raise RuntimeError('Windows transport requires Windows')
        with self._claim():
            with self._state:
                if self._retired:
                    raise ConnectionError('Windows transport has been retired')
                if self._socket is not None or self._pending is not None:
                    raise RuntimeError('Windows transport is already open')
            try:
                candidate = self._factory()
                with self._state:
                    self._pending = candidate
                    if self._retired:
                        raise ConnectionAbortedError('Connection cancelled before open')
                candidate.connect(self._endpoint, 10.0, allow_hardware=True)
                with self._state:
                    if self._retired or self._pending is not candidate:
                        raise ConnectionAbortedError('Connection cancelled during open')
                    self._socket = candidate
                    self._pending = None
            except BaseException:
                self._discard()
                raise

    def read(self, max_bytes, timeout):
        timeout = _timeout(timeout)
        if type(max_bytes) is not int or not 1 <= max_bytes <= MAX_BYTES:
            raise ValueError('Read size must be within 1..524288')
        with self._claim():
            sock = self._current()
            try:
                data = sock.read(max_bytes, timeout)
                if self._current() is not sock:
                    raise ConnectionAbortedError('Read owner changed')
                if not isinstance(data, bytes) or len(data) > max_bytes:
                    raise ValueError('Invalid native read response')
                # Empty bytes are an ordinary bounded read timeout. Native EOF
                # is a ConnectionError, not an indefinitely reusable idle stream.
                return data
            except BaseException:
                self._discard()
                raise

    def write(self, data, timeout):
        timeout = _timeout(timeout)
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError('Expected a byte buffer')
        size = data.nbytes if isinstance(data, memoryview) else len(data)
        if size > MAX_BYTES:
            raise ValueError('Write too large')
        data = bytes(data)
        with self._claim():
            sock = self._current()
            deadline = self._clock() + timeout
            written = 0
            try:
                while written < len(data):
                    remaining = deadline - self._clock()
                    if remaining <= 0:
                        raise TimeoutError('Write deadline exceeded; session discarded')
                    count = sock.write(data[written:], remaining)
                    if self._current() is not sock:
                        raise ConnectionAbortedError('Write owner changed')
                    if type(count) is not int or not 0 < count <= len(data) - written:
                        raise ConnectionError('Incomplete or invalid native write count')
                    written += count
                    if self._clock() > deadline:
                        raise TimeoutError('Write deadline exceeded; completion uncertain')
                return written
            except BaseException:
                self._discard()
                raise

    def close(self):
        with self._state:
            self._retired = True
            owned = [self._socket, self._pending, *self._quarantined]
            self._socket = self._pending = None
            self._quarantined = []
        failure = None
        seen = set()
        for sock in owned:
            if sock is None or id(sock) in seen:
                continue
            seen.add(id(sock))
            try:
                sock.close()
            except Exception as error:
                with self._state:
                    self._quarantined.append(sock)
                if failure is None:
                    failure = error
        if failure is not None:
            raise failure
