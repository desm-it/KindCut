"""Verify the actual packaged owned worker's pure profile code, no device.

Read the PyInstaller archive; extract only the measurement_profile code object.
Do not execute module initialization or the worker entrypoint. Pure supporting
codec functions come from the reviewed source; expected wire bytes are literal.
"""
import json
import math
import os
from pathlib import Path
import struct
import sys
import types
from PyInstaller.archive.readers import CArchiveReader

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/joy-runtime/runtime'))
from joy_mat_codec import dimensions
from joy_protocol import clear_frame

runtime=Path(os.environ['KINDCUT_VERIFY_RUNTIME'])
assert runtime.is_absolute() and runtime.is_file()
archive=CArchiveReader(str(runtime)).open_embedded_archive('PYZ.pyz')
module=archive.extract('joy_measurement_experiment')
code=next(c for c in module.co_consts if isinstance(c,types.CodeType) and c.co_name=='measurement_profile')
# No module execution, transport, imports, file operations or secrets in globals.
profile=types.FunctionType(code,{'__builtins__':{'bytes':bytes,'int':int,'tuple':tuple,'float':float},'math':math,'struct':struct,'dimensions':dimensions,'clear_frame':clear_frame})
expected_words=(300,300,400,400,1000)*2+(1000,1000,2000,2000,2500)+(1000,1000,3860,3860,25000)
for height,encoded_height in [(6.5,7),(12,12)]:
    rows=profile(height)
    assert rows[0]==clear_frame(bytes([0x30,0x88,0,0,5,encoded_height])+bytes(4)+bytes([2,0,0]))
    assert rows[1]==clear_frame(b'\x31'+b'\x0f'*5+struct.pack('>20H',*expected_words))
    assert rows[2]==clear_frame(b'\x3e\x00\x02'+bytes(17))
print(json.dumps({'passed':True,'actualPackagedFrozenProfile':True,'cases':[6.5,12],'profileBodies':3,'drawMode':2,'geometryPrefix':'3e0002','thetaMoveVelocityWord':1000,'thetaMoveAccelerationWord':25000,'nonXYMoveAccelerationWord':3860,'moduleOrWorkerEntryExecuted':False,'transportOrHardwareAccess':False,'supportingCodecBoundary':'reviewed source pure dimensions/clear_frame helpers'}))
