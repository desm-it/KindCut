import {describe,it,expect} from 'vitest';
import {NativeJoyService,type NativeJoyLoadingState,type RuntimeClientPort} from './native-joy-service';
const ready={state:'ready',machine:'cricut_joy',firmwareSelector:8.164000001,materialRecord:0,fallbackUsed:false,status:{status_byte_1:0x60,status_byte_2:1,extra_u16_raw:0,extra_u16_native:0,value_be32:0}};
function state(phase:NativeJoyLoadingState['phase']='loading_and_aligning'):NativeJoyLoadingState{return {operationId:1,phase,active:['loading_and_aligning','waiting_for_go','releasing'].includes(phase),sessionRetired:['completed','cancelled','failed'].includes(phase),physicalLoadingVerified:false,physicalAlignmentVerified:false,motionStoppedVerified:false,jobStarted:false};}
function fixture(){
 const seen:Record<string,unknown>[]=[];let closed=0,aborted=0,active=false,cancelled=false,go=false;
 let override:((r:Record<string,unknown>)=>unknown|Promise<unknown>)|null=null;
 const client:RuntimeClientPort={isRunning:true,close:async()=>{closed++;},abort:()=>{aborted++;},request:async r=>{
  seen.push(r);if(r.op==='connect')return ready;
  if(override){const x=await override(r);if(x!==undefined)return x;}
  if(r.op==='loading'){
   if(r.action==='start'){active=true;return state();}
   if(r.action==='cancel'){cancelled=true;return state('waiting_for_go');}
   if(r.action==='go'){go=true;return state('releasing');}
   if(r.action==='status'){if(cancelled){active=false;return state('cancelled');}if(go){active=false;return state('completed');}return active?state('waiting_for_go'):{...state(),operationId:0,phase:'idle',active:false};}
  }
  return ready;
 }};
 const s=new NativeJoyService({platform:'darwin',enabled:true,runtimePath:'/inert-no-spawn',store:{exists:async()=>false,save:async()=>{},load:async()=>{throw Error('unused');}},clientFactory:()=>client});
 return {s,seen,client,setOverride:(f:typeof override)=>{override=f;},get closed(){return closed;},get aborted(){return aborted;}};
}
async function connected(){const f=fixture();await f.s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true});return f;}

describe('stock-style loading phase boundary',()=>{
 it('admits ordered acknowledged insertion, grip, Y and X progress while retaining ownership',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  for(const phase of ['waiting_for_mat','gripped','measuring_y','positioning','waiting_for_go'] as const){
   f.setOverride(r=>r.action==='status'?{...state(),phase,active:true}:undefined);
   expect((await f.s.loadingStatus()).phase).toBe(phase);expect(f.s.ownsHardware).toBe(true);
   await expect(f.s.controlMat('load',true)).rejects.toThrow(/loading/i);
  }
  expect(f.seen.some(r=>r.op==='mat')).toBe(false);expect(f.closed).toBe(0);f.s.dispose();
 });
 it('allows polling to skip intermediate acknowledged phases, but not regress after X alignment',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  f.setOverride(r=>r.action==='status'?{...state(),phase:'positioning',active:true}:undefined);
  expect((await f.s.loadingStatus()).phase).toBe('positioning');
  f.setOverride(r=>r.action==='status'?{...state(),phase:'waiting_for_mat',active:true}:undefined);
  await expect(f.s.loadingStatus()).rejects.toThrow(/loading/i);expect(f.closed).toBe(1);expect(f.s.ownsHardware).toBe(false);
 });
 it('does not permit ending a retained session before the ready phase',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  f.setOverride(r=>r.action==='status'?{...state(),phase:'waiting_for_mat',active:true}:undefined);
  await f.s.loadingStatus();await expect(f.s.controlLoading('go')).rejects.toThrow(/wait/i);
  expect(f.seen.some(r=>r.action==='go')).toBe(false);expect(f.closed).toBe(0);f.s.dispose();
 });
});


describe('loading diagnostics survive trusted state and retirement',()=>{
 it('marks a boundary failure incomplete rather than presenting the prior trace as complete',async()=>{const f=await connected();await f.s.startLoading(12,true,true);f.setOverride(r=>r.action==='status'?{...state(),diagnostics:{version:1,operationId:1,lastStage:'gripped',failure:null,events:[],totalEvents:0,evictedEvents:0,captureIncomplete:false}}:undefined);await f.s.loadingStatus();f.setOverride(()=>({secret:'DO_NOT_LOG'}));await expect(f.s.loadingStatus()).rejects.toThrow(/loading/i);const d=f.s.getLoadingState().diagnostics;expect(d?.captureIncomplete).toBe(true);expect(d?.failure?.code).toBe('runtime_boundary_failed');expect(JSON.stringify(d)).not.toContain('DO_NOT_LOG');});

 it('accepts and detaches diagnostic history on failed retired snapshots',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  const diagnostic={version:1,operationId:1,lastStage:'closing',failure:{stage:'precheck',code:'unexpected_reply',errorType:'ValueError'},events:[{seq:1,atMs:2,startedMs:1,kind:'exchange',stage:'precheck',txHex:'0002eb00',rxHex:'000114',code:null}],totalEvents:1,evictedEvents:0,captureIncomplete:false};
  f.setOverride(r=>r.action==='status'?{...state('failed'),diagnostics:diagnostic}:undefined);
  const got=await f.s.loadingStatus();expect(got.diagnostics?.failure?.stage).toBe('precheck');expect(f.closed).toBe(1);
  diagnostic.events[0]!.rxHex='0000';if(got.diagnostics)got.diagnostics.events[0]!.rxHex='ffff';expect(f.s.getLoadingState().diagnostics?.events[0]?.rxHex).toBe('000114');
 });
 it('rejects malformed diagnostic timestamps without leaking them or leaving the worker owned',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  f.setOverride(r=>r.action==='status'?{...state(),diagnostics:{secret:'Do not expose'}}:undefined);
  await expect(f.s.loadingStatus()).rejects.toThrow(/loading/i);expect(f.closed).toBe(1);
 });
});
describe('experimental retained loading service',()=>{
 it('keeps ownership when invalid worker metadata is followed by failed process retirement',async()=>{
  const f=await connected();f.setOverride(r=>r.action==='start'?{...state(),jobStarted:true}:undefined);
  f.client.close=async()=>{throw Error('PRIVATE_CLOSE_FAILURE');};
  await expect(f.s.startLoading(12,true,true)).rejects.toThrow(/loading/i);
  expect(f.s.ownsHardware).toBe(true);f.s.dispose();expect(f.aborted).toBe(1);
 });
 it('quarantines failed process retirement without leaking its error or losing the owned port',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  f.client.close=async()=>{throw Error('PRIVATE_CLOSE_FAILURE');};
  const error=await f.s.disconnect().then(()=>null,e=>e);
  expect(error).toBeInstanceOf(Error);expect(String(error)).not.toContain('PRIVATE_CLOSE_FAILURE');
  expect(f.s.ownsHardware).toBe(true);
  await expect(f.s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true})).rejects.toThrow(/loading|retir/i);
  f.s.dispose();expect(f.aborted).toBe(1);
 });
 it('validates and sanitizes the complete start/status/go/retirement route',async()=>{
  const f=await connected();const r=await f.s.startLoading(12,true,true);expect(r.active).toBe(true);
  expect(f.s.ownsHardware).toBe(true);expect((await f.s.loadingStatus()).phase).toBe('waiting_for_go');
  await f.s.controlLoading('go');const done=await f.s.loadingStatus();expect(done.phase).toBe('completed');expect(done.jobStarted).toBe(false);
  expect((await f.s.getStatus()).session).toBeNull();expect(f.s.ownsHardware).toBe(false);expect(f.closed).toBe(1);
 });
 it('does not let competing operations discard an active owner',async()=>{
  const f=await connected();await f.s.startLoading(6.5,true,true);
  await expect(f.s.pollStatus()).rejects.toThrow(/loading/i);await expect(f.s.controlMat('unload',true)).rejects.toThrow(/loading/i);
  expect(f.closed).toBe(0);expect(f.s.ownsHardware).toBe(true);await f.s.disconnect();
 });
 it('cancels and observes worker retirement before closing on disconnect',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);await f.s.disconnect();
  expect(f.seen.some(r=>r.op==='loading'&&r.action==='cancel')).toBe(true);
  const cancel=f.seen.findIndex(r=>r.action==='cancel');expect(f.seen.slice(cancel+1).some(r=>r.action==='status')).toBe(true);
  expect(f.s.ownsHardware).toBe(false);expect((await f.s.loadingStatus()).active).toBe(false);expect(f.closed).toBe(1);
 });
 it('serializes a metadata poll and cancellation rather than rejecting Cancel as busy',async()=>{
  const f=await connected();await f.s.startLoading(12,true,true);
  const results=await Promise.all([f.s.loadingStatus(),f.s.controlLoading('cancel')]);expect(results).toHaveLength(2);
  expect((await f.s.loadingStatus()).phase).toBe('cancelled');expect(f.s.ownsHardware).toBe(false);
 });
 it('rejects inconsistent phases, claims and operation identities, retiring untrusted output',async()=>{
  for(const bad of [{...state(),active:false},{...state(),phase:'completed',active:false,sessionRetired:true},
                    {...state(),jobStarted:true},{...state(),physicalAlignmentVerified:true},
                    {...state(),operationId:true},{...state(),phase:{toString:()=> 'loading_and_aligning'}}]){
   const f=await connected();f.setOverride(r=>r.action==='start'?bad:undefined);
   await expect(f.s.startLoading(12,true,true)).rejects.toThrow();expect(f.closed).toBe(1);expect(f.s.ownsHardware).toBe(false);
  }
  const f=await connected();await f.s.startLoading(12,true,true);f.setOverride(r=>r.action==='status'?{...state('waiting_for_go'),operationId:2}:undefined);
  await expect(f.s.loadingStatus()).rejects.toThrow();expect(f.s.ownsHardware).toBe(false);
 });
 it('late start replies after disconnect cannot resurrect session or loading ownership',async()=>{
  const f=await connected();let release!:(v:unknown)=>void;let entered!:(v:void)=>void;
  const sent=new Promise<void>(r=>{entered=r;});const held=new Promise(r=>{release=r;});
  f.setOverride(r=>{if(r.action==='start'){entered();return held;}return undefined;});
  const result=f.s.startLoading(12,true,true).then(()=>true,()=>false);await sent;
  const ending=f.s.disconnect();release(state());expect(await result).toBe(false);await ending;
  expect(f.s.ownsHardware).toBe(false);expect((await f.s.getStatus()).session).toBeNull();expect((await f.s.loadingStatus()).active).toBe(false);
 });
 it('late replies after disposal cannot restore ownership',async()=>{
  const f=await connected();let release!:(v:unknown)=>void;let entered!:(v:void)=>void;
  const sent=new Promise<void>(r=>{entered=r;});const held=new Promise(r=>{release=r;});
  f.setOverride(r=>{if(r.action==='start'){entered();return held;}return undefined;});
  const result=f.s.startLoading(12,true,true).then(()=>true,()=>false);await sent;f.s.dispose();release(state());
  expect(await result).toBe(false);expect(f.s.ownsHardware).toBe(false);expect(f.aborted).toBe(1);
 });
 it('requires explicit host approval and a matching approval-session generation',async()=>{
  const f=await connected();await expect(f.s.startLoading(12,false,true)).rejects.toThrow(/approval/i);
  await expect(f.s.startLoading(12,true,false)).rejects.toThrow(/approval/i);expect(f.seen.filter(r=>r.op==='loading')).toHaveLength(0);
  const context=(f.s as NativeJoyService & {loadingApprovalContext():number}).loadingApprovalContext();
  await f.s.disconnect();await f.s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true});
  await expect((f.s.startLoading as (h:6.5|12,a:boolean,b:boolean,c:number)=>Promise<unknown>)(12,true,true,context)).rejects.toThrow(/approval|session/i);
 });
});
