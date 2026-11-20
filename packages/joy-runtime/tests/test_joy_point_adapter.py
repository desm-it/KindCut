"""Synthetic internal point fields, not SVG mapping or captured device traffic."""
import importlib
from pathlib import Path
import struct
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
class PointAdapterTests(unittest.TestCase):
    def adapter(self):return importlib.import_module('joy_point_adapter')

    def test_batch_addpoint_divides_both_internal_fields_by_72(self):
        a=self.adapter()
        self.assertEqual(a.batch_body_from_internal([a.InternalDrawPoint(2,288,18)]),
            bytes.fromhex('4302000080400000803e'))

    def test_kind_low_byte_order_and_signed_zero_are_preserved_without_axis_swap(self):
        a=self.adapter();p=[a.InternalDrawPoint(0x01020304,72,-18),a.InternalDrawPoint(0xffffffff,-0.0,144)]
        snapshot=tuple(p)
        self.assertEqual(a.batch_body_from_internal(p),b'\x43'+struct.pack('<Bff',4,1,-.25)+struct.pack('<Bff',255,-0.0,2))
        self.assertEqual(tuple(p),snapshot)

    def test_collected_batch_and_scalar_wire_coordinates_match(self):
        a=self.adapter();c=importlib.import_module('joy_draw_codec')
        for kind in (0,2,0x103,0xffffffff):
            for x,y in ((0.0,-0.0),(1.1,-99.25),(288,18),(-72,72),(1e10,-1e10)):
                self.assertEqual(a.batch_body_from_internal([a.InternalDrawPoint(kind,x,y)]),
                    b'\x43'+bytes([kind&255])+c.scalar_draw_body(kind,x,y)[5:])

    def test_input_is_not_already_native_batch_coordinate_and_is_not_scaled_twice(self):
        a=self.adapter();c=importlib.import_module('joy_draw_codec')
        self.assertEqual(a.batch_body_from_internal([a.InternalDrawPoint(2,288,18)]),
            c.batch_draw_body([c.NativeBatchPoint(2,4,.25)]))
        with self.assertRaises(ValueError):a.batch_body_from_internal([c.NativeBatchPoint(2,4,.25)])

    def test_strict_kind_and_coordinate_admission_and_no_partial_return(self):
        a=self.adapter();valid=a.InternalDrawPoint(2,72,72)
        for kind in (True,-1,2**32,2.0,'2',None):
            with self.assertRaises(ValueError):a.batch_body_from_internal([valid,a.InternalDrawPoint(kind,0,0)])
        for value in (True,'1',None,float('inf'),float('nan'),10**1000,1e300,1e-300,5e-324):
            with self.assertRaises(ValueError):a.batch_body_from_internal([valid,a.InternalDrawPoint(2,value,0)])
            with self.assertRaises(ValueError):a.batch_body_from_internal([a.InternalDrawPoint(2,0,value)])

    def test_bounded_plain_sequence_and_explicit_limit(self):
        a=self.adapter();p=a.InternalDrawPoint(2,72,72)
        for points in ([],None,'bad',iter([p]),[None],[p]*57):
            with self.assertRaises(ValueError):a.batch_body_from_internal(points)
        for limit in (True,0,-1,1025,None,1.0):
            with self.assertRaises(ValueError):a.batch_body_from_internal([p],max_points=limit)
        self.assertEqual(len(a.batch_body_from_internal([p]*56)),1+9*56)
        self.assertEqual(len(a.batch_body_from_internal(tuple([p]*57),max_points=64)),1+9*57)

    def test_worker_does_not_import_adapter_or_enable_execution(self):
        source=(Path(__file__).resolve().parents[1]/'runtime'/'worker.py').read_text()
        self.assertNotIn('joy_point_adapter',source)
if __name__=='__main__':unittest.main()
