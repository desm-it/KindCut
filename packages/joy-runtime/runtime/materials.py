"""Explicit in-memory settings8 provisioning. No paths, cache reads or hardware.

Source: passes 7/9 container decode, protobuf mapping and native b6ad0 selector.
Secret-bearing values are omitted from repr/errors and never logged or saved.
"""
import base64
from dataclasses import dataclass,field
import math
import re
import struct
from joy_crypto import decrypt_blocks

LIMIT=4*1024*1024


def _varint(data,index):
    value=0
    for number in range(10):
        if index>=len(data):raise ValueError('Truncated protobuf')
        byte=data[index];index+=1
        if number==9 and byte>1:raise ValueError('Oversized varint')
        value|=(byte&127)<<(7*number)
        if not byte&128:return value,index
    raise ValueError('Oversized varint')


def _fields(data):
    index=0
    while index<len(data):
        tag,index=_varint(data,index);number,wire=tag>>3,tag&7
        if not 0<number<=536870911:raise ValueError('Invalid field number')
        if wire==0:value,index=_varint(data,index)
        elif wire in (1,5):
            size=8 if wire==1 else 4;value=data[index:index+size];index+=size
        elif wire==2:
            size,index=_varint(data,index);value=data[index:index+size];index+=size
        else:raise ValueError('Unsupported protobuf wire type')
        if index>len(data):raise ValueError('Truncated protobuf field')
        yield number,wire,value


def decode_settings8(value: str,seed_prefix: bytes) -> bytes:
    """Import the encrypted cached STRING with an explicitly supplied 33-byte seed.

    This does not discover/read the seed from a stock app or an account cache.
    A one-time importer may obtain it from already-authorized static evidence.
    """
    try:
        if not isinstance(value,str) or not 69<=len(value)<=LIMIT or len(seed_prefix)!=33:
            raise ValueError('Invalid settings envelope')
        embedded=base64.b64decode(value[25:69],validate=True)
        if len(embedded)!=32:raise ValueError('Invalid embedded material')
        key=(bytes(seed_prefix)+embedded)[::-2][:32]
        encrypted=base64.b64decode(value[:25]+value[69:],validate=True)
        return decrypt_blocks(encrypted,key).rstrip(b'\0')
    except (ValueError,TypeError,UnicodeError):
        raise ValueError('Malformed encrypted provisioning container') from None


def selector_version(component_i32: int,component_u32: int,*,special: bool=False) -> float:
    """Assembly 037ce0: signed major, signed-positive minor guard and epsilon."""
    if special:return 999.999
    if not isinstance(component_i32,int) or not -(1<<31)<=component_i32<(1<<31):
        raise ValueError('Invalid signed firmware component')
    if not isinstance(component_u32,int) or not 0<=component_u32<=0xffffffff:
        raise ValueError('Invalid unsigned firmware component')
    fraction=component_u32*1e-6 if 0<component_u32<0x80000000 else 1e-6
    return (component_i32+fraction)/1000.0


@dataclass(frozen=True)
class _Record:
    machine_type:int
    lower:float
    upper:float
    odd:bool
    reverse:bool
    mix:bool
    raw:bytes=field(repr=False)


@dataclass(frozen=True)
class SelectedMaterial:
    record_index:int
    used_fallback:bool
    material:bytes=field(repr=False)


class MaterialStore:
    def __init__(self,records):self._records=tuple(records)

    @classmethod
    def from_protobuf(cls,data:bytes):
        try:
            if not isinstance(data,bytes) or not 0<len(data)<=LIMIT:
                raise ValueError('Invalid container size')
            records=[]
            for number,wire,value in _fields(data):
                if number!=2:continue
                if wire!=2 or len(records)>=4096:raise ValueError('Invalid record list')
                fields={}
                for n,w,v in _fields(value):
                    if n in [2,5] and w!=2:raise ValueError('Wrong string wire type')
                    if n in [4,18,43,50] and w!=0:raise ValueError('Wrong scalar wire type')
                    fields[n]=v  # Protobuf singular fields use the last occurrence.
                encoded=fields.get(2,b'');packed_text=fields.get(5,b'').decode('ascii')
                if not re.fullmatch(r'[+-]?[0-9]{1,20}',packed_text):raise ValueError('Invalid packed bounds')
                packed=int(packed_text)
                if not -(1<<63)<=packed<(1<<63):raise ValueError('Packed bounds outside int64')
                lower,upper=struct.unpack('<ff',packed.to_bytes(8,'little',signed=True))
                raw=base64.b64decode(encoded,validate=True)
                if len(raw)!=64:raise ValueError('Expected 64 material bytes')
                bits=fields.get(43,0)&0xffffffff
                machine=struct.unpack('<i',bits.to_bytes(4,'little'))[0]
                records.append(_Record(machine,lower,upper,bool(fields.get(50,0)&1),
                                       not bool(fields.get(18,0)&1),fields.get(4,0)==5,raw))
            if not records:raise ValueError('No records')
            return cls(records)
        except (ValueError,TypeError,UnicodeError,OverflowError,AttributeError):
            raise ValueError('Malformed provisioning records') from None

    @property
    def record_count(self):return len(self._records)

    def select(self,machine_type:int,version:float,identifier:bytes=b'') -> SelectedMaterial:
        if not isinstance(machine_type,int) or not -(1<<31)<=machine_type<(1<<31) or not math.isfinite(version):
            raise ValueError('Invalid machine/version selector')
        if not isinstance(identifier,(bytes,bytearray)):raise ValueError('Expected identifier bytes')
        found=next(((i,r) for i,r in enumerate(self._records) if r.machine_type==machine_type and r.lower<version<r.upper),None)
        fallback=found is None
        if fallback:found=next(((i,r) for i,r in enumerate(self._records) if r.machine_type==7),None)
        if found is None:raise ValueError('No matching initialization material')
        index,record=found;material=record.raw[int(record.odd)::2]
        if record.reverse:material=material[::-1]
        if record.mix and not fallback:
            # Fail closed instead of native's silent no-op for short identifiers.
            if len(identifier)<12:raise ValueError('Selected record requires a device identifier')
            mixed=bytearray(material)
            for target,source in [(2,0),(5,2),(7,5),(10,9),(13,11)]:mixed[target]=identifier[source]
            material=bytes(mixed)
        return SelectedMaterial(index,fallback,material)
