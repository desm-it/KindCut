"""Explicitly gated macOS RFCOMM subprocess adapter.

No process or Bluetooth access in the constructor. Host IPC deadlines add
250ms scheduling grace to native read/write deadlines. Expiry discards the
connection; a timed-out write may have partially completed and is NOT retried.
"""
import base64
import json
import math
import os
from pathlib import Path
import queue
import select
import subprocess
import threading
import time

MAX_BYTES=512*1024  # Base64 plus JSON remains below the 1MiB IPC-line cap.
MAX_LINE=1024*1024

class BluetoothTransport:
    def __init__(self,address,*,allow_hardware=False,helper_path=None):
        self.address=address
        self.allow_hardware=allow_hardware
        self.helper_path=str(helper_path or Path(__file__).with_name('joy_rfcomm'))
        self._proc=None
        self._reader=None
        self._responses=None
        self._lock=threading.RLock()
        self._state_lock=threading.Lock()

    def open(self):
        if self.allow_hardware is not True:
            raise PermissionError('Bluetooth requires explicit allow_hardware=True')
        with self._lock:
            if self._proc is not None:
                raise RuntimeError('Transport already open')
            proc=subprocess.Popen([self.helper_path,'--allow-hardware'],stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE,text=True,bufsize=1)
            if proc.stdin is not None:os.set_blocking(proc.stdin.fileno(),False)
            responses=queue.Queue()
            def receive_lines():
                try:
                    if proc.stdout is None:return
                    while True:
                        line=proc.stdout.readline(MAX_LINE+1)
                        if not line:
                            responses.put(ConnectionError('Native helper closed'))
                            return
                        if len(line)>MAX_LINE:
                            responses.put(ValueError('Native helper response too large'))
                            return
                        responses.put(line)
                except Exception:
                    responses.put(ConnectionError('Native helper pipe failed'))
            reader=threading.Thread(target=receive_lines,daemon=True)
            with self._state_lock:
                self._proc=proc;self._reader=reader;self._responses=responses
            reader.start()
            self._request({'op':'open','address':self.address},10)

    def _abort(self):
        with self._state_lock:
            proc,reader=self._proc,self._reader
            self._proc=None;self._reader=None;self._responses=None
        if proc is None:return
        if proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=.5)
            except subprocess.TimeoutExpired:
                proc.kill();proc.wait(timeout=2)
        if reader is not None and reader is not threading.current_thread():reader.join(timeout=.5)
        for pipe in [proc.stdin,proc.stdout]:
            if pipe is not None:
                try:pipe.close()
                except OSError:pass

    def _request(self,obj,timeout):
        with self._lock:
            proc,responses=self._proc,self._responses
            if proc is None or responses is None or proc.poll() is not None:
                self._abort()
                raise ConnectionError('Native helper is not running')
            try:
                if proc.stdin is None:raise ConnectionError('Native helper stdin unavailable')
                deadline=time.monotonic()+timeout+.25
                data=memoryview((json.dumps(obj,separators=(',',':'),allow_nan=False)+'\n').encode('utf-8'))
                fd=proc.stdin.fileno()
                while data:
                    remaining=deadline-time.monotonic()
                    if remaining<=0 or not select.select([],[fd],[],remaining)[1]:
                        raise queue.Empty
                    try:data=data[os.write(fd,data):]
                    except BlockingIOError:continue
                result=responses.get(timeout=max(0,deadline-time.monotonic()))
                if isinstance(result,Exception):raise result
                reply=json.loads(result)
                if not isinstance(reply,dict) or not isinstance(reply.get('ok'),bool):
                    raise ValueError('Malformed native response')
                if not reply['ok']:raise OSError('Native Bluetooth operation failed')
                return reply
            except queue.Empty:
                self._abort()
                raise TimeoutError('Native helper deadline exceeded; session discarded') from None
            except BaseException:
                self._abort()
                raise

    @staticmethod
    def _timeout(value):
        value=float(value)
        if not math.isfinite(value) or not 0<=value<=120:
            raise ValueError('Timeout must be finite and within 0..120 seconds')
        return value

    def read(self,max_bytes,timeout):
        timeout=self._timeout(timeout)
        if not isinstance(max_bytes,int) or not 0<max_bytes<=MAX_BYTES:
            raise ValueError('Read size must be within 1..524288')
        reply=self._request({'op':'read','max_bytes':max_bytes,'timeout':timeout},timeout)
        try:
            data=base64.b64decode(reply['data'],validate=True)
            if len(data)>max_bytes:raise ValueError('Read response exceeds requested size')
            return data
        except (KeyError,ValueError,TypeError):
            self._abort()
            raise ValueError('Invalid native read response') from None

    def write(self,data,timeout):
        timeout=self._timeout(timeout)
        data=bytes(data)
        if len(data)>MAX_BYTES:raise ValueError('Write too large')
        reply=self._request({'op':'write','data':base64.b64encode(data).decode('ascii'),
                             'timeout':timeout},timeout)
        count=reply.get('written')
        if not isinstance(count,int) or count!=len(data):
            self._abort()
            raise ValueError('Incomplete or invalid write count; session discarded')
        return count

    def close(self):
        if self._lock.acquire(blocking=False):
            try:
                if self._proc is not None:
                    try:self._request({'op':'close'},.25)
                    except Exception:pass
            finally:
                self._abort();self._lock.release()
        else:
            # A pending request owns the lock: terminate to cancel it.
            self._abort()
