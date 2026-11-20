"""Source-derived request vectors and SYNTHETIC EE replies; never sends."""
import importlib,importlib.util,sys,struct,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
class MatCodecTests(unittest.TestCase):
 def codec(self):
  self.assertIsNotNone(importlib.util.find_spec('joy_mat_codec'),'mat codec is not implemented')
  return importlib.import_module('joy_mat_codec')
 def test_long_mat_uses_fixed_joy_width_and_big_endian_dimensions(self):
  self.assertEqual(self.codec().dimensions(12),bytes.fromhex('001211004099999a414000000000000000000000'))
 def test_short_mat_encodes_six_point_five(self):
  self.assertEqual(self.codec().dimensions(6.5),bytes.fromhex('001211004099999a40d000000000000000000000'))
 def test_unknown_mat_size_is_rejected(self):
  c=self.codec()
  for h in [0,7,True,float('nan')]:
   with self.assertRaises(ValueError):c.dimensions(h)
 def test_start_and_progress_measurement_have_distinct_limits(self):
  c=self.codec();self.assertEqual(c.measurement_request(12),bytes.fromhex('0005ee41400000'));self.assertEqual(c.measurement_request(0),bytes.fromhex('0005ee00000000'))
 def test_invalid_measurement_requests_are_not_serialized(self):
  c=self.codec()
  for limit in [-1,13,True,float('nan'),float('inf'),10**1000]:
   with self.assertRaises(ValueError):c.measurement_request(limit)
 def test_busy_and_complete_replies_are_distinct(self):
  c=self.codec()
  self.assertEqual(c.parse_measurement(bytes.fromhex('ee0141400000')),(True,12.0))
  self.assertEqual(c.parse_measurement(bytes.fromhex('ee0041400000')),(False,12.0))
 def test_generic_ack_is_not_measurement(self):
  with self.assertRaises(ValueError):self.codec().parse_measurement(bytes.fromhex('00ee0501ff'))
 def test_device_error_is_not_a_large_successful_measurement(self):
  with self.assertRaises(ValueError):self.codec().parse_measurement(bytes.fromhex('01ee0509ff'))
 def test_invalid_reply_shape_flags_and_values_are_rejected(self):
  c=self.codec()
  for p in [b'',bytes.fromhex('ee00414000'),bytes.fromhex('ef0041400000'),bytes.fromhex('ee0241400000'),bytes.fromhex('ee004140000000'),b'\xee\x00'+struct.pack('>f',float('nan')),b'\xee\x00'+struct.pack('>f',-1),b'\xee\x00'+struct.pack('>f',25)]:
   with self.assertRaises(ValueError):c.parse_measurement(p)
if __name__=='__main__':unittest.main()
