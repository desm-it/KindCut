"""Exercise ctypes calls with an inert DLL, not a mocked WinsockSocket.

No Windows DLL, radio, network or device access. Windows SDK execution remains
an independent acceptance gate.
"""
from collections.abc import Callable
import ctypes
import math
from typing import Any
import unittest
from bluetooth.windows_endpoint import rfcomm_address
from bluetooth.windows_winsock import WinsockSocket


class Function:
    def __init__(self, owner, name, implementation):
        self.owner, self.name, self.implementation = owner, name, implementation
        self.argtypes: list[Any] = []
        self.restype: Any = None
    def __call__(self, *args):
        self.owner.calls.append((self.name, args))
        return self.implementation(*args)


class InertWinsock:
    def __init__(self):
        self.calls = []
        self.handle = 0x123456789 if ctypes.sizeof(ctypes.c_size_t) == 8 else 123
        self.startup_result = 0
        self.socket_result = self.handle
        self.connect_result = 0
        self.error = 10035
        self.socket_error = 0
        self.ready = True
        self.exceptional = False
        self.received = b'A\x00B'
        self.sent = []
        self.send_count: int | None = None
        self.close_error = False
        self.cleanup_error = False
        self.on_select: Callable[[], None] | None = None
        self.on_startup: Callable[[], None] | None = None
        implementations = {'WSAStartup': self.startup, 'WSACleanup': self.cleanup,
            'WSAGetLastError': lambda: self.error, 'socket': self.socket,
            'ioctlsocket': self.nonblocking, 'connect': self.connect,
            'select': self.select, 'getsockopt': self.getsockopt,
            'recv': self.recv, 'send': self.send, 'closesocket': self.close}
        self.functions = {name: Function(self, name, implementation) for name, implementation in implementations.items()}
        for name, function in self.functions.items():
            setattr(self, name, function)

    def count(self, name):
        return sum(call == name for call, _ in self.calls)
    def startup(self, version, data):
        if self.on_startup:
            self.on_startup()
        ctypes.cast(data, ctypes.POINTER(ctypes.c_uint16))[0] = 0x0202
        return self.startup_result
    def cleanup(self):
        return -1 if self.cleanup_error else 0
    def socket(self, af, kind, protocol):
        if (af, kind, protocol) != (32, 1, 3):
            raise AssertionError('Wrong Bluetooth socket parameters')
        return self.socket_result
    def nonblocking(self, handle, command, mode):
        if handle != self.handle or ctypes.c_uint32(command).value != 0x8004667e:
            raise AssertionError('Wrong FIONBIO call or truncated socket')
        if ctypes.cast(mode, ctypes.POINTER(ctypes.c_uint32))[0] != 1:
            raise AssertionError('Socket must be nonblocking')
        return 0
    def connect(self, handle, address, length):
        if handle != self.handle or length != 30:
            raise AssertionError('Wrong connect ABI')
        if ctypes.string_at(address, 30) != bytes(rfcomm_address('00:11:22:33:44:55', channel=7)):
            raise AssertionError('Changed endpoint bytes')
        return self.connect_result
    def select(self, nfds, read, write, exceptional, timeout):
        if nfds != 0:
            raise AssertionError('Windows ignores nfds')
        for pointer in [read, write, exceptional]:
            if pointer:
                descriptor = ctypes.cast(pointer, ctypes.POINTER(WinsockSocket._FDSet)).contents
                if descriptor.fd_count != 1 or descriptor.fd_array[0] != self.handle:
                    raise AssertionError('Invalid descriptor set / truncated SOCKET')
                if pointer is exceptional:
                    descriptor.fd_count = int(self.exceptional)
                else:
                    descriptor.fd_count = int(self.ready)
        tv = ctypes.cast(timeout, ctypes.POINTER(WinsockSocket._Timeval)).contents
        if tv.tv_sec < 0 or not 0 <= tv.tv_usec < 1000000:
            raise AssertionError('Invalid timeval')
        if self.on_select:
            self.on_select()
        return int(self.ready or self.exceptional)
    def getsockopt(self, handle, level, option, value, length):
        if (handle, level, option) != (self.handle, 0xffff, 0x1007):
            raise AssertionError('Wrong SOL_SOCKET / SO_ERROR')
        ctypes.cast(value, ctypes.POINTER(ctypes.c_int32))[0] = self.socket_error
        ctypes.cast(length, ctypes.POINTER(ctypes.c_int32))[0] = 4
        return 0
    def recv(self, handle, buffer, count, flags):
        data = self.received[:count]
        ctypes.memmove(buffer, data, len(data))
        return len(data)
    def send(self, handle, buffer, count, flags):
        self.sent.append(ctypes.string_at(buffer, count))
        return count if self.send_count is None else self.send_count
    def close(self, handle):
        if handle != self.handle:
            raise AssertionError('Attempt to close invalid socket')
        return -1 if self.close_error else 0


class WinsockApiTests(unittest.TestCase):
    def make(self, api=None):
        api = InertWinsock() if api is None else api
        sock = WinsockSocket(_platform='win32', _api_factory=lambda: api)
        return sock, api
    def open(self, sock):
        sock.connect(rfcomm_address('00:11:22:33:44:55', channel=7), 1, allow_hardware=True)

    def test_actual_binding_calls_and_64_bit_socket_are_preserved(self):
        sock, api = self.make()
        self.open(sock)
        self.assertIs(api.functions['socket'].restype, ctypes.c_size_t)
        self.assertEqual(api.functions['connect'].argtypes[0], ctypes.c_size_t)
        self.assertEqual(sock.read(10, 1), b'A\x00B')
        api.send_count = 2
        self.assertEqual(sock.write(b'C\x00D', 1), 2)
        self.assertEqual(api.sent, [b'C\x00D'])
        sock.close()
        sock.close()
        self.assertEqual(api.count('WSAStartup'), 1)
        self.assertEqual(api.count('closesocket'), 1)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_pending_connect_checks_real_so_error_and_exception_set(self):
        sock, api = self.make()
        api.connect_result = -1
        self.open(sock)
        self.assertEqual(api.count('WSAGetLastError'), 1)
        self.assertEqual(api.count('getsockopt'), 1)
        self.assertIsNotNone(next(args[3] for name, args in api.calls if name == 'select'))
        sock.close()

    def test_immediate_connect_error_never_waits_or_retries(self):
        sock, api = self.make()
        api.connect_result, api.error = -1, 10061
        with self.assertRaises(OSError):
            self.open(sock)
        self.assertEqual(api.count('select'), 0)
        self.assertEqual(api.count('connect'), 1)
        self.assertEqual(api.count('closesocket'), 1)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_pending_connect_socket_error_retires(self):
        sock, api = self.make()
        api.connect_result, api.socket_error, api.exceptional = -1, 10061, True
        with self.assertRaises(OSError):
            self.open(sock)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_socket_creation_failure_does_not_close_invalid_handle(self):
        sock, api = self.make()
        api.socket_result = ctypes.c_size_t(-1).value
        with self.assertRaises(OSError):
            self.open(sock)
        self.assertEqual(api.count('closesocket'), 0)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_failed_startup_has_no_cleanup_reference_to_release(self):
        sock, api = self.make()
        api.startup_result = 10091
        with self.assertRaises(OSError):
            self.open(sock)
        self.assertEqual(api.count('socket'), 0)
        self.assertEqual(api.count('WSACleanup'), 0)

    def test_eof_is_not_an_idle_read_timeout(self):
        sock, api = self.make()
        self.open(sock)
        api.received = b''
        with self.assertRaises(ConnectionError):
            sock.read(4, 1)
        self.assertEqual(api.count('closesocket'), 1)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_read_timeout_keeps_open_but_write_timeout_retires(self):
        sock, api = self.make()
        self.open(sock)
        api.ready = False
        self.assertEqual(sock.read(4, .01), b'')
        self.assertEqual(api.count('closesocket'), 0)
        with self.assertRaises(TimeoutError):
            sock.write(b'abc', .01)
        self.assertEqual(api.count('closesocket'), 1)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_finite_bounded_timeout_validation_precedes_native_calls(self):
        for timeout in [math.inf, math.nan, 121, True, -1]:
            sock, api = self.make()
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                sock.connect(rfcomm_address('00:11:22:33:44:55', channel=7), timeout, allow_hardware=True)
            self.assertEqual(api.calls, [])

    def test_close_failure_retains_resource_for_explicit_retirement_retry(self):
        sock, api = self.make()
        self.open(sock)
        api.close_error = True
        with self.assertRaises(OSError):
            sock.close()
        self.assertEqual(api.count('WSACleanup'), 0)
        api.close_error = False
        sock.close()
        self.assertEqual(api.count('closesocket'), 2)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_close_interrupts_select_and_late_data_is_not_delivered(self):
        sock, api = self.make()
        self.open(sock)
        api.on_select = sock.close
        with self.assertRaises(ConnectionError):
            sock.read(4, 1)
        self.assertEqual(api.count('recv'), 0)
        self.assertEqual(api.count('closesocket'), 1)
        self.assertEqual(api.count('WSACleanup'), 1)

    def test_close_during_startup_prevents_later_socket_creation(self):
        sock, api = self.make()
        api.on_startup = sock.close
        with self.assertRaises(ConnectionError):
            self.open(sock)
        self.assertEqual(api.count('socket'), 0)
        self.assertEqual(api.count('WSACleanup'), 1)


if __name__ == '__main__':
    unittest.main()
