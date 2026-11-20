"""Real retained composition with inert peer; never actual device traffic."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
import test_joy_retained_composition as fixtures

class RetainedDiagnosticTests(unittest.TestCase):
    def test_real_recorder_captures_framed_alignment_and_cleanup_without_gaps(self):
        import importlib
        diagnostic=importlib.import_module('joy_loading_diagnostics')
        f=fixtures.CompositionTests();s,c,loader=f.setup_peer();d=diagnostic.LoadingDiagnostics(1,clock=c)
        with loader.loaded_scope(**f.opts(c,on_diagnostic=diagnostic.on_diagnostic(d))):pass
        snapshot=d.snapshot()
        self.assertFalse(snapshot['captureIncomplete'])
        captured=[e['txHex'] for e in snapshot['events'] if e['kind'] in ('exchange','cleanup') and e['txHex'] is not None]
        self.assertEqual(captured,[p.hex() for p in s.channel.sent])
        self.assertTrue(any(e['stage']=='positioning' and e['txHex'] and bytes.fromhex(e['txHex'])[2]==0x42 for e in snapshot['events']))

    def test_alignment_and_ready_wait_are_observed_without_wire_changes(self):
        f=fixtures.CompositionTests();a,ca,la=f.setup_peer();seen=[]
        def observe(stage,tx=None,rx=None,error=None,**meta):seen.append((stage,tx,rx,error,meta))
        with la.loaded_scope(**f.opts(ca,on_diagnostic=observe)):pass
        self.assertTrue(any(e[0]=='positioning' and e[1] and e[1][2]==0x42 for e in seen))
        self.assertTrue(any(e[0]=='waiting_for_go' and e[1] and e[1][2]==0x60 for e in seen))
        b,cb,lb=f.setup_peer()
        with lb.loaded_scope(**f.opts(cb)):pass
        self.assertEqual(a.channel.sent,b.channel.sent)
    def test_ready_wait_failure_observed_before_cleanup(self):
        f=fixtures.CompositionTests();s,c,loader=f.setup_peer();seen=[]
        def observe(stage,tx=None,rx=None,error=None,**meta):seen.append((stage,tx,rx,error,meta,tuple(s.channel.sent)))
        def go(timeout):raise OSError('DO_NOT_EXPORT_EXCEPTION_TEXT')
        with self.assertRaises(OSError):
            with loader.loaded_scope(**f.opts(c,host_go=go,on_diagnostic=observe)):pass
        failures=[e for e in seen if e[4].get('kind')=='failure' and e[0]=='waiting_for_go']
        self.assertTrue(failures)
        self.assertFalse(any(p[2:]==b'\x68\xff' for p in failures[0][5]))
        self.assertTrue(any(p[2:]==b'\x68\xff' for p in s.channel.sent))
if __name__=='__main__':unittest.main()
