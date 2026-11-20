import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from worker import RuntimeService,serve
from fixtures_provisioning import cached,container,record,SyntheticJoy

SEED=bytes(range(33))
BUNDLE={'format':1,'settings8':cached(container(record()),SEED),'seedPrefixBase64':base64.b64encode(SEED).decode()}

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'])
        self.cache=Path(self.tmp.name)/'cache.json';self.helper=Path(self.tmp.name)/'helper'
        self.cache.write_text(json.dumps({'settings8_raw':BUNDLE['settings8']}));self.helper.write_bytes(b'not executed')
        self.wire=SyntheticJoy();self.opened=[]
        self.wire.open=lambda:self.opened.append(True)
        self.service=RuntimeService(platform='darwin',transport_factory=lambda address:self.wire,seed_prefix=SEED)
    def tearDown(self):self.service.close();self.tmp.cleanup()
    def test_probe_is_inert(self):
        info=self.service.handle({'op':'probe'})
        self.assertIsInstance(info,dict);self.assertEqual(info['protocol'],1)
        self.assertFalse(info['hardwareAccess']);self.assertEqual(self.opened,[])
    def test_import_requires_approval(self):
        with self.assertRaises(PermissionError):self.service.handle({'op':'provision','cachePath':str(self.cache),'helperPath':str(self.helper)})
        self.assertEqual(self.opened,[])
    def test_provision_returns_validated_bundle_to_main_only(self):
        self.helper.unlink()
        result=self.service.handle({'op':'provision','importApproved':True,'sourcePath':str(self.cache)})
        self.assertIsInstance(result,dict);self.assertEqual(result['recordCount'],1)
        self.assertEqual(result['bundle'],BUNDLE);self.assertEqual(self.opened,[])
    def test_exported_bundle_import_needs_no_shared_resource_or_helper(self):
        from unittest.mock import patch
        self.cache.write_text(json.dumps(BUNDLE))
        with patch('worker._shared_seed_prefix',side_effect=AssertionError('must not access decoder resource')):
            result=RuntimeService(platform='darwin').handle({'op':'provision','importApproved':True,'sourcePath':str(self.cache)})
        self.assertEqual(result['bundle'],BUNDLE)
    def test_unrelated_cache_fields_are_not_imported(self):
        self.cache.write_text(json.dumps({'settings8_raw':BUNDLE['settings8'],'password':'SYNTHETIC-NEVER-RETURN'}))
        result=self.service.handle({'op':'provision','importApproved':True,'sourcePath':str(self.cache)})
        self.assertNotIn('SYNTHETIC-NEVER-RETURN',json.dumps(result))
    def test_connect_requires_both_explicit_approvals(self):
        for a,b in [(False,False),(True,False),(False,True),('true',True)]:
            with self.assertRaises(PermissionError):self.service.handle({'op':'connect','hardwareApproved':a,'cryptoResetApproved':b})
        self.assertEqual(self.opened,[])
    def test_invalid_bundle_fails_before_transport_open(self):
        with self.assertRaises(ValueError):self.service.handle({'op':'connect','hardwareApproved':True,'cryptoResetApproved':True,'address':'00:11:22:33:44:55','bundle':{}})
        self.assertEqual(self.opened,[])
    def test_real_session_pipeline_via_inert_transport(self):
        result=self.service.handle({'op':'connect','hardwareApproved':True,'cryptoResetApproved':True,'address':'00:11:22:33:44:55','bundle':BUNDLE})
        self.assertIsInstance(result,dict);self.assertEqual(result['state'],'ready')
        self.assertEqual(len(self.opened),1)
        serialized=json.dumps(result)
        self.assertNotIn('seedPrefixBase64',serialized);self.assertNotIn('settings8',serialized)
        status=self.service.handle({'op':'status'})
        self.assertIsInstance(status,dict);self.assertEqual(status['state'],'ready')
        self.assertEqual(self.service.handle({'op':'disconnect'}),{'state':'disconnected'})
        self.assertTrue(self.wire.closed)
    def test_bad_address_does_not_open_transport(self):
        with self.assertRaises(ValueError):self.service.handle({'op':'connect','hardwareApproved':True,'cryptoResetApproved':True,'address':'not-an-address','bundle':BUNDLE})
        self.assertEqual(self.opened,[])
    def test_non_macos_rejects_hardware(self):
        s=RuntimeService(platform='linux',transport_factory=lambda address:self.wire)
        with self.assertRaises(RuntimeError):s.handle({'op':'connect','hardwareApproved':True,'cryptoResetApproved':True})
        self.assertEqual(self.opened,[])
    def test_protocol_errors_never_echo_request_secrets(self):
        source=io.BytesIO(b'{"id":2,"op":"connect","secret":"DO-NOT-ECHO"}\nnot-json\n')
        output=io.StringIO();serve(source,output,self.service)
        lines=output.getvalue().splitlines();self.assertEqual(len(lines),2)
        self.assertFalse(json.loads(lines[0])['ok']);self.assertNotIn('DO-NOT-ECHO',output.getvalue())
    def test_eof_closes_session(self):
        output=io.StringIO();serve(io.BytesIO(b'{"id":1,"op":"probe"}\n'),output,self.service)
        self.assertTrue(output.getvalue())
        self.assertTrue(json.loads(output.getvalue())['ok'])
        self.assertTrue(self.wire.closed or self.service.session is None)

if __name__=='__main__':unittest.main()
