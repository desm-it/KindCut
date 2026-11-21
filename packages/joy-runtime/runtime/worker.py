"""KindCut-owned JSON-line worker. Secrets stay on private main-process pipes.

Inert until an explicit request. No discovery, motion, cuts, firmware updates,
Cricut login or proprietary-helper execution is implemented.
"""
import base64
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import stat
import sys
import threading
from channel import FramedChannel
from initializer import JoyInitializer
from materials import MaterialStore,decode_settings8
from device_profile import load_joy_profile
from mat_control import control_mat
from bluetooth.transport import create_transport

MAX_LINE=4*1024*1024


def _shared_seed_prefix():
    """Read the app-owned fixed decoder prefix bundled beside this worker."""
    resource=Path(__file__).with_name('decoder-prefix.bin')
    fd=os.open(resource,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size!=33:raise ValueError('Invalid decoder resource')
        seed=stream.read(34)
    if len(seed)!=33:raise ValueError('Invalid decoder resource')
    return seed


def _store(bundle):
    if not isinstance(bundle,dict) or type(bundle.get('format')) is not int or bundle['format']!=1:
        raise ValueError('Unsupported provisioning format')
    text=bundle.get('settings8');encoded=bundle.get('seedPrefixBase64')
    if not isinstance(text,str) or not 69<=len(text)<=2*1024*1024 or not isinstance(encoded,str):
        raise ValueError('Invalid provisioning envelope')
    try:
        seed=base64.b64decode(encoded,validate=True)
        if len(seed)!=33 or base64.b64encode(seed).decode()!=encoded:raise ValueError()
    except (ValueError,UnicodeError):raise ValueError('Invalid provisioning seed') from None
    return MaterialStore.from_protobuf(decode_settings8(text,seed))


def _read_provisioning(path):
    if not isinstance(path,str) or not os.path.isabs(path):raise ValueError('Expected an absolute source path')
    try:
        fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
        with os.fdopen(fd,'rb') as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size>MAX_LINE:raise ValueError()
            data=stream.read(MAX_LINE+1)
            if len(data)>MAX_LINE:raise ValueError()
        parsed=json.loads(data)
        if isinstance(parsed,dict) and type(parsed.get('format')) is int and parsed.get('format')==1:
            return {'format':1,'settings8':parsed.get('settings8'),'seedPrefixBase64':parsed.get('seedPrefixBase64')}
        if isinstance(parsed,dict):
            text=parsed.get('settings8_raw')
            if not isinstance(text,str):raise ValueError()
            return {'format':1,'settings8':text}
        raise ValueError()
    except (OSError,ValueError,UnicodeError,TypeError):raise ValueError('Provisioning source could not be read') from None


def _safe_status(status):
    return {name:status[name] for name in ['status_byte_1','status_byte_2','extra_u16_raw','extra_u16_native','value_be32']}


class RuntimeService:
    def __init__(self,*,platform=None,transport_factory=None,seed_prefix=None):
        self.platform=sys.platform if platform is None else platform
        self._transport_factory=transport_factory
        self._seed_prefix=seed_prefix
        self.session=None
        self.transport=None
        self._summary=None
        self._operation_lock=threading.Lock()
        from joy_loading_task import JoyLoadingTask
        from joy_job_task import JoyJobTask
        self._loading = JoyLoadingTask(self)
        self._job = JoyJobTask(self)

    @contextmanager
    def _operation(self):
        if not self._operation_lock.acquire(blocking=False):
            raise RuntimeError('Native Joy session operation already owned')
        try:
            yield
        finally:
            self._operation_lock.release()

    def handle(self,request):
        if type(request) is dict and request.get('op') == 'job':
            return self._job.handle(request)
        if type(request) is dict and request.get('op') == 'loading':
            return self._loading.handle(request)
        with self._operation():
            return self._handle_owned(request)

    def _handle_owned(self,request):
        if not isinstance(request,dict):raise ValueError('Invalid request')
        op=request.get('op')
        if op=='probe':
            return {'protocol':1,'machine':'cricut_joy','platform':self.platform,
                    'hardwareAccess':False,'bundledProfile':{'id':'cricut-joy','records':load_joy_profile().record_count,'experimental':True,'cutting':False},'capabilities':['provision','connect','status','mat','disconnect','loading','configuration','calibration','experimentalPenJob']}
        if op=='configuration':
            from joy_configuration_workflow import configuration_request
            return configuration_request(request)
        if op=='calibration':
            if set(request)-{'id','op','action','readApproved','timeout'} or request.get('action')!='read':raise ValueError('Invalid calibration request')
            if request.get('readApproved') is not True:raise PermissionError('Fresh calibration-read approval required')
            if self.session is None or self._summary is None or self._summary.get('firmwareSelector')!=8.164000001 or self._summary.get('fallbackUsed') is not False:raise RuntimeError('No exact initialized original Joy')
            from joy_calibration_capture import capture_pressure_table
            try:return capture_pressure_table(self.session,timeout=request.get('timeout',8))
            except Exception:self._close_owned();raise
        if op=='provision':
            if request.get('importApproved') is not True:raise PermissionError('Import approval required')
            if self.session is not None:raise RuntimeError('Disconnect before replacing provisioning')
            bundle=_read_provisioning(request.get('sourcePath'))
            if 'seedPrefixBase64' not in bundle:
                seed=self._seed_prefix if self._seed_prefix is not None else _shared_seed_prefix()
                bundle['seedPrefixBase64']=base64.b64encode(seed).decode()
            store=_store(bundle)
            # Sensitive response: consumed ONLY by main-process protected storage.
            return {'recordCount':store.record_count,'bundle':bundle}
        if op=='connect':
            if request.get('hardwareApproved') is not True or request.get('cryptoResetApproved') is not True:
                raise PermissionError('Explicit Bluetooth and crypto-reset approvals required')
            if self.platform!='darwin':raise RuntimeError('Native Joy currently supports macOS only')
            if self.session is not None:raise RuntimeError('A session is already active')
            address=request.get('address')
            if not isinstance(address,str) or re.fullmatch(r'(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}',address) is None:
                raise ValueError('Invalid Bluetooth address')
            if request.get('profileId','cricut-joy')!='cricut-joy':raise ValueError('Unsupported device profile')
            store=load_joy_profile() if request.get('bundle') is None else _store(request['bundle'])
            transport=(self._transport_factory(address) if self._transport_factory is not None else
                       create_transport(address,platform=self.platform,allow_hardware=True,helper_path=Path(__file__).parent/'bluetooth/joy_rfcomm'))
            self.transport=transport
            try:
                transport.open()
                candidate=JoyInitializer(FramedChannel(transport),store)
                self.session=candidate
                result=candidate.initialize(allow_crypto_reset=True,timeout=request.get('timeout',20))
                self._summary={'state':'ready','machine':'cricut_joy','firmwareSelector':result.selector,
                               'materialRecord':result.material_record_index,'fallbackUsed':result.used_fallback,
                               'status':_safe_status(result.status)}
                return self._summary.copy()
            except Exception:
                self._close_owned()
                raise
        if op=='mat':
            if request.get('motionApproved') is not True:raise PermissionError('Explicit roller-motion approval required')
            if self.session is None or self._summary is None:raise RuntimeError('No initialized session')
            try:
                result=control_mat(self.session,request.get('action'),motion_approved=True,timeout=request.get('timeout',8))
                self._summary={**self._summary,'status':_safe_status(result['status'])}
                return {**self._summary,'matAction':result['action'],'requestAcknowledged':result['requestAcknowledged'],'matPresenceVerified':False,**({'responseCode':result['responseCode']} if 'responseCode' in result else {})}
            except Exception:self._close_owned();raise
        if op=='status':
            previous=self._summary
            if self.session is None or previous is None:raise RuntimeError('No initialized session')
            try:
                status=self.session.query_status(timeout=request.get('timeout',2))
                self._summary={**previous,'status':_safe_status(status)}
                return self._summary.copy()
            except Exception:
                self._close_owned()
                raise
        if op=='disconnect':
            self._close_owned();return {'state':'disconnected'}
        raise ValueError('Unsupported operation')

    @contextmanager
    def retained_load_scope(self, **options):
        """Privileged, non-JSON integration; consumes the initialized session.

        The trusted caller obtains fresh approval and owns external aliases.
        Hold this service's actual operation lease throughout measurement,
        alignment, host Go, caller use and cleanup. Competing public operations
        (even same-thread callbacks) fail without touching the owned stream.
        No discovery, connection or job activation is added here.
        """
        if (options.get('motion_approved') is not True or
                options.get('blade_removed_confirmed') is not True):
            raise PermissionError('Fresh motion approval and housing removal required')
        with self._operation():
            with self._retained_load_owned(**options) as result:
                yield result

    @contextmanager
    def _retained_load_owned(self, **options):
        """Private owner path: caller already holds the actual operation lease."""
        if not self._operation_lock.locked():
            raise RuntimeError('Native Joy operation lease required')
        if self.session is None or self._summary is None:
            raise RuntimeError('No initialized session')
        from joy_retained_loader import JoyRetainedLoader
        try:
            with JoyRetainedLoader(self.session, exclusive_session=True).loaded_scope(**options) as result:
                yield result
        except BaseException as primary:
            try:
                self._close_owned()
            except BaseException as cleanup:
                raise primary from cleanup
            raise
        else:
            self._close_owned()

    def close(self):
        self._loading.shutdown()
        self._job.shutdown()
        with self._operation():
            self._close_owned()

    def _close_owned(self):
        session,transport=self.session,self.transport
        self.session=None;self.transport=None;self._summary=None
        if session is not None:session.close()
        elif transport is not None:transport.close()


def serve(source,output,service):
    try:
        while True:
            raw=source.readline(MAX_LINE+1)
            if not raw:break
            request_id=None
            try:
                if len(raw)>MAX_LINE:raise ValueError('Request too large')
                request=json.loads(raw)
                if not isinstance(request,dict) or type(request.get('id')) is not int or not 0<=request['id']<=9007199254740991:
                    raise ValueError('Invalid request id')
                request_id=request['id']
                result=service.handle(request)
                reply={'id':request_id,'ok':True,'result':result}
            except Exception as error:
                code=('APPROVAL_REQUIRED' if isinstance(error,PermissionError) else
                      'BAD_INPUT' if isinstance(error,ValueError) else 'OPERATION_FAILED')
                # Never reflect exception text, request fields, paths or key material.
                reply={'id':request_id,'ok':False,'error':{'code':code,'message':'Native Joy operation did not complete.'}}
            output.write(json.dumps(reply,separators=(',',':'),allow_nan=False)+'\n');output.flush()
            if len(raw)>MAX_LINE:break
    finally:service.close()


def main():
    service=RuntimeService()
    if sys.argv[1:]==['--stdio']:serve(sys.stdin.buffer,sys.stdout,service);return 0
    if sys.argv[1:] in ([],['--probe']):
        print(json.dumps(service.handle({'op':'probe'}),separators=(',',':')));return 0
    print('{"ok":false,"error":"Unsupported invocation"}');return 2

if __name__=='__main__':raise SystemExit(main())
