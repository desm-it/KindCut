"""Metadata-only worker tests: no session, transport or device is created."""
import importlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
Task=importlib.import_module('joy_loading_task').JoyLoadingTask
Diagnostics=importlib.import_module('joy_loading_diagnostics').LoadingDiagnostics

class WorkerDiagnosticSnapshotTests(unittest.TestCase):
    def test_cleanup_diagnostic_failure_cannot_be_reported_as_completed(self):
        from contextlib import contextmanager
        import threading
        owner=SimpleNamespace(session=object(),_operation_lock=threading.Lock())
        owner._operation_lock.acquire()
        @contextmanager
        def scope(**kwargs):
            yield
            kwargs['on_diagnostic']('closing',error=OSError('NEVER_EXPORT_TEXT'),kind='cleanup',code='close_failed')
            owner.session=None
        owner._retained_load_owned=scope;owner._close_owned=lambda:None
        task=Task(owner);task._sequence=1;task._diagnostics=Diagnostics(1)
        task._state=task._snapshot('loading_and_aligning',active=True,retired=False)
        task._run(12,30)
        result=task.handle({'action':'status'})
        self.assertEqual(result['phase'],'failed')
        self.assertEqual(result['diagnostics']['failure']['code'],'close_failed')

    def test_entry_failure_records_fallback_close_and_keeps_primary_error(self):
        from contextlib import contextmanager
        import threading
        for close_fails in (False,True):
            owner=SimpleNamespace(session=object(),_operation_lock=threading.Lock())
            owner._operation_lock.acquire()
            @contextmanager
            def broken(**kwargs):
                raise ValueError('DO_NOT_SERIALIZE_ENTRY_TEXT')
                yield
            def close():
                if close_fails:raise OSError('DO_NOT_SERIALIZE_CLOSE_TEXT')
                owner.session=None
            owner._retained_load_owned=broken;owner._close_owned=close
            task=Task(owner);task._sequence=1;task._diagnostics=Diagnostics(1)
            task._state=task._snapshot('loading_and_aligning',active=True,retired=False)
            task._run(12,30)
            result=task.handle({'action':'status'});d=result['diagnostics']
            self.assertEqual(d['failure']['errorType'],'ValueError')
            self.assertTrue(any(e['kind']=='cleanup' and e['code']==('close_failed' if close_fails else 'close_returned') for e in d['events']))
            self.assertNotIn('DO_NOT_SERIALIZE',repr(d))

    def test_status_refreshes_diagnostics_between_phase_transitions_and_returns_detached_data(self):
        task=Task(SimpleNamespace());task._sequence=1;task._diagnostics=Diagnostics(1)
        task._state=task._snapshot('waiting_for_mat',active=True,retired=False)
        first=task.handle({'action':'status'});task._diagnostics.stage('query_precheck')
        second=task.handle({'action':'status'})
        self.assertGreater(second['diagnostics']['totalEvents'],first['diagnostics']['totalEvents'])
        second['diagnostics']['events'][0]['stage']='caller_mutation'
        self.assertNotIn('caller_mutation',repr(task.handle({'action':'status'})))
    def test_raw_exchange_adapter_passes_start_time_and_metadata_without_becoming_an_io_owner(self):
        seen=[]
        class Observer:
            def exchange(self,*args,**kwargs):seen.append((args,kwargs))
        task=Task(SimpleNamespace());task._diagnostics=Observer()
        task._diagnostic_exchange('positioning',b'\x00\x04!\x00\x00\x00',b'\x00\x05\x00!\x00\x00\x00',started=10.0,kind='exchange')
        self.assertEqual(seen[0][1]['started'],10.0)
        self.assertEqual(seen[0][1]['kind'],'exchange')
if __name__=='__main__':unittest.main()
