"""Portable byte/ABI tests, not Windows socket or device acceptance."""
import ctypes
import unittest
from uuid import UUID
from bluetooth.windows_endpoint import rfcomm_address

SERIAL_PORT = UUID('00001101-0000-1000-8000-00805f9b34fb')


class WindowsEndpointTests(unittest.TestCase):
    def test_service_endpoint_matches_packed_windows_sockaddr(self):
        endpoint = rfcomm_address('00:11:22:33:44:55', service_uuid=SERIAL_PORT)
        self.assertEqual(bytes(endpoint), bytes.fromhex(
            '2000' '5544332211000000'
            '0111000000000010800000805f9b34fb' '00000000'))
        self.assertEqual(ctypes.sizeof(endpoint), 30)
        self.assertEqual(type(endpoint).btAddr.offset, 2)
        self.assertEqual(type(endpoint).serviceClassId.offset, 10)
        self.assertEqual(type(endpoint).port.offset, 26)

    def test_explicit_channel_has_null_service_id(self):
        endpoint = rfcomm_address('00-11-22-33-44-55', channel=7)
        self.assertEqual(bytes(endpoint), bytes.fromhex(
            '2000' '5544332211000000' + '00' * 16 + '07000000'))

    def test_both_resolution_modes_or_neither_are_rejected(self):
        for kwargs in [{}, {'channel': 1, 'service_uuid': SERIAL_PORT}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                rfcomm_address('00:11:22:33:44:55', **kwargs)

    def test_invalid_remote_addresses_are_not_normalized(self):
        for address in [None, 123, '', '001122334455', ' 00:11:22:33:44:55',
                        '00:11:22:33:44:55 ', '00:11-22:33:44:55',
                        '00:11:22:33:44:5G', '00:00:00:00:00:00']:
            with self.subTest(address=address), self.assertRaises(ValueError):
                rfcomm_address(address, channel=7)

    def test_channel_is_an_integer_in_documented_remote_range(self):
        for channel in [True, False, 0, -1, 31, 7.0, '7']:
            with self.subTest(channel=channel), self.assertRaises(ValueError):
                rfcomm_address('00:11:22:33:44:55', channel=channel)
        for channel in [1, 30]:
            self.assertEqual(rfcomm_address('00:11:22:33:44:55', channel=channel).port, channel)

    def test_unvalidated_windows_route_stays_disabled_before_transport_creation(self):
        from worker import RuntimeService
        created = []
        service = RuntimeService(platform='win32', transport_factory=lambda address: created.append(address))
        with self.assertRaisesRegex(RuntimeError, 'macOS only'):
            service.handle({'op': 'connect', 'hardwareApproved': True,
                            'cryptoResetApproved': True, 'address': '00:11:22:33:44:55'})
        self.assertEqual(created, [])
        self.assertIsNone(service.session)

    def test_service_identifier_must_be_non_null_uuid(self):
        for value in [SERIAL_PORT.hex, UUID(int=0), 1, False]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                rfcomm_address('00:11:22:33:44:55', service_uuid=value)


if __name__ == '__main__':
    unittest.main()
