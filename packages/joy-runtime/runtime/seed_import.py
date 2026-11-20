"""One-time, read-only seed import for an explicitly supported macOS helper build.

Never executes/loads the helper, searches heuristically, or embeds seed bytes.
ARM64 assembly Evidence ev_5bda42eaba078919f7e6049262283b877ef60aec9d7ca08692f02a320beb354b:
ldp/stp copies 32 bytes at the verified VA; MOVZ supplies the final STRB byte.
After import, the KindCut session runtime needs only its protected provisioning.
"""
import hashlib
import os
from pathlib import Path
import stat
import struct

SUPPORTED_ARM64_SHA256='6381fc973fc43e8e20682fed9adfa7aeaa4e5383cdc226c857eba8fc6ed81ca9'
_DATA_VA=0x1003d6379
_MOV_VA=0x1000b6220
_LIMIT=512*1024*1024


def _arm64_slice(data):
    if len(data)<32:raise ValueError('Truncated helper image')
    if data[:4]==b'\xcf\xfa\xed\xfe':
        if struct.unpack_from('<I',data,4)[0]!=0x100000c:raise ValueError('Unsupported image architecture')
        return data
    magic=data[:4]
    if magic not in (b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf'):raise ValueError('Unsupported image format')
    count=struct.unpack_from('>I',data,4)[0];wide=magic[-1]==0xbf;stride=32 if wide else 20
    end=8+count*stride
    if not 1<=count<=64 or end>len(data):raise ValueError('Invalid universal table')
    ranges=[];matches=[]
    for i in range(count):
        if wide:cpu,_,offset,size,align,_=struct.unpack_from('>IIQQII',data,8+i*stride)
        else:cpu,_,offset,size,align=struct.unpack_from('>IIIII',data,8+i*stride)
        if not size or offset<end or offset+size>len(data) or align>31 or offset%(1<<align):raise ValueError('Invalid universal slice')
        if any(offset<b and offset+size>a for a,b in ranges):raise ValueError('Overlapping universal slices')
        ranges.append((offset,offset+size))
        if cpu==0x100000c:matches.append(data[offset:offset+size])
    if len(matches)!=1:raise ValueError('Missing or ambiguous ARM64 slice')
    result=matches[0]
    if len(result)<32 or result[:4]!=b'\xcf\xfa\xed\xfe' or struct.unpack_from('<I',result,4)[0]!=0x100000c:
        raise ValueError('Invalid ARM64 slice header')
    return result


def _read_virtual(data,address,count):
    if len(data)<32 or data[:4]!=b'\xcf\xfa\xed\xfe' or not 0<=address<1<<64 or not 0<count<=_LIMIT or address+count>1<<64:
        raise ValueError('Invalid virtual range')
    commands,total=struct.unpack_from('<II',data,16);end=32+total
    if not 1<=commands<=4096 or end>len(data):raise ValueError('Invalid load command table')
    offset=32;matches=[]
    for _ in range(commands):
        if offset+8>end:raise ValueError('Truncated load command')
        kind,size=struct.unpack_from('<II',data,offset)
        if size<8 or offset+size>end:raise ValueError('Invalid load command size')
        if kind==0x19:
            if size<72:raise ValueError('Truncated segment')
            vm,vmsize,fileoff,filesize=struct.unpack_from('<QQQQ',data,offset+24)
            sections=struct.unpack_from('<I',data,offset+64)[0]
            if 72+sections*80>size or filesize>vmsize or fileoff+filesize>len(data):raise ValueError('Invalid segment bounds')
            if vm<=address and address+count<=vm+filesize:
                start=fileoff+address-vm;matches.append(data[start:start+count])
        offset+=size
    if offset!=end or len(matches)!=1 or len(matches[0])!=count:raise ValueError('Unmapped or ambiguous virtual range')
    return matches[0]


def _extract_seed(data,data_address,mov_address):
    prefix=_read_virtual(data,data_address,32)
    word=struct.unpack('<I',_read_virtual(data,mov_address,4))[0]
    if word&0xffe0001f!=0x52800008:raise ValueError('Unexpected seed initializer instruction')
    immediate=(word>>5)&0xffff
    if immediate>255:raise ValueError('Invalid seed initializer width')
    return prefix+bytes([immediate])


def read_seed_prefix(helper_path):
    try:
        path=Path(helper_path)
        if not path.is_absolute():raise ValueError('Expected absolute helper source')
        fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
        with os.fdopen(fd,'rb') as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or not 32<=info.st_size<=_LIMIT:raise ValueError('Invalid helper size')
            raw=stream.read(_LIMIT+1)
        if len(raw)>_LIMIT:raise ValueError('Helper image too large')
        arm64=_arm64_slice(raw)
        if hashlib.sha256(arm64).hexdigest()!=SUPPORTED_ARM64_SHA256:raise ValueError('Unsupported helper build')
        return _extract_seed(arm64,_DATA_VA,_MOV_VA)
    except (OSError,ValueError,TypeError,struct.error):
        raise ValueError('Unsupported or malformed helper source; no material imported') from None
