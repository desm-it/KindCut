"""Verify packaged reply parsers without executing module/worker startup.

Requires the project's build venv (PyInstaller); archive is KindCut-owned code.
"""
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import struct
import types

CArchiveReader=importlib.import_module('PyInstaller.archive.readers').CArchiveReader
runtime=Path(os.environ['KINDCUT_VERIFY_RUNTIME']);assert runtime.is_absolute()and runtime.is_file()
module=CArchiveReader(str(runtime)).open_embedded_archive('PYZ.pyz').extract('joy_measurement_experiment')
root=Path(__file__).resolve().parents[3]
source=compile((root/'packages/joy-runtime/runtime/joy_measurement_experiment.py').read_text(),'<source>','exec',dont_inherit=True,optimize=0)
def normal(value):
    if isinstance(value,types.CodeType):return{'code':value.co_code.hex(),'consts':[normal(c)for c in value.co_consts],'names':value.co_names,'vars':value.co_varnames,'flags':value.co_flags,'free':value.co_freevars,'cells':value.co_cellvars}
    if isinstance(value,bytes):return{'bytes':value.hex()}
    if isinstance(value,(tuple,frozenset)):return[normal(c)for c in (sorted(value)if isinstance(value,frozenset)else value)]
    if value is Ellipsis:return{'ellipsis':True}
    return value
assert normal(module)==normal(source),'Frozen module differs from reviewed source code'
def function(name):
    code=next(c for c in module.co_consts if isinstance(c,types.CodeType)and c.co_name==name)
    return types.FunctionType(code,{'__builtins__':{'type':type,'bytes':bytes,'len':len,'ValueError':ValueError},'math':math,'struct':struct})
validate,query,start=(function(name)for name in ['_validate_control_reply','_parse_query','_valid_start_reply'])
assert validate(0x11,bytes.fromhex('11004099999a414000000000000000000000'),bytes.fromhex('0011050190'))
control_cases=0
for opcode in (0x11,0x79,0xed,0x30,0x31,0x3e):
    for detail in range(256):
        assert validate(opcode,b'',bytes([0,opcode,detail,detail^255,detail]));control_cases+=1
for state in range(256):assert query(bytes([0,state])+struct.pack('>f',1.5))==(False,1.5)
for detail in range(256):assert start(bytes([0,0xee,0x85,1,detail]))
assert struct.pack('>f',query(bytes.fromhex('00ee8501ff'))[1]).hex()=='8501ff00'
for bad in ['0079050190','01110501903500','00110501','001105019000']:
    try:validate(0x11,b'',bytes.fromhex(bad))
    except ValueError:pass
    else:raise AssertionError('Invalid control reply accepted')
print(json.dumps({'passed':True,'actualFrozenModuleMatchesSource':True,'moduleCodeDigest':hashlib.sha256(json.dumps(normal(module),sort_keys=True).encode()).hexdigest(),'capturedPass92ReplyAccepted':True,'opaqueControlDetailVariations':control_cases,'rawQueryStateVariations':256,'startDetailVariations':256,'malformedAndNegativeRejected':True,'workerOrModuleEntryExecuted':False,'hardwareAccess':False}))
