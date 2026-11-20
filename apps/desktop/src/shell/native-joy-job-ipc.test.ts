import {describe,expect,it,vi} from 'vitest';
import {registerNativeJoyJobIpc} from './native-joy-job-ipc';
function fixture(){
 let trusted=true,busy=false;
 const handlers=new Map<string,(e:unknown,v?:unknown)=>Promise<unknown>>();
 const service={prepare:vi.fn(async()=>({jobId:'opaque'})),start:vi.fn(async()=>({phase:'loading_and_aligning'})),armNext:vi.fn(async()=>({phase:'waiting_for_go',jobStarted:false,acceptedRecords:0})),go:vi.fn(async()=>({phase:'sending'})),pause:vi.fn(async()=>({phase:'pausing'})),resume:vi.fn(async()=>({phase:'paused'})),end:vi.fn(async()=>({phase:'releasing'})),cancel:vi.fn(async()=>({phase:'cancelled'})),status:vi.fn(async()=>({phase:'idle'})),invalidate:vi.fn()};
 const exportFile=vi.fn(async()=>({canceled:false}));
 registerNativeJoyJobIpc({register:(name,run)=>handlers.set(name,run),isTrusted:()=>trusted,service:()=>service,canExport:()=>!busy,export:exportFile,restoreHistory:async()=>({phase:'completed',historical:true}),recoveryInfo:async()=>({status:'interrupted',machineState:'unknown',canResume:false})});
 return{service,exportFile,call:(name:string,input?:unknown)=>handlers.get(`native-joy:job-${name}`)!({},input),untrust:()=>{trusted=false;},busy:()=>{busy=true;}};
}
describe('trusted job IPC only',()=>{
 it('registers closed capabilities and never accepts renderer authority or raw packets',async()=>{
  const x=fixture();await x.call('prepare',{profileId:'p',calibrationId:'c',source:{svg:'test'}});expect(x.service.prepare).toHaveBeenCalledTimes(1);
  await expect(x.call('start',{jobId:'opaque',source:{},motionApproved:true})).rejects.toThrow();
  await expect(x.call('prepare',{profileId:'p',calibrationId:'c',source:{},rawPackets:[]})).rejects.toThrow();
  for(const name of ['go','cancel','status','invalidate','export'])await expect(x.call(name,{approved:true})).rejects.toThrow();
  expect(x.service.start).not.toHaveBeenCalled();expect(x.service.go).not.toHaveBeenCalled();
 });
 it('denies every untrusted sender before service access',async()=>{
  const x=fixture();x.untrust();for(const name of ['prepare','start','go','cancel','status','invalidate','export'])await expect(x.call(name)).rejects.toThrow(/Trusted/);expect(x.service.status).not.toHaveBeenCalled();expect(x.exportFile).not.toHaveBeenCalled();
 });
 it('keeps restored history read-only and controls signal-only',async()=>{
  const x=fixture();expect(await x.call('status')).toEqual({phase:'completed',historical:true});expect(x.service.start).not.toHaveBeenCalled();await x.call('go');expect(x.service.go).toHaveBeenCalledWith();await x.call('cancel');expect(x.service.cancel).toHaveBeenCalledWith();await x.call('invalidate');expect(x.service.invalidate).toHaveBeenCalledWith();
 });
 it('never opens host export while any cutter owns or is reserving hardware',async()=>{
  const x=fixture();x.busy();await expect(x.call('export')).rejects.toThrow(/Retire/);expect(x.exportFile).not.toHaveBeenCalled();
 });
});

it('returns read-only interrupted observations without touching a job owner',async()=>{const x=fixture();expect(await x.call('recovery-info')).toEqual({status:'interrupted',machineState:'unknown',canResume:false});expect(x.service.start).not.toHaveBeenCalled();expect(x.service.go).not.toHaveBeenCalled();await expect(x.call('recovery-info',{resume:true})).rejects.toThrow();x.untrust();await expect(x.call('recovery-info')).rejects.toThrow(/Trusted/);});

it('pause and resume accept no renderer approvals or identity fields',async()=>{const x=fixture();await expect(x.call('pause',{motionApproved:true})).rejects.toThrow();await expect(x.call('resume',{resumeApproved:true})).rejects.toThrow();await expect(x.call('pause')).resolves.toBeDefined();await expect(x.call('resume')).resolves.toBeDefined();});

it('retained End is a closed trusted capability, never a renderer approval flag',async()=>{const x=fixture();await expect(x.call('end',{endApproved:true})).rejects.toThrow();expect(x.service.end).not.toHaveBeenCalled();await expect(x.call('end')).resolves.toEqual({phase:'releasing'});x.untrust();await expect(x.call('end')).rejects.toThrow();expect(x.service.end).toHaveBeenCalledTimes(1);});

it('motion-free arm-next is a closed capability distinct from fresh-Go job-start',async()=>{const x=fixture();await expect(x.call('arm-next',{jobId:'opaque',source:{},motionApproved:true})).rejects.toThrow();expect(x.service.armNext).not.toHaveBeenCalled();await expect(x.call('arm-next',{jobId:'opaque',source:{}})).resolves.toMatchObject({phase:'waiting_for_go',acceptedRecords:0});expect(x.service.armNext).toHaveBeenCalledWith({jobId:'opaque',source:{}});expect(x.service.start).not.toHaveBeenCalled();expect(x.service.go).not.toHaveBeenCalled();x.untrust();await expect(x.call('arm-next',{jobId:'opaque',source:{}})).rejects.toThrow(/Trusted/);});
