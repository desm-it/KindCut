"""Original-Joy indexed pressure-table body codec; no transport or device I/O.

Selected12/12 native efe74/efa38 reads sixteen persistent-memory entries.
These are inner A0 bodies only, not encrypted/framed requests or authorization.
The second response word is a packed pressure/count pair, NOT an axis float.
"""
from dataclasses import dataclass
import struct

from joy_pressure_curve import interpolate_pressure_counts


@dataclass(frozen=True)
class PressureTableEntry:
    index: int
    pressure_native: int
    position_counts: int
    opaque_first_word: int


def _request(index):
    if type(index) is not int or not 1 <= index <= 16:
        raise ValueError('Expected an original-Joy pressure-table index1..16.')
    return struct.pack('>BH', 0xa0, index)


def pressure_table_request_bodies():
    """Fixed read-only body set; constructing it never sends anything."""
    return tuple(_request(index) for index in range(1, 17))


def decode_pressure_entry(index, payload):
    """Strict local exact11-byte admission; native accepts length>=11."""
    expected = _request(index)
    if type(payload) is not bytes or len(payload) != 11 or payload[:3] != expected:
        raise ValueError('Pressure reply length/opcode/property correlation failed.')
    first, packed = struct.unpack('>II', payload[3:])
    return PressureTableEntry(index, packed >> 16, packed & 0xffff, first)


def decode_pressure_table(payloads):
    """Keep all sixteen raw rows in native request order, including zero rows."""
    if type(payloads) not in (tuple, list) or len(payloads) != 16:
        raise ValueError('All sixteen ordered pressure-table replies are required.')
    return tuple(decode_pressure_entry(index, payload)
                 for index, payload in enumerate(payloads, 1))


def pressure_counts_from_responses(requested, payloads):
    """Compose the real decoder and curve math for the selected model12 bucket0.

    No native tool/preset, live-value freshness or physical calibration claim.
    Raw decode permits any U16 row; interpolation additionally applies its
    documented local strict increasing-input admission, failing rather than
    guessing how to repair duplicate/unsorted/unused records.
    """
    rows = decode_pressure_table(payloads)
    return interpolate_pressure_counts(
        requested, tuple((row.pressure_native, row.position_counts) for row in rows))
