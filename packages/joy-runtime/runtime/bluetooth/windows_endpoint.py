"""Windows RFCOMM endpoint encoding; no DLL loading, radio access or device I/O.

SOCKADDR_BTH uses the ws2bth.h one-byte packing, not host-native alignment.
Use fixed-width fields: ctypes.c_ulong is 64-bit on some non-Windows hosts.
A caller must explicitly choose a service UUID (Windows performs SDP) OR a
previously discovered RFCOMM channel. No default channel or service fallback.

ABI: https://learn.microsoft.com/windows/win32/api/ws2bth/ns-ws2bth-sockaddr_bth
Resolution: https://learn.microsoft.com/windows/win32/bluetooth/bluetooth-and-connect
Packing: mingw-w64-headers/include/ws2bth.h (pshpack1.h / poppack.h).
"""
import ctypes
import re
from uuid import UUID

AF_BTH = 32
BTHPROTO_RFCOMM = 3


class GUID(ctypes.LittleEndianStructure):
    _fields_ = [('Data1', ctypes.c_uint32), ('Data2', ctypes.c_uint16),
                ('Data3', ctypes.c_uint16), ('Data4', ctypes.c_uint8 * 8)]


class SockaddrBth(ctypes.LittleEndianStructure):
    _pack_ = 1
    _fields_ = [('addressFamily', ctypes.c_uint16), ('btAddr', ctypes.c_uint64),
                ('serviceClassId', GUID), ('port', ctypes.c_uint32)]


def rfcomm_address(address, *, channel=None, service_uuid=None):
    """Build an explicitly resolved remote endpoint, without authorizing a connect."""
    if not isinstance(address, str) or re.fullmatch(
            r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}|(?:[0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}',
            address) is None:
        raise ValueError('Expected a complete Bluetooth address with consistent separators')
    numeric_address = int(address.replace(':', '').replace('-', ''), 16)
    if not numeric_address:
        raise ValueError('A remote radio address must not be zero')
    if (channel is None) == (service_uuid is None):
        raise ValueError('Choose exactly one service UUID or discovered remote channel')
    if channel is not None:
        if type(channel) is not int or not 1 <= channel <= 30:
            raise ValueError('Remote RFCOMM channel must be an integer in 1..30')
        identifier = UUID(int=0)
    else:
        if not isinstance(service_uuid, UUID) or service_uuid.int == 0:
            raise ValueError('Expected a non-null service UUID')
        identifier = service_uuid
    return SockaddrBth(AF_BTH, numeric_address,
                       GUID.from_buffer_copy(identifier.bytes_le),
                       0 if channel is None else channel)
