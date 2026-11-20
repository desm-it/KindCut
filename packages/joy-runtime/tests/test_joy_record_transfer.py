"""Source-derived synthetic intermediate records; no physical-state labels/I/O."""
import importlib
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
class RecordTransferTests(unittest.TestCase):
    def module(self):return importlib.import_module('joy_record_transfer')
    def fields(self,points):return [(p.kind_bits,p.x_internal,p.y_internal) for p in points]

    def test_linear_records_keep_coordinates_and_append_trailing_kind2(self):
        m=self.module();r=[m.ParserRecord(2,10,20),m.ParserRecord(0,-30,40)]
        self.assertEqual(self.fields(m.transfer_records(r,options_word=0)),[(2,10,20),(0,-30,40),(2,-30,40)])
        self.assertEqual(len(r),2)

    def test_three_kind1_inputs_expand_to_four_including_prior_coordinate(self):
        m=self.module();r=[m.ParserRecord(2,10,20),m.ParserRecord(1,11,21),m.ParserRecord(1,12,22),m.ParserRecord(1,13,23)]
        self.assertEqual(self.fields(m.transfer_records(r,options_word=0)),
            [(2,10,20),(1,10,20),(1,11,21),(1,12,22),(1,13,23),(2,13,23)])

    def test_multiple_groups_advance_state_and_preserve_order(self):
        m=self.module();r=[m.ParserRecord(2,1,2)]+[m.ParserRecord(1,x,x+1) for x in (3,5,7,9,11,13)]
        self.assertEqual(self.fields(m.transfer_records(r,options_word=0)),
            [(2,1,2),(1,1,2),(1,3,4),(1,5,6),(1,7,8),(1,7,8),(1,9,10),(1,11,12),(1,13,14),(2,13,14)])

    def test_options4_and5_duplicate_current_kind2_pair_not_previous(self):
        m=self.module();r=[m.ParserRecord(2,10,20),m.ParserRecord(0,30,40),m.ParserRecord(2,50,60)]
        for option in (4,5):
            self.assertEqual(self.fields(m.transfer_records(r,options_word=option)),
                [(2,10,20),(0,10,20),(0,30,40),(2,50,60),(0,50,60),(2,50,60)])
        for option in (0,1,2,3,6,7,0x104,0xffffffff):
            self.assertEqual(len(m.transfer_records(r,options_word=option)),4)

    def test_rejects_unsupported9_bad_groups_and_missing_start_instead_of_native_unchecked_reads(self):
        m=self.module();p=m.ParserRecord
        for r in ([],[p(0,1,1)],[p(1,1,1)],[p(2,0,0),p(9,1,1)],
                  [p(2,0,0),p(1,1,1)],[p(2,0,0),p(1,1,1),p(1,2,2)],
                  [p(2,0,0),p(1,1,1),p(0,2,2),p(1,3,3)]):
            with self.assertRaises(ValueError):m.transfer_records(r,options_word=0)

    def test_plain_bounded_exact_records_and_word_types(self):
        m=self.module();p=m.ParserRecord(2,0,0)
        for r in (None,'bad',iter([p]),[None],[m.ParserRecord(True,0,0)]):
            with self.assertRaises(ValueError):m.transfer_records(r,options_word=0)
        for option in (True,-1,2**32,0.0,None):
            with self.assertRaises(ValueError):m.transfer_records([p],options_word=option)
        for limit in (True,0,-1,100001,1.0,None):
            with self.assertRaises(ValueError):m.transfer_records([p],options_word=0,max_records=limit)
        with self.assertRaises(ValueError):m.transfer_records([p,p],options_word=0,max_records=1)
        self.assertEqual(len(m.transfer_records((p,p),options_word=0,max_records=2)),3)

    def test_finite_binary64_fields_preserved_until_separate_wire_admission(self):
        m=self.module()
        for value in (True,None,'1',float('nan'),float('inf'),10**1000):
            for r in ([m.ParserRecord(2,value,0)],[m.ParserRecord(2,0,value)]):
                with self.assertRaises(ValueError):m.transfer_records(r,options_word=0)
        out=m.transfer_records([m.ParserRecord(2,1e300,-0.0)],options_word=0)
        self.assertEqual(out[0].x_internal,1e300)
        with self.assertRaises(ValueError):importlib.import_module('joy_point_adapter').batch_body_from_internal(out)

    def test_composes_with_internal_adapter_once_without_implicit_frame_or_job(self):
        m=self.module();r=[m.ParserRecord(2,288,18),m.ParserRecord(0,72,144)]
        data=importlib.import_module('joy_point_adapter').batch_body_from_internal(m.transfer_records(r,options_word=0))
        self.assertEqual(data,bytes.fromhex('4302000080400000803e000000803f00000040020000803f00000040'))

    def test_worker_does_not_import_transfer_or_expose_jobs(self):
        source=(Path(__file__).resolve().parents[1]/'runtime'/'worker.py').read_text()
        self.assertNotIn('joy_record_transfer',source)
if __name__=='__main__':unittest.main()
