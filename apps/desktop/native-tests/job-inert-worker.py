"""INERT TEST ADAPTER. No transport, Bluetooth, keys or helper execution.

This test-only stdio wrapper runs actual RuntimeService/retained loader/executor
against the project's synthetic framed peer. Connect metadata is explicitly
synthetic, not a device initialization. Never package this adapter.
"""
import json
import time
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(root/'packages/joy-runtime/runtime'))
sys.path.insert(0,str(root/'packages/joy-runtime/tests'))
import worker
from test_worker_job_api import WorkerJobTests
owner,session=WorkerJobTests().owner()
def forbidden(*args,**kwargs):
    raise AssertionError('INERT adapter must never open any transport')
owner._transport_factory=forbidden
# Explicit test-only ACK barrier. No automatic pause: compiled main must request it.
if len(sys.argv)>2:
    assert sys.argv[2]=='--hold-first-data' and len(sys.argv)==3
    receipt=Path(sys.argv[1]);assert receipt.is_absolute()
    entered=Path(str(receipt)+'.ack-entered');release=Path(str(receipt)+'.release-ack')
    old_receive=session.channel.receive;old_sleep=owner._loading_sleep;first=[True]
    def receive(timeout,*,require_encrypted):
        if session.channel.sent[-1][2]==0x43 and first[0]:
            first[0]=False;entered.write_text('SYNTHETIC ACK barrier\n')
            end=time.monotonic()+min(timeout,1.)
            while not release.exists():
                if time.monotonic()>=end:raise TimeoutError('Inert ACK barrier not released')
                time.sleep(.002)
        return old_receive(timeout,require_encrypted=require_encrypted)
    def sleep(dt):old_sleep(dt);time.sleep(min(dt,.01))
    session.channel.receive=receive;owner._loading_sleep=sleep

class Adapter:
    def handle(self,request):
        if request.get('op')=='connect':
            return {'state':'ready','machine':'cricut_joy','firmwareSelector':8.164000001,
                    'materialRecord':12,'fallbackUsed':False,'status':{
                        'status_byte_1':104,'status_byte_2':1,'extra_u16_raw':0,
                        'extra_u16_native':0,'value_be32':0}}
        if request.get('op')not in('probe','configuration','job','disconnect'):
            raise ValueError('Only explicit inert protocol operations accepted')
        return owner.handle(request)
    def close(self):
        owner.close()
        if len(sys.argv)>1:
            target=Path(sys.argv[1]);assert target.is_absolute()
            target.write_text(json.dumps({'synthetic':True,'transportsOpened':0,
                'calibrationOrSecretsRead':False,'packets':[b.hex()for b in session.channel.sent],
                'sessionClosed':session.state=='closed'},indent=2)+'\n')
worker.serve(sys.stdin,sys.stdout,Adapter())
