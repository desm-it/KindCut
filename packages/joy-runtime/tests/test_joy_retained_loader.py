import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
from joy_retained_loader import JoyRetainedLoader
class Session:
    def __init__(self): self.calls=[]
class LoaderTests(unittest.TestCase):
    def test_construction_has_no_io_and_requires_exclusive_precondition(self):
        s=Session()
        with self.assertRaises(PermissionError): JoyRetainedLoader(s,exclusive_session=False)
        loader=JoyRetainedLoader(s,exclusive_session=True)
        self.assertEqual(s.calls,[])
    def test_rejects_concurrent_reentry_before_touching_session(self):
        s=Session(); loader=JoyRetainedLoader(s,exclusive_session=True)
        loader._lock.acquire(); loader._active=True
        with self.assertRaises(RuntimeError): loader.run(height_inches=6.5,host_go=lambda t:False,
            material_present=lambda:True,motion_approved=True,blade_removed_confirmed=True,
            point_mode='scalar')
        self.assertEqual(s.calls,[])
        loader._active=False; loader._lock.release()
if __name__=='__main__': unittest.main()
