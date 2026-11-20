"""Existing synthetic fixtures only; not observed device traffic."""
import base64,struct
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
from joy_crypto import encrypt_blocks,decode_encrypted
RAW=bytes(range(64))
SESSION_KEY=bytes(range(32,64))

def varint(value):
    out=bytearray()
    while value>127:out.append((value&127)|128);value>>=7
    out.append(value);return bytes(out)

def field(number,value):
    if isinstance(value,bytes):return varint(number*8+2)+varint(len(value))+value
    return varint(number*8)+varint(value)

def record(model=12,lower=8.0,upper=9.0,odd=0,forward=1,mix=0,raw=RAW):
    packed=int.from_bytes(struct.pack('<ff',lower,upper),'little',signed=True)
    return b''.join([field(2,base64.b64encode(raw)),field(5,str(packed).encode()),field(4,mix),field(18,forward),field(43,model&0xffffffffffffffff),field(50,odd),field(99,1)])

def container(*records):return b''.join(field(2,r) for r in records)

def cached(blob,seed):
    embedded=bytes(range(33,65));key=(seed+embedded)[::-2][:32]
    plain=blob+bytes((-len(blob))%16)
    op=Cipher(algorithms.AES(key),modes.ECB()).encryptor();encoded=base64.b64encode(op.update(plain)+op.finalize()).decode()
    return encoded[:25]+base64.b64encode(embedded).decode()+encoded[25:]

class SyntheticJoy:
    def __init__(self,failure=None):
        self.failure=failure;self.sent=[];self.pending=[];self.closed=False
        self.bootstrap_key=RAW[::2]
    def write(self,data,timeout):
        step=len(self.sent);self.sent.append(data)
        if step==0:
            if data[:3]!=bytes.fromhex('0004cf'):raise AssertionError('Wrong reset template')
            reply=bytes.fromhex('0001cf') # Opaque synthetic reset reply, not a captured ACK.
        elif step==1:
            if data!=bytes.fromhex('000412000000'):raise AssertionError('Wrong firmware request')
            payload=bytes.fromhex('12345678')+(8030).to_bytes(2,'big')+bytes(2)
            if self.failure=='firmware':payload=bytes(7)
            reply=len(payload).to_bytes(2,'big')+payload
        elif step==2:
            if len(data)!=51 or data[:3]!=bytes.fromhex('0031c7'):raise AssertionError('Wrong Joy bootstrap')
            offset=data[3]
            plain=bytes([offset])+bytes(offset-1)+SESSION_KEY+bytes(48-offset-32)
            if self.failure=='offset':plain=bytes([17])+plain[1:]
            reply=bytes.fromhex('0030')+encrypt_blocks(plain,self.bootstrap_key)
            if self.failure=='timeout':return len(data)
        else:
            if decode_encrypted(data,SESSION_KEY)!=bytes.fromhex('000460000000'):raise AssertionError('Status request not encrypted correctly')
            body=bytes.fromhex('60a1b2ccdd01020304')
            plain=bytearray(16);plain[:11]=bytes([len(body),0])+body;plain[-1]=sum(plain[:-1])&255
            if self.failure=='checksum':plain[-1]^=1
            reply=bytes.fromhex('8010')+encrypt_blocks(bytes(plain),SESSION_KEY)
            if self.failure=='clear-status':reply=len(body).to_bytes(2,'big')+body
        self.pending.extend(part for part in [reply[:1],reply[1:4],reply[4:]] if part)
        return len(data)
    def read(self,n,timeout):
        if not self.pending:return b''
        part=self.pending.pop(0)
        if len(part)>n:self.pending.insert(0,part[n:])
        return part[:n]
    def close(self):self.closed=True
