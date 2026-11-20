"""Source-bound EE phase regressions; generated/inert, not Joy progress captures."""
import importlib
import struct
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
m=importlib.import_module('joy_measurement_experiment')
codec=importlib.import_module('joy_mat_codec')
protocol=importlib.import_module('joy_protocol')
class EEReplyConsumerRegressionTests(unittest.TestCase):
    def test_query_raw_state_byte_is_not_an_invented_busy_enum(self):
        for state in (0,1,0x79,0xee,0xff):
            error,length=m._parse_query(bytes([0,state])+struct.pack('>f',1.5))
            self.assertFalse(error);self.assertEqual(length,1.5)
    def test_native_padding_is_transcribed_not_replaced_with_synthetic_busy_data(self):
        error,length=m._parse_query(bytes.fromhex('00ee8501ff'))
        self.assertFalse(error);self.assertEqual(struct.pack('>f',length).hex(),'8501ff00')
    def test_start_ignores_opaque_details_but_does_not_accept_error_or_wrong_ack_tag(self):
        for detail in range(256):self.assertTrue(m._valid_start_reply(bytes([0,0xee,0x85,1,detail])))
        self.assertFalse(m._valid_start_reply(bytes.fromhex('0011850190')))
        self.assertFalse(m._valid_start_reply(bytes.fromhex('01ee0501903500')))
    def test_query_full_float_trailing_status_and_fail_closed_host_limits(self):
        error,length=m._parse_query(b'\x00\xee'+struct.pack('>f',2.5)+b'\x00\x00\x00')
        self.assertFalse(error);self.assertEqual(length,2.5)
        for payload in [b'',b'\x00\x11\x85\x01\xff',b'\x01\x00'+struct.pack('>f',3),b'\x00\x00'+struct.pack('>f',float('nan')),b'\x00\x00'+struct.pack('>f',25),b'\x00\x00'+struct.pack('>f',-1)]:
            with self.subTest(payload=payload.hex()),self.assertRaises(ValueError):m._parse_query(payload)
    def test_actual_worker_does_not_abort_for_a_non_boolean_query_state(self):
        import test_worker_loading_api as fixtures
        f=fixtures.LoadingApiTests();owner,session=f.owner();original=session.channel.receive
        def receive(timeout,*,require_encrypted):
            raw=original(timeout,require_encrypted=require_encrypted)
            if session.channel.sent[-1]==codec.measurement_request(0):
                payload=bytearray(raw[2:]);payload[1]=0xee;return protocol.clear_frame(bytes(payload))
            return raw
        session.channel.receive=receive
        try:
            f.start(owner);deadline=time.monotonic()+2;state=None
            while time.monotonic()<deadline:
                state=owner.handle({'op':'loading','action':'status'})
                if not state['active']or state['phase']=='waiting_for_go':break
                time.sleep(.005)
            assert state is not None
            self.assertEqual(state['phase'],'waiting_for_go')
            self.assertFalse(state['jobStarted'])
        finally:owner.close()
if __name__=='__main__':unittest.main()
