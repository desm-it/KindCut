"""Scripted encrypted-channel peer only. No Bluetooth or real initialization."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from joy_calibration_capture import capture_pressure_table
from joy_protocol import clear_frame

class Peer:
    def __init__(self,bad=False):self.sent=[];self.bad=bad;self.closed=False
    def close(self):self.closed=True
    def send(self,packet,**kw):
        assert kw['encrypted'] is True
        self.sent.append(packet)
    def receive(self,timeout,**kw):
        assert kw['require_encrypted'] is True
        n=len(self.sent)
        return clear_frame(bytes.fromhex(f'a0{(99 if self.bad else n):04x}00000000{n:04x}{n*10:04x}'))

def session(peer):return SimpleNamespace(state='ready',result=SimpleNamespace(selector=8.164000001,used_fallback=False),channel=peer,close=peer.close)

class CalibrationCaptureTests(unittest.TestCase):
    def test_only_sixteen_correlated_encrypted_a0_reads(self):
        peer=Peer();result=capture_pressure_table(session(peer))
        self.assertEqual(peer.sent,[clear_frame(bytes.fromhex(f'a0{n:04x}'))for n in range(1,17)])
        self.assertEqual(len(result['pressureResponsesHex']),16)
        self.assertFalse(result['physicalCalibrationVerified'])
    def test_invalid_first_reply_sends_nothing_further(self):
        peer=Peer(True)
        with self.assertRaises(ValueError):capture_pressure_table(session(peer))
        self.assertEqual(len(peer.sent),1)
        self.assertTrue(peer.closed)
    def test_exact_session_and_timeout_guard_before_io(self):
        for value in [True,0,17,float('nan')]:
            peer=Peer()
            with self.assertRaises(ValueError):capture_pressure_table(session(peer),timeout=value)
            self.assertFalse(peer.sent)
        peer=Peer();s=session(peer);s.result.used_fallback=True
        with self.assertRaises(RuntimeError):capture_pressure_table(s)
        self.assertFalse(peer.sent)
