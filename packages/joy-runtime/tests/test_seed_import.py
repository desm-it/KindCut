"""Synthetic Mach-O fixtures contain no real seed/key material."""
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from seed_import import _arm64_slice,_read_virtual,_extract_seed,read_seed_prefix


def image(cpu=0x100000c):
    raw=bytearray(256)
    struct.pack_into('<8I',raw,0,0xfeedfacf,cpu,0,2,1,72,0,0)
    struct.pack_into('<II16sQQQQIIII',raw,32,0x19,72,b'__TEXT',0x1000,256,0,256,7,5,0,0)
    raw[128:160]=bytes(range(32))
    struct.pack_into('<I',raw,200,0x52800008|(99<<5))
    return bytes(raw)

def fat(*slices):
    raw=bytearray(4096*(len(slices)+1))
    struct.pack_into('>II',raw,0,0xcafebabe,len(slices))
    for i,blob in enumerate(slices):
        offset=4096*(i+1);cpu=struct.unpack_from('<I',blob,4)[0]
        struct.pack_into('>IIIII',raw,8+i*20,cpu,0,offset,len(blob),12)
        raw[offset:offset+len(blob)]=blob
    return bytes(raw)

class SeedImportTests(unittest.TestCase):
    def test_thin_arm64_selection(self):self.assertEqual(_arm64_slice(image()),image())
    def test_universal_selects_arm64_not_x86(self):self.assertEqual(_arm64_slice(fat(image(0x1000007),image())),image())
    def test_ambiguous_arm64_rejected(self):
        with self.assertRaises(ValueError):_arm64_slice(fat(image(),image()))
    def test_truncated_or_wrong_arch_rejected(self):
        for raw in [b'',image()[:20],image(0x1000007),fat(image())[:100]]:
            with self.subTest(size=len(raw)),self.assertRaises(ValueError):_arm64_slice(raw)
    def test_virtual_mapping(self):self.assertEqual(_read_virtual(image(),0x1080,32),bytes(range(32)))
    def test_unmapped_or_overrunning_range_rejected(self):
        with self.assertRaises(ValueError):_read_virtual(image(),0x10f0,32)
        raw=bytearray(image());struct.pack_into('<I',raw,36,4)
        with self.assertRaises(ValueError):_read_virtual(bytes(raw),0x1080,32)
    def test_extracts_data_plus_mov_immediate_without_hardcoded_seed(self):
        self.assertEqual(_extract_seed(image(),0x1080,0x10c8),bytes(range(32))+b'c')
    def test_rejects_wrong_instruction(self):
        raw=bytearray(image());raw[200:204]=bytes(4)
        with self.assertRaises(ValueError):_extract_seed(bytes(raw),0x1080,0x10c8)
    def test_public_import_rejects_unpinned_build(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as folder:
            p=Path(folder)/'helper';p.write_bytes(image())
            with self.assertRaises(ValueError):read_seed_prefix(p)

if __name__=='__main__':unittest.main()
