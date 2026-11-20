"""Produce explicitly SYNTHETIC traces via real SDK/worker + inert peer only.

No discovery/connection/provisioning/transport factory or vendor code is called.
Run with packages/joy-runtime/.venv/bin/python. Output is an offline test fixture,
never real Joy traffic and never proof of physical loading.
"""
import importlib
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/joy-runtime/runtime'),str(ROOT/'packages/joy-runtime/tests')]
fixture=importlib.import_module('test_worker_loading_api')
protocol=importlib.import_module('joy_protocol')
measurement=importlib.import_module('joy_mat_codec')
QUERY=measurement.measurement_request(0)

def produce_case(name):
    f=fixture.LoadingApiTests();service,session=f.owner()
    original=session.channel.receive
    def receive(timeout,*,require_encrypted):
        packet=session.channel.sent[-1]
        if packet==QUERY:
            return b'\x00\x09bad' if name=='malformed_frame_after_grip' else protocol.clear_frame(b'bad')
        return original(timeout,require_encrypted=require_encrypted)
    session.channel.receive=receive
    try:
        started=f.start(service);terminal=f.wait(service)
        assert terminal['phase']=='failed' and terminal['sessionRetired']
        assert service.session is None and session.state=='closed'
        assert terminal['diagnostics']['failure']['stage']=='query_precheck'
        assert not terminal['diagnostics']['captureIncomplete']
        events=terminal['diagnostics']['events']
        expected=[p.hex() for p in session.channel.sent]
        captured=[e['txHex'] for e in events if e['kind'] in ('exchange','cleanup') and e['txHex'] is not None]
        assert captured==expected,(captured,expected)
        assert any(e['rxHex']==(b'\x00\x09bad' if name=='malformed_frame_after_grip' else protocol.clear_frame(b'bad')).hex() for e in events)
        assert any(e['kind']=='cleanup' and e['code']=='close_returned' for e in events)
        if name=='semantic_query_failure_after_grip':
            assert expected[-2:]==[protocol.clear_frame(b'\x68\xff').hex(),protocol.clear_frame(b'\xed\x01').hex()]
        else:
            assert not any(p[2:] in (b'\x68\xff',b'\xed\x01') for p in session.channel.sent)
        assert not any(p[2] in (0x21,0x42,0x22) for p in session.channel.sent)
        return{'name':name,'synthetic':True,'states':[started,terminal],'expectedSentHex':expected}
    finally:service.close()

if __name__=='__main__':
    result={'synthetic':True,'notice':'INERT SCRIPTED PEER — NOT DEVICE TRAFFIC','cases':[produce_case(n) for n in ['semantic_query_failure_after_grip','malformed_frame_after_grip']]}
    if len(sys.argv)==2:
        out=Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':True,'synthetic':True,'cases':len(result['cases']),'transportsOpened':0,'calibrationOrSecretsRead':False}))
