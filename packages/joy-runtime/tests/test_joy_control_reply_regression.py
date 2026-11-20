"""Pass92 actual dimensions reply + inert downstream peers. No device I/O.

The accepted-envelope hypothesis must be bound to native evidence before the
validator is changed. Captured bytes are never regenerated from the port.
"""
import importlib
import json
import sys
import time
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/joy-runtime/runtime'))
measurement=importlib.import_module('joy_measurement_experiment')
exchange=json.loads((Path(__file__).parent/'fixtures/pass92-dimensions.json').read_text())
CAPTURED_REQUEST=bytes.fromhex(exchange['txHex'])
CAPTURED_REPLY=bytes.fromhex(exchange['rxHex'])

class ControlReplyRegressionTests(unittest.TestCase):
    def test_actual_pass92_dimensions_reply_is_not_rejected_for_its_opaque_detail_byte(self):
        self.assertEqual(CAPTURED_REPLY.hex(),'00050011050190')
        try:
            accepted=measurement._validate_control_reply(0x11,CAPTURED_REQUEST[2:],CAPTURED_REPLY[2:])
        except ValueError:
            self.fail('Captured pass92 positive envelope was rejected for an unproven detail-byte constant')
        self.assertTrue(accepted)

    def test_opaque_details_are_not_a_whitelist_for_90_or_ff(self):
        for opcode in (0x11,0x79,0xed,0x30,0x31,0x3e):
            for detail in range(256):
                self.assertTrue(measurement._validate_control_reply(opcode,b'',bytes([0,opcode,detail,detail^0xff,detail])))

    def test_all_bound_loading_controls_allow_opaque_details_in_the_real_worker(self):
        # Only 0x11/90 is captured; all OTHER replies here are synthetic variations.
        import test_worker_loading_api as fixture
        f=fixture.LoadingApiTests();owner,session=f.owner();original=session.channel.receive
        def receive(timeout,*,require_encrypted):
            packet=session.channel.sent[-1]
            if packet[2] in (0x11,0x79,0xed,0x30,0x31,0x3e):
                body=bytes([0,packet[2],5,1,0x90]);return len(body).to_bytes(2,'big')+body
            return original(timeout,require_encrypted=require_encrypted)
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

    def test_wrong_opcode_explicit_error_and_bad_lengths_still_fail(self):
        for payload in [bytes.fromhex(x)for x in ['0079050190','01110501903500','00110501','001105019000','0211050190','']]:
            with self.subTest(payload=payload.hex()),self.assertRaises(ValueError):
                measurement._validate_control_reply(0x11,CAPTURED_REQUEST[2:],payload)

    def test_real_worker_advances_past_captured_dimensions_reply_with_inert_following_replies(self):
        import test_worker_loading_api as fixture
        f=fixture.LoadingApiTests();owner,session=f.owner();original=session.channel.receive
        def receive(timeout,*,require_encrypted):
            if session.channel.sent[-1]==CAPTURED_REQUEST:return CAPTURED_REPLY
            return original(timeout,require_encrypted=require_encrypted)
        session.channel.receive=receive
        try:
            f.start(owner);deadline=time.monotonic()+2;state=None
            while time.monotonic()<deadline:
                state=owner.handle({'op':'loading','action':'status'})
                if not state['active']or state['phase']=='waiting_for_go':break
                time.sleep(.005)
            assert state is not None, 'The inert worker returned no metadata'
            self.assertEqual(state['phase'],'waiting_for_go')
            self.assertTrue(any(p[2:]==b'\xed\x02' for p in session.channel.sent))
            self.assertFalse(state['jobStarted'])
        finally:owner.close()
if __name__=='__main__':unittest.main()
