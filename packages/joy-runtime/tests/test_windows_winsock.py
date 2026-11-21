import ctypes
import unittest

from bluetooth.windows_endpoint import rfcomm_address
from bluetooth.windows_winsock import WinsockSocket


class TestWinsock(unittest.TestCase):
    def test_constructor_is_inert_and_requires_literal_authority_before_dll(self):
        socket = WinsockSocket(_platform='win32', _api_factory=lambda: self.fail('DLL loaded'))
        with self.assertRaises(PermissionError):
            socket.connect(None, 1, allow_hardware=1)

    def test_timeout_validation_does_not_load_dll(self):
        socket = WinsockSocket(_platform='win32', _api_factory=lambda: self.fail('DLL loaded'))
        with self.assertRaises(ValueError):
            socket.connect(None, -1, allow_hardware=True)

    def test_non_windows_rejects_after_guard_without_loading_dll(self):
        socket = WinsockSocket(_platform='darwin', _api_factory=lambda: self.fail('DLL loaded'))
        with self.assertRaises(OSError):
            socket.connect(None, 1, allow_hardware=True)

    def test_ctypes_abi_layouts(self):
        socket = WinsockSocket(_platform='win32', _api_factory=lambda: None)
        self.assertEqual(ctypes.sizeof(socket._FDSet), 520 if ctypes.sizeof(ctypes.c_size_t) == 8 else 260)
        self.assertEqual(ctypes.sizeof(socket._Timeval), 8)
        self.assertEqual(ctypes.sizeof(socket._SockaddrBth), 30)


if __name__ == '__main__':
    unittest.main()
