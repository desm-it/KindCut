"""Pure Joy protocol helpers copied verbatim from the tested pass-12 transcription."""
MAX_PAYLOAD = 512

def clear_frame(payload: bytes) -> bytes:
    # Applying the receive cap to generated output is our conservative guard.
    if len(payload) > MAX_PAYLOAD:
        raise ValueError('Payload too large')
    return len(payload).to_bytes(2, 'big') + payload


def request(kind: str, randomness: bytes = b'', offset: int = 0) -> bytes:
    """Build only named source-derived pre-encryption requests; does not send."""
    if kind == 'firmware':
        return clear_frame(bytes.fromhex('12000000'))
    if kind == 'status':
        return clear_frame(bytes.fromhex('60000000'))
    if kind == 'reset' and len(randomness) == 3:
        return clear_frame(b'\xcf' + randomness)
    if kind == 'bootstrap' and len(randomness) == 51 and 0 <= offset <= 255:
        output = bytearray(randomness)
        output[:3] = bytes.fromhex('0031c7')
        output[3] = offset % 12 + 2
        return bytes(output)
    raise ValueError('Unknown request or invalid supplied random data')


def parse_status(payload: bytes, *, include_extra: bool) -> dict:
    """Parse a normalized/decrypted payload, not ciphertext or an outer frame.

    include_extra must reflect the native device-field guard; we do not infer it
    merely from the marketing model name. User-facing field meanings are unknown.
    """
    if len(payload) < 9 or payload[0] != 0x60:
        raise ValueError('Unexpected machine-status payload')
    extra = int.from_bytes(payload[3:5], 'big')
    return {'status_byte_1':payload[1], 'status_byte_2':payload[2],
            'extra_u16_raw':extra, 'extra_u16_native':extra if include_extra else 0,
            'value_be32':int.from_bytes(payload[5:9], 'big'), 'extension':payload[9:]}


def parse_firmware(payload: bytes) -> dict:
    """Recover raw command-result fields, not a verified marketing version.

    Does not prove how this object is copied into the device selector state.
    """
    if len(payload) == 6:
        version_word = int.from_bytes(payload[:2], 'big', signed=True) & 0xffffffff
        component = int.from_bytes(payload[4:6], 'big', signed=True)
        fraction = int.from_bytes(payload[2:4], 'big', signed=True) & 0xffffffff
        return {'format':'legacy6', 'version_word_bits':version_word,
                'component_i32':component, 'component_u32':fraction, 'extension':b''}
    if len(payload) >= 8:
        return {'format':'extended', 'version_word_bits':int.from_bytes(payload[:4],'little'),
                'component_i32':int.from_bytes(payload[4:6],'big',signed=True),
                'component_u32':int.from_bytes(payload[6:8],'big',signed=True)&0xffffffff,
                'extension':payload[8:]}
    raise ValueError('Unexpected firmware-result payload length')
