"""Inert platform selection and shared initialization, not Windows acceptance."""
import unittest
from unittest.mock import patch
from bluetooth.transport import BluetoothTransport, create_transport
from bluetooth.windows_transport import WindowsBluetoothTransport
from worker import RuntimeService
from fixtures_provisioning import SyntheticJoy, cached, container, record
import base64

ADDRESS = '00:11:22:33:44:55'


class PlatformTransportTests(unittest.TestCase):
    def test_macos_factory_preserves_helper_path_without_open(self):
        transport = create_transport(ADDRESS, platform='darwin', helper_path='/inert/never-execute')
        self.assertIsInstance(transport, BluetoothTransport)
        self.assertEqual(transport.helper_path, '/inert/never-execute')
        with self.assertRaises(PermissionError):
            transport.open()

    def test_windows_factory_selects_lazy_adapter_without_granting_approval(self):
        transport = create_transport(ADDRESS, platform='win32')
        self.assertIsInstance(transport, WindowsBluetoothTransport)
        self.assertEqual(bytes(transport._endpoint)[10:26], bytes.fromhex('0111000000000010800000805f9b34fb'))
        with self.assertRaises(PermissionError):
            transport.open()

    def test_unknown_platform_fails_without_fallback(self):
        with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
            create_transport(ADDRESS, platform='linux')

    def test_worker_default_factory_runs_real_initialization_over_inert_windows_adapter(self):
        seed = bytes(range(33))
        bundle = {'format': 1, 'settings8': cached(container(record()), seed),
                  'seedPrefixBase64': base64.b64encode(seed).decode()}
        wire = SyntheticJoy()
        class InertSocket:
            def connect(self, endpoint, timeout, *, allow_hardware=False):
                if allow_hardware is not True:
                    raise AssertionError('Missing explicit approval')
            def read(self, count, timeout):
                return wire.read(count, timeout)
            def write(self, data, timeout):
                return wire.write(data, timeout)
            def close(self):
                wire.close()
        transport = create_transport(ADDRESS, platform='win32', allow_hardware=True)
        transport._factory = InertSocket
        # Production Windows admission stays closed. Exercise the common worker
        # initialization with its existing admitted platform and inert factory.
        service = RuntimeService(platform='darwin', seed_prefix=seed)
        try:
            with patch('worker.create_transport', create=True, return_value=transport) as factory, \
                 patch('worker.BluetoothTransport', create=True, side_effect=AssertionError('Old direct helper construction')):
                result = service.handle({'op': 'connect', 'address': ADDRESS,
                    'hardwareApproved': True, 'cryptoResetApproved': True, 'bundle': bundle})
                self.assertEqual(result['state'], 'ready')
                factory.assert_called_once()
                self.assertEqual(factory.call_args.kwargs['platform'], 'darwin')
                self.assertIs(factory.call_args.kwargs['allow_hardware'], True)
                self.assertIs(service.transport, transport)
        finally:
            service.close()
        self.assertTrue(wire.closed)


if __name__ == '__main__':
    unittest.main()
