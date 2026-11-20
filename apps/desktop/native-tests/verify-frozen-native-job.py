"""Read actual frozen job code and test pure parsers; no module/worker startup."""
import hashlib
import importlib
import json
import marshal
import os
from pathlib import Path
import types
CArchiveReader=importlib.import_module('PyInstaller.archive.readers').CArchiveReader
runtime=Path(os.environ['KINDCUT_VERIFY_RUNTIME']);assert runtime.is_absolute()and runtime.is_file()
archive=CArchiveReader(str(runtime));pyz=archive.open_embedded_archive('PYZ.pyz')
root=Path(__file__).resolve().parents[3]
def normal(value):
    if isinstance(value,types.CodeType):
        names=('co_argcount','co_posonlyargcount','co_kwonlyargcount','co_nlocals','co_stacksize','co_flags','co_names','co_varnames','co_freevars','co_cellvars','co_qualname')
        return{**{n:getattr(value,n)for n in names},'code':value.co_code.hex(),'exceptionTable':value.co_exceptiontable.hex(),'consts':[normal(c)for c in value.co_consts]}
    if isinstance(value,bytes):return{'bytes':value.hex()}
    if isinstance(value,(tuple,frozenset)):return[normal(c)for c in(sorted(value)if isinstance(value,frozenset)else value)]
    if value is Ellipsis:return{'ellipsis':True}
    return value
modules={};hashes={}
for name in ('joy_job_program','joy_job_executor','joy_job_task','joy_job_diagnostics','joy_configuration_workflow','joy_blade_trial','joy_tool_return','joy_blade_job'):
    frozen=pyz.extract(name);source=compile((root/f'packages/joy-runtime/runtime/{name}.py').read_text(),'<source>','exec',dont_inherit=True,optimize=0)
    assert normal(frozen)==normal(source),f'Frozen {name} differs from source'
    modules[name]=frozen;hashes[name]=hashlib.sha256(json.dumps(normal(frozen),sort_keys=True).encode()).hexdigest()
assert 'worker'in archive.toc,'Frozen entry script not found'
frozen_worker=marshal.loads(archive.extract('worker'));worker=compile((root/'packages/joy-runtime/runtime/worker.py').read_text(),'<source>','exec',dont_inherit=True,optimize=0)
assert normal(frozen_worker)==normal(worker),'Frozen entry code differs from worker source'
hashes['worker']=hashlib.sha256(json.dumps(normal(frozen_worker),sort_keys=True).encode()).hexdigest()
def pure(name):
    code=next(c for c in modules['joy_job_executor'].co_consts if isinstance(c,types.CodeType)and c.co_name==name)
    return types.FunctionType(code,{'__builtins__':{'type':type,'bytes':bytes,'len':len,'ValueError':ValueError}})
ack,interface=pure('_parse_ack'),pure('_parse_interface')
assert ack(bytes.fromhex('0043050190'),0x43)==(True,5,1,144)
assert not ack(bytes.fromhex('01430501903500'),0x43)[0]
assert interface(bytes.fromhex('730102030405'))==bytes([1,2,3,4,5])
for payload in (b'\x73',bytes.fromhex('0073050190'),bytes.fromhex('73010203040506')):
    try:interface(payload)
    except ValueError:pass
    else:raise AssertionError('Malformed interface reply accepted')
# Execute the ACTUAL frozen executor code with explicitly inert source definitions.
# No frozen module/worker entry, device initialization or secret provider is run.
import sys
sys.path.insert(0,str(root/'packages/joy-runtime/runtime'))
sys.path.insert(0,str(root/'packages/joy-runtime/tests'))
source_definitions=importlib.import_module('joy_job_executor')
QueuePauseTests=importlib.import_module('test_joy_job_executor').QueuePauseTests
executor_code=next(c for c in modules['joy_job_executor'].co_consts if isinstance(c,types.CodeType)and c.co_name=='run_job_program')
namespace=dict(source_definitions.__dict__);namespace['_parse_ack']=ack;namespace['_parse_interface']=interface
frozen_executor=types.FunctionType(executor_code,namespace)
frozen_executor.__kwdefaults__=source_definitions.run_job_program.__kwdefaults__.copy()
case=QueuePauseTests();session,guard,program,flags,stages,kwargs=case.run_paused()
result=frozen_executor(**kwargs)
assert 'paused'in stages and result.accepted_records==5
assert not result.physical_completion_verified and not result.motion_stopped_verified
assert not result.diagnostic_capture_incomplete
assert b''.join(p[3:]for p in session.channel.sent if p[2]==0x43)==b''.join(program.passes[0].paths[0].records)+b''.join(source_definitions.ORIGIN_RETURN_RECORDS)
assert 'returning_to_origin'in stages and result.return_to_origin=='protocol_complete'
# The shipped restriction resource must be identical to reviewed source policy.
policy_source=root/'packages/joy-runtime/runtime/profiles/first-cut-trial.json'
policy_host=root/'apps/desktop/src/shell/joy-blade-trial-policy.json'
policy_frozen=runtime.parent/'_internal/profiles/first-cut-trial.json'
assert policy_source.read_bytes()==policy_host.read_bytes()==policy_frozen.read_bytes(),'Blade policy drift/missing packaged policy'
# Exercise the actual frozen pure policy function with its identical source helpers.
# No frozen module/worker entry or transport is executed.
blade_defs=importlib.import_module('joy_blade_trial')
blade_code=next(c for c in modules['joy_blade_trial'].co_consts if isinstance(c,types.CodeType)and c.co_name=='require_blade_trial')
blade_namespace=dict(blade_defs.__dict__)
frozen_blade_policy=types.FunctionType(blade_code,blade_namespace)
fixture=json.loads((root/'apps/desktop/native-tests/blade-trial.synthetic.json').read_text())
frozen_blade_policy(fixture['plan'],fixture['settings'],fixture['pressures'])
import copy
wrong=copy.deepcopy(fixture['plan']);wrong['groups'][0]['paths'][0]['steps'][1]['points'][0]['x']+=1
try:frozen_blade_policy(wrong,fixture['settings'],fixture['pressures'])
except (ValueError,PermissionError):pass
else:raise AssertionError('Frozen policy admitted a non-square')
print(json.dumps({'passed':True,'actualFrozenModuleHashes':hashes,'allReviewedCodeIncludingWorkerMatchesSource':True,'pureParsersChecked':True,'frozenWorkerOrModuleEntryExecuted':False,'inertSourceDefinitionsImported':True,'actualFrozenQueuePauseResumeExercised':True,'actualFrozenRestrictedBladePolicyExercised':True,'packagedPolicyMatchesBothSources':True,'exactRecordCursorAndNoReplay':True,'synthetic':True,'hardwareAccess':False}))
