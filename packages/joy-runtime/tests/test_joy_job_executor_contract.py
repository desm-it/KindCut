"""Source-consumer regressions against the real sender; all peers SYNTHETIC."""
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import struct
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_joy_job_program import inputs
from joy_job_program import compile_job_program
from joy_job_executor import run_job_program
from joy_measurement_experiment import BorrowerStreamState
from joy_alignment_session import OperationDeadline,OperationCancelled

class Peer:
    def __init__(self):
        self.sent=[];self.stage='';self.statuses=[];self.cap=2;self.negative=False
        self.bad_data=False;self.interface_polls=0;self.typed_config_echo=True
        self.force_drain_busy=False;self.loss=False
    def send(self,packet,*,encrypted,timeout):
        assert encrypted and timeout>0;self.sent.append(packet)
    def receive(self,timeout,*,require_encrypted):
        assert require_encrypted and timeout>0
        body=self.sent[-1][2:];op=body[0]
        if op==0x60:
            raw=self.statuses.pop(0)if self.stage=='draining'and self.statuses else 0x60
            if self.force_drain_busy and self.stage=='draining':raw=0x62
            reply=bytes([0x60,raw,0 if self.loss else 1,0,0,0,0,0,0])
        elif op==0x73:
            self.interface_polls+=1;reply=bytes([0x73,0,0,0,0,0])
        elif op==0x43:
            if self.bad_data:return b'\x00\x08\x00'
            reply=bytes([1,op,5,1,self.cap,53,0])if self.negative else bytes([0,op,5,1,self.cap])
        elif op in(0x30,0x31,0x3e)and self.typed_config_echo:
            reply=bytes([op])+bytes(len(body)-1)
        else:reply=bytes([0,op,5,1,0x90])
        return len(reply).to_bytes(2,'big')+reply

class ExecutorContractTests(unittest.TestCase):
    def fixture(self,pressures=None):
        p,s,r,recipe=inputs();program=compile_job_program(p,s,r,pressures or recipe)
        peer=Peer();guard=BorrowerStreamState();guard._bound=True
        session=SimpleNamespace(state='ready',result=SimpleNamespace(selector=8.164000001,used_fallback=False),channel=peer)
        return session,peer,guard,program
    def execute(self,s,p,g,program,**options):
        return run_job_program(session=s,program=program,borrower_stream_state=g,
            motion_approved=True,tool_confirmed=True,on_stage=lambda name:setattr(p,'stage',name),
            sleep=lambda _:None,**options)

    def test_existing_noop_control_typed_echo_is_not_poisoned(self):
        s,p,g,program=self.fixture();result=self.execute(s,p,g,program)
        self.assertEqual(result.completed_passes,1);self.assertFalse(g._invalidated)

    def test_native_busy_predicate_waits_instead_of_being_an_error(self):
        s,p,g,program=self.fixture();p.typed_config_echo=False;p.statuses=[0x62,0x62,0x60]
        result=self.execute(s,p,g,program,max_status_polls=5)
        self.assertEqual(result.completed_passes,1)
        self.assertGreaterEqual(p.interface_polls,3)

    def test_each_pressure_pass_is_drained_before_next_profile_reset(self):
        s,p,g,program=self.fixture([180,200]);p.typed_config_echo=False
        self.execute(s,p,g,program)
        ops=[b[2]for b in p.sent];resets=[i for i,x in enumerate(ops)if x==0x22]
        self.assertEqual(len(resets),3) # two profile resets, then finishing EndDraw
        data=[i for i,x in enumerate(ops)if x==0x43]
        self.assertTrue(any(ops[i]==0x73 for i in range(data[0]+1,resets[1])),
                        'Previous pass must drain before End22/profile reset for next pass')

    def test_progress_counts_are_cumulative_and_bounded(self):
        s,p,g,program=self.fixture([180,200]);p.typed_config_echo=False;events=[]
        result=self.execute(s,p,g,program,on_progress=events.append,initial_batch_limit=2)
        self.assertTrue(events);self.assertTrue(all('acceptedRecords'in e and 'completedPasses'in e for e in events))
        self.assertEqual(events[-1]['acceptedRecords'],result.accepted_records)
        self.assertEqual(events[-1]['completedPasses'],2)

    def test_valid_negative_is_not_retried_or_mislabeled_uncertain(self):
        s,p,g,program=self.fixture();p.typed_config_echo=False;p.negative=True
        with self.assertRaises(RuntimeError):self.execute(s,p,g,program)
        self.assertEqual(sum(b[2]==0x43 for b in p.sent),1);self.assertFalse(g._invalidated)

    def test_malformed_data_poisoned_no_cleanup_sent_by_borrower(self):
        s,p,g,program=self.fixture();p.typed_config_echo=False;p.bad_data=True
        with self.assertRaises(ValueError):self.execute(s,p,g,program)
        self.assertTrue(g._invalidated)
        self.assertNotIn(0x68,[b[2]for b in p.sent]);self.assertNotIn(0xed,[b[2]for b in p.sent])

    def test_drain_is_bounded_when_native_predicate_never_clears(self):
        s,p,g,program=self.fixture();p.typed_config_echo=False;p.force_drain_busy=True
        with self.assertRaises(OperationDeadline):self.execute(s,p,g,program,max_status_polls=2)
        self.assertFalse(g._invalidated)

    def test_no_status_or_data_after_denied_go_or_cancelled_admission(self):
        s,p,g,program=self.fixture()
        with self.assertRaises(OperationCancelled):self.execute(s,p,g,program,cancelled=lambda:True)
        self.assertEqual(p.sent,[])

if __name__=='__main__':unittest.main()
