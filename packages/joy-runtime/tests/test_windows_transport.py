"""Windows adapter contract with inert byte peers; not Windows/device acceptance."""
from collections.abc import Callable
import math
import threading
import unittest
from uuid import UUID
from bluetooth.windows_transport import WindowsBluetoothTransport
from channel import FramedChannel

SPP = UUID('00001101-0000-1000-8000-00805f9b34fb')
ADDRESS = '00:11:22:33:44:55'


class BytePeer:
    def __init__(self):
        self.connected = []
        self.closed = 0
        self.writes = []
        self.wire = bytearray()
        self.parts = []
        self.incoming = []
        self.on_connect: Callable[[], None] | None = None
        self.on_read: Callable[[int, float], bytes] | None = None
        self.on_write: Callable[[bytes, float], int] | None = None

    def connect(self, endpoint, timeout, *, allow_hardware=False):
        self.connected.append((bytes(endpoint), timeout, allow_hardware))
        if self.on_connect:
            self.on_connect()

    def write(self, data, timeout):
        self.writes.append((bytes(data), timeout))
        if self.on_write:
            return self.on_write(data, timeout)
        count = self.parts.pop(0) if self.parts else len(data)
        self.wire.extend(data[:count])
        return count

    def read(self, max_bytes, timeout):
        if self.on_read:
            return self.on_read(max_bytes, timeout)
        return self.incoming.pop(0) if self.incoming else b''

    def close(self):
        self.closed += 1


class WindowsTransportTests(unittest.TestCase):
    def make(self, peer=None, **options):
        peer = BytePeer() if peer is None else peer
        calls = []
        def create():
            calls.append(True)
            return peer
        transport = WindowsBluetoothTransport(ADDRESS, service_uuid=SPP,
            socket_factory=create, platform='win32', **options)
        return transport, peer, calls

    def test_construction_and_denied_open_never_create_socket(self):
        for approval in [False, 1, 'yes', None]:
            transport, _, created = self.make(allow_hardware=approval)
            self.assertEqual(created, [])
            with self.assertRaises(PermissionError):
                transport.open()
            self.assertEqual(created, [])

    def test_non_windows_default_path_does_not_load_backend(self):
        calls = []
        transport = WindowsBluetoothTransport(ADDRESS, service_uuid=SPP,
            allow_hardware=True, platform='darwin', socket_factory=lambda: calls.append(True))
        with self.assertRaises(RuntimeError):
            transport.open()
        self.assertEqual(calls, [])

    def test_open_forwards_explicit_service_and_approval_once(self):
        transport, peer, created = self.make(allow_hardware=True)
        transport.open()
        self.assertEqual(created, [True])
        self.assertEqual(peer.connected[0][0][10:26], SPP.bytes_le)
        self.assertIs(peer.connected[0][2], True)
        with self.assertRaises(RuntimeError):
            transport.open()
        self.assertEqual(len(created), 1)
        transport.close()

    def test_partial_writes_continue_only_remaining_bytes(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        peer.parts = [2, 1, 3]
        self.assertEqual(transport.write(b'abcdef', 1), 6)
        self.assertEqual(bytes(peer.wire), b'abcdef')
        self.assertEqual([data for data, _ in peer.writes], [b'abcdef', b'cdef', b'def'])
        transport.close()

    def test_failed_partial_write_retires_without_full_frame_retry(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        def fail_after_prefix(data, timeout):
            if len(peer.writes) == 1:
                peer.wire.extend(data[:2])
                return 2
            raise TimeoutError('synthetic write timeout')
        peer.on_write = fail_after_prefix
        with self.assertRaises(TimeoutError):
            transport.write(b'abcdef', 1)
        self.assertEqual(bytes(peer.wire), b'ab')
        self.assertEqual([data for data, _ in peer.writes], [b'abcdef', b'cdef'])
        with self.assertRaises(ConnectionError):
            transport.write(b'abcdef', 1)
        with self.assertRaises(ConnectionError):
            transport.open()
        self.assertEqual(peer.closed, 1)

    def test_read_timeout_is_empty_but_oversized_reply_retires(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        self.assertEqual(transport.read(4, .01), b'')
        self.assertEqual(peer.closed, 0)
        peer.incoming = [b'a', b'12345']
        self.assertEqual(transport.read(4, 1), b'a')
        with self.assertRaises(ValueError):
            transport.read(4, 1)
        self.assertEqual(peer.closed, 1)

    def test_invalid_write_counts_retire_the_session(self):
        for count in [0, -1, 4, True, '3']:
            transport, peer, _ = self.make(allow_hardware=True)
            transport.open()
            peer.on_write = lambda *args: count
            with self.subTest(count=count), self.assertRaises(ConnectionError):
                transport.write(b'abc', 1)
            self.assertEqual(peer.closed, 1)

    def test_invalid_limits_never_reach_the_byte_peer(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        for value in [math.nan, math.inf, -1, 121, True]:
            with self.subTest(timeout=value), self.assertRaises(ValueError):
                transport.write(b'a', value)
        for count in [True, 0, -1, 524289]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                transport.read(count, 1)
        with self.assertRaises(ValueError):
            transport.write(b'a' * 524289, 1)
        self.assertEqual(peer.writes, [])
        self.assertEqual(peer.closed, 0)
        transport.close()

    def test_one_deadline_covers_every_partial_write(self):
        now = [10.0]
        transport, peer, _ = self.make(allow_hardware=True, clock=lambda: now[0])
        transport.open()
        def consume(data, timeout):
            now[0] += .6
            return 1
        peer.on_write = consume
        with self.assertRaises(TimeoutError):
            transport.write(b'abc', 1)
        self.assertEqual(len(peer.writes), 2)
        self.assertAlmostEqual(peer.writes[0][1], 1)
        self.assertAlmostEqual(peer.writes[1][1], .4)
        self.assertEqual(peer.closed, 1)

    def test_close_during_connect_cannot_publish_late_open(self):
        transport, peer, _ = self.make(allow_hardware=True)
        entered, release = threading.Event(), threading.Event()
        errors = []
        def block():
            entered.set()
            release.wait(1)
        peer.on_connect = block
        def connect():
            try:
                transport.open()
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=connect)
        thread.start()
        try:
            self.assertTrue(entered.wait(.5))
            transport.close()
        finally:
            release.set()
            thread.join(1)
        self.assertFalse(thread.is_alive())
        self.assertTrue(any(isinstance(e, ConnectionError) for e in errors))
        with self.assertRaises(ConnectionError):
            transport.read(1, 1)

    def test_close_during_read_rejects_a_late_reply(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        def late_reply(count, timeout):
            transport.close()
            return b'A'
        peer.on_read = late_reply
        with self.assertRaises(ConnectionError):
            transport.read(1, 1)
        self.assertEqual(peer.closed, 1)

    def test_close_during_write_cannot_report_success(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        def late_count(data, timeout):
            transport.close()
            return len(data)
        peer.on_write = late_count
        with self.assertRaises(ConnectionError):
            transport.write(b'abc', 1)
        self.assertEqual(peer.closed, 1)

    def test_close_is_idempotent_and_prevents_reopen(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        transport.close()
        transport.close()
        self.assertEqual(peer.closed, 1)
        with self.assertRaises(ConnectionError):
            transport.open()

    def test_actual_shared_framed_channel_uses_the_adapter_without_reencoding(self):
        transport, peer, _ = self.make(allow_hardware=True)
        transport.open()
        peer.parts = [1, 1, 1]
        peer.incoming = [b'\x00', b'\x01', b'B']
        channel = FramedChannel(transport)
        channel.send(b'\x00\x01A')
        self.assertEqual(bytes(peer.wire), b'\x00\x01A')
        self.assertEqual(channel.receive(1, require_encrypted=False), b'\x00\x01B')
        channel.close()


if __name__ == '__main__':
    unittest.main()
