"""Joy/CUPID crypto primitives reconstructed from shipped ARM64 code.

No Bluetooth, cache reads, helper execution or implicit key provisioning.
AES-ECB plus additive checksum is NOT authenticated encryption. Bootstrap
length/offset checks do not authenticate the peer or prove the selected key.
Python-managed secret buffers are not guaranteed to be securely erased.
"""
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def _validate(data: bytes, key: bytes) -> None:
    if len(key) != 32:
        raise ValueError('AES-256 requires exactly 32 key bytes')
    if not data or len(data) % 16:
        raise ValueError('Expected nonempty complete AES blocks')


def encrypt_blocks(data: bytes, key: bytes) -> bytes:
    _validate(data,key)
    operation=Cipher(algorithms.AES(key),modes.ECB()).encryptor()
    return operation.update(data)+operation.finalize()


def decrypt_blocks(data: bytes, key: bytes) -> bytes:
    # Raw primitive: never strip zero bytes from keys, checksum or padding.
    _validate(data,key)
    operation=Cipher(algorithms.AES(key),modes.ECB()).decryptor()
    return operation.update(data)+operation.finalize()


def encode_encrypted(clear: bytes, key: bytes) -> bytes:
    """Encrypt a complete clear BE16 command, including its inner header.

    FUN_10004b528 always reserves another block at aligned lengths, zero-fills,
    and stores sum(previous bytes) modulo 256 in the final padded byte.
    The cap/inner-length validation is an explicit conservative safety policy.
    """
    if len(clear)<2 or clear[0]&0x80 or int.from_bytes(clear[:2],'big')!=len(clear)-2:
        raise ValueError('Expected a complete clear Joy command buffer')
    padded_length=(len(clear)//16+1)*16
    if padded_length>512:
        raise ValueError('Encrypted frame exceeds recovered receive cap')
    plain=bytearray(padded_length)
    plain[:len(clear)]=clear
    plain[-1]=sum(plain[:-1])&255
    cipher=encrypt_blocks(bytes(plain),key)
    return (0x8000|len(cipher)).to_bytes(2,'big')+cipher


def decode_encrypted(frame: bytes, key: bytes) -> bytes:
    """Verify the padded checksum, then normalize the inner receive header.

    Assembly of FUN_1000b307c proves zero-trim length is discarded by the
    wrapper: checksum uses all cipher blocks, including a zero checksum byte.
    FUN_1000b4744 swaps inner bytes 0/1 only when byte 0 is nonzero.
    Inner-length bounds are our additional fail-closed guard.
    """
    if len(frame)<2:
        raise ValueError('Missing encrypted-frame header')
    header=int.from_bytes(frame[:2],'big')
    size=header&0x7fff
    if not header&0x8000 or size>512 or size!=len(frame)-2:
        raise ValueError('Invalid encrypted-frame envelope')
    plain=bytearray(decrypt_blocks(frame[2:],key))
    if plain[-1]!=(sum(plain[:-1])&255):
        raise ValueError('Encrypted-frame checksum mismatch')
    if plain[0]!=0:
        plain[0],plain[1]=plain[1],plain[0]
    inner=int.from_bytes(plain[:2],'big')
    if inner+2>len(plain)-1:
        raise ValueError('Inner response length exceeds decrypted data')
    return bytes(plain[:inner+2])


def extract_session_key(reply: bytes, bootstrap_key: bytes) -> bytes:
    """Decrypt a complete clear 00 30 + 48-byte Joy initialization response.

    FUN_1000b6e44 selects 32 bytes at plaintext[0]. Bounds checks are our
    fail-closed guard against malformed/wrong-material plaintext, not a MAC.
    """
    if len(reply)!=50 or reply[:2]!=b'\x00\x30':
        raise ValueError('Expected a 48-byte initialization payload and BE16 header')
    plain=decrypt_blocks(reply[2:],bootstrap_key)
    offset=plain[0]
    if offset+32>len(plain):
        raise ValueError('Initialization key offset is outside the plaintext')
    return plain[offset:offset+32]


class SessionCrypto:
    """Explicit inert/active state; does not negotiate with any device."""
    def __init__(self):
        self._key=None

    @property
    def active(self) -> bool:
        return self._key is not None

    def activate(self,reply: bytes,bootstrap_key: bytes) -> None:
        if self.active:
            raise ValueError('Reset session explicitly before renegotiation')
        self._key=extract_session_key(reply,bootstrap_key)

    def reset(self) -> None:
        self._key=None

    def encode(self,clear: bytes) -> bytes:
        if self._key is None:
            raise ValueError('No session key installed')
        return encode_encrypted(clear,self._key)

    def decode(self,frame: bytes) -> bytes:
        if self._key is None:
            raise ValueError('No session key installed')
        return decode_encrypted(frame,self._key)
