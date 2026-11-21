"""Lazy Windows Winsock RFCOMM boundary; no constructor I/O.

SOCKET is pointer-sized; DWORD/LONG remain 32-bit on every host. Calls below
use only explicitly approved sockets. Close seals the instance immediately and
interrupts select by closing that socket. WSACleanup waits for the active call
to unwind; failed native cleanup stays quarantined for an explicit close retry.

Native semantics: Microsoft Learn winsock2 connect/select/recv/closesocket and
WSAStartup/WSACleanup. Windows SDK/execution acceptance is still required.
"""
from contextlib import contextmanager
import ctypes
import math
import sys
import threading
import time
from typing import Any
from .windows_endpoint import SockaddrBth, AF_BTH, BTHPROTO_RFCOMM

MAX_BYTES = 512 * 1024
INVALID_SOCKET = ctypes.c_size_t(-1).value
FIONBIO = ctypes.c_int32(0x8004667e).value
SOL_SOCKET = 0xffff
SO_ERROR = 0x1007
WSAEWOULDBLOCK = 10035
_PENDING_CONNECT = {WSAEWOULDBLOCK, 10036, 10037}


class _FDSet(ctypes.Structure):
    _fields_ = [('fd_count', ctypes.c_uint32), ('fd_array', ctypes.c_size_t * 64)]


class _Timeval(ctypes.Structure):
    _fields_ = [('tv_sec', ctypes.c_int32), ('tv_usec', ctypes.c_int32)]


class WinsockSocket:
    _FDSet = _FDSet
    _Timeval = _Timeval
    _SockaddrBth = SockaddrBth

    def __init__(self, *, _platform=None, _api_factory=None):
        self._platform = sys.platform if _platform is None else _platform
        self._api_factory = self._load_api if _api_factory is None else _api_factory
        self._api: Any = None
        self._sock = None
        self._started = False
        self._connected = False
        self._closed = False
        self._active = 0
        self._cleanup_failed = False
        self._lock = threading.RLock()

    @staticmethod
    def _load_api():
        loader = getattr(ctypes, 'WinDLL', None)
        if sys.platform != 'win32' or loader is None:
            raise OSError('Windows system DLL loader is unavailable')
        return loader('Ws2_32.dll', use_last_error=True, winmode=0x00000800)

    @staticmethod
    def _timeout(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError('Timeout must be a finite number in 0..120 seconds')
        value = float(value)
        if not math.isfinite(value) or not 0 <= value <= 120:
            raise ValueError('Timeout must be a finite number in 0..120 seconds')
        return value

    def _bind(self):
        api = self._api_factory()
        signatures = {
            'WSAStartup': ([ctypes.c_uint16, ctypes.c_void_p], ctypes.c_int32),
            'WSACleanup': ([], ctypes.c_int32),
            'WSAGetLastError': ([], ctypes.c_int32),
            'socket': ([ctypes.c_int32, ctypes.c_int32, ctypes.c_int32], ctypes.c_size_t),
            'ioctlsocket': ([ctypes.c_size_t, ctypes.c_int32, ctypes.POINTER(ctypes.c_uint32)], ctypes.c_int32),
            'connect': ([ctypes.c_size_t, ctypes.c_void_p, ctypes.c_int32], ctypes.c_int32),
            'select': ([ctypes.c_int32, ctypes.POINTER(_FDSet), ctypes.POINTER(_FDSet), ctypes.POINTER(_FDSet), ctypes.POINTER(_Timeval)], ctypes.c_int32),
            'getsockopt': ([ctypes.c_size_t, ctypes.c_int32, ctypes.c_int32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32)], ctypes.c_int32),
            'recv': ([ctypes.c_size_t, ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32], ctypes.c_int32),
            'send': ([ctypes.c_size_t, ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32], ctypes.c_int32),
            'closesocket': ([ctypes.c_size_t], ctypes.c_int32),
        }
        for name, (args, result) in signatures.items():
            fn = getattr(api, name)
            fn.argtypes, fn.restype = args, result
        self._api = api

    def _error(self, operation, code=None):
        return OSError(self._api.WSAGetLastError() if code is None else code,
                       'Windows Bluetooth ' + operation + ' failed')

    def _check_live(self, handle=None):
        with self._lock:
            if self._closed or (handle is not None and self._sock != handle):
                raise ConnectionAbortedError('Windows Bluetooth operation retired')

    @contextmanager
    def _operation(self, *, connecting=False):
        with self._lock:
            self._check_live()
            if self._active:
                raise RuntimeError('Concurrent Winsock operations are not supported')
            if connecting:
                if self._sock is not None or self._started:
                    raise ConnectionError('Windows Bluetooth socket is already open')
            elif not self._connected or self._sock is None:
                raise ConnectionError('Windows Bluetooth socket is not connected')
            self._active += 1
            handle = self._sock
        failed = False
        try:
            yield handle
        except BaseException:
            failed = True
            try:
                self.close()
            except Exception:
                pass
            raise
        finally:
            with self._lock:
                self._active -= 1
                try:
                    self._cleanup_locked()
                except Exception:
                    if not failed:
                        raise

    def _cleanup_locked(self):
        if not self._closed or self._cleanup_failed:
            return
        try:
            if self._sock is not None:
                if self._api.closesocket(self._sock) != 0:
                    raise self._error('close')
                self._sock = None
            if self._started and self._active == 0:
                if self._api.WSACleanup() != 0:
                    raise self._error('cleanup')
                self._started = False
        except BaseException:
            self._cleanup_failed = True
            raise

    def close(self):
        with self._lock:
            self._closed = True
            self._connected = False
            # An explicit retirement request may retry a failed native cleanup;
            # ordinary finally paths must not silently lose that resource.
            self._cleanup_failed = False
            self._cleanup_locked()

    def _ready(self, handle, read, deadline):
        self._check_live(handle)
        left = max(0.0, deadline - time.monotonic())
        sec = int(left)
        tv = _Timeval(sec, int((left - sec) * 1_000_000))
        normal, exceptional = _FDSet(), _FDSet()
        for descriptor in [normal, exceptional]:
            descriptor.fd_count = 1
            descriptor.fd_array[0] = handle
        result = self._api.select(0, ctypes.byref(normal) if read else None,
            None if read else ctypes.byref(normal), ctypes.byref(exceptional), ctypes.byref(tv))
        self._check_live(handle)
        if result < 0:
            raise self._error('select')
        if result == 0:
            return False, False
        ready = normal.fd_count == 1 and normal.fd_array[0] == handle
        exceptional_ready = exceptional.fd_count == 1 and exceptional.fd_array[0] == handle
        if normal.fd_count not in (0, 1) or exceptional.fd_count not in (0, 1) or not (ready or exceptional_ready):
            raise ConnectionError('Invalid Windows Bluetooth readiness result')
        return ready, exceptional_ready

    def connect(self, endpoint, timeout, *, allow_hardware=False):
        timeout = self._timeout(timeout)
        if allow_hardware is not True:
            raise PermissionError('Literal allow_hardware=True required')
        if self._platform != 'win32':
            raise OSError('Winsock RFCOMM is available only on Windows')
        if not isinstance(endpoint, SockaddrBth) or endpoint.addressFamily != AF_BTH or not 0 < endpoint.btAddr < (1 << 48):
            raise ValueError('Expected a valid remote SOCKADDR_BTH')
        service_present = any(bytes(endpoint.serviceClassId))
        if not ((endpoint.port == 0 and service_present) or (1 <= endpoint.port <= 30 and not service_present)):
            raise ValueError('Expected exactly one service UUID or discovered channel')
        deadline = time.monotonic() + timeout
        with self._operation(connecting=True):
            self._bind()
            self._check_live()
            wsadata = ctypes.create_string_buffer(512)
            status = self._api.WSAStartup(0x0202, wsadata)
            if status != 0:
                raise self._error('startup', status)
            with self._lock:
                self._started = True
            self._check_live()
            if ctypes.cast(wsadata, ctypes.POINTER(ctypes.c_uint16))[0] != 0x0202:
                raise ConnectionError('Winsock 2.2 was not negotiated')
            handle = self._api.socket(AF_BTH, 1, BTHPROTO_RFCOMM)
            if handle == INVALID_SOCKET:
                raise self._error('socket creation')
            with self._lock:
                self._sock = handle
            self._check_live(handle)
            mode = ctypes.c_uint32(1)
            if self._api.ioctlsocket(handle, FIONBIO, ctypes.byref(mode)) != 0:
                raise self._error('nonblocking setup')
            self._check_live(handle)
            if time.monotonic() >= deadline:
                raise TimeoutError('Windows Bluetooth connect deadline expired')
            result = self._api.connect(handle, ctypes.byref(endpoint), ctypes.sizeof(endpoint))
            self._check_live(handle)
            if result != 0:
                code = self._api.WSAGetLastError()
                if code not in _PENDING_CONNECT:
                    raise self._error('connect', code)
                ready, exceptional = self._ready(handle, False, deadline)
                if not ready and not exceptional:
                    raise TimeoutError('Windows Bluetooth connect timed out')
                error, size = ctypes.c_int32(), ctypes.c_int32(4)
                if self._api.getsockopt(handle, SOL_SOCKET, SO_ERROR, ctypes.byref(error), ctypes.byref(size)) != 0:
                    raise self._error('connect status')
                self._check_live(handle)
                if size.value != 4 or error.value or exceptional:
                    raise self._error('connect completion', error.value)
            with self._lock:
                self._check_live(handle)
                self._connected = True

    def read(self, max_bytes, timeout):
        timeout = self._timeout(timeout)
        if type(max_bytes) is not int or not 1 <= max_bytes <= MAX_BYTES:
            raise ValueError('Read size must be within 1..524288')
        with self._operation() as handle:
            ready, exceptional = self._ready(handle, True, time.monotonic() + timeout)
            if exceptional:
                raise ConnectionError('Exceptional Windows Bluetooth readiness')
            if not ready:
                return b''
            buf = ctypes.create_string_buffer(max_bytes)
            count = self._api.recv(handle, buf, max_bytes, 0)
            self._check_live(handle)
            if count < 0:
                code = self._api.WSAGetLastError()
                if code == WSAEWOULDBLOCK:
                    return b''
                raise self._error('receive', code)
            if count == 0:
                raise ConnectionError('Windows Bluetooth peer closed')
            if count > max_bytes:
                raise ConnectionError('Invalid Windows Bluetooth receive count')
            return buf.raw[:count]

    def write(self, data, timeout):
        timeout = self._timeout(timeout)
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError('Expected a byte buffer')
        size = data.nbytes if isinstance(data, memoryview) else len(data)
        if not 1 <= size <= MAX_BYTES:
            raise ValueError('Write size must be within 1..524288')
        payload = bytes(data)
        with self._operation() as handle:
            ready, exceptional = self._ready(handle, False, time.monotonic() + timeout)
            if exceptional:
                raise ConnectionError('Exceptional Windows Bluetooth readiness')
            if not ready:
                raise TimeoutError('Windows Bluetooth write timed out')
            buf = ctypes.create_string_buffer(payload)
            count = self._api.send(handle, buf, len(payload), 0)
            self._check_live(handle)
            if count < 0:
                raise self._error('send')
            if not 0 < count <= len(payload):
                raise ConnectionError('Invalid Windows Bluetooth send count')
            return count
