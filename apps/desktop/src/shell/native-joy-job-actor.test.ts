import {describe,it,expect,vi} from 'vitest';
import {NativeJoyService,type RuntimeClientPort} from './native-joy-service';
import {readJobMetadata,readJobState,type NativeJobState} from './native-joy-job-types';
import { BLADE_TRIAL_ID } from './joy-blade-trial';
import trialPolicy from './joy-blade-trial-policy.json';
const hash='d'.repeat(64);
const meta={programDigest:hash,tool:'pen',operation:'draw',materialId:70000,passCount:2,recordCount:18,pressureRequests:[180,65535],heightInches:12,physicalCalibrationVerified:false};
const job=(phase='loading_and_aligning',extra:Record<string,unknown>={})=>({operationId:1,phase,active:!['completed','failed','cancelled'].includes(phase),sessionRetired:['completed','failed','cancelled'].includes(phase),jobStarted:['sending','draining','completed'].includes(phase),programDigest:hash,tool:'pen',acceptedRecords:phase==='completed'?9:0,completedPasses:phase==='completed'?1:0,totalRecords:9,totalPasses:1,physicalCompletionVerified:false,motionStoppedVerified:false,...extra});
function fixture(blade=false){
 const requests:Record<string,unknown>[]=[];let state:unknown=job('loading_and_aligning',blade?{tool:'fine_point_blade',totalPasses:3}:{}),closeFails=false,closing:Promise<void>|null=null;
 const client:RuntimeClientPort={isRunning:true,request:async r=>{requests.push(r);if(r.op==='connect')return{state:'ready',machine:'cricut_joy',firmwareSelector:8.164000001,materialRecord:12,fallbackUsed:false,status:{status_byte_1:104,status_byte_2:1,extra_u16_raw:0,extra_u16_native:0,value_be32:0}};if(r.op==='job'){if(r.action==='cancel')state=job('cancelled',{tool:(state as {tool:string}).tool,jobStarted:(state as {jobStarted:boolean}).jobStarted});if(r.action==='next')state=job('waiting_for_go',{operationId:2,programDigest:r.programDigest,jobStarted:false,active:true,sessionRetired:false,acceptedRecords:0,completedPasses:0});if(r.action==='end')state=job('completed',{tool:(state as {tool:string}).tool,totalPasses:(state as {totalPasses:number}).totalPasses,totalRecords:(state as {totalRecords:number}).totalRecords,acceptedRecords:(state as {totalRecords:number}).totalRecords,completedPasses:(state as {totalPasses:number}).totalPasses});return structuredClone(state);}return{state:'disconnected'};},close:vi.fn(async()=>{if(closing)await closing;if(closeFails)throw Error('private-port-failure');})};
 const compilers:RuntimeClientPort[]=[];let clientConnected=false;
 const service=new NativeJoyService({platform:'darwin',enabled:true,runtimePath:'/nonexistent-kindcut-test',store:{exists:async()=>false,save:async()=>{},load:async()=>{throw Error('NO SECRETS');}},clientFactory:()=>{if(!clientConnected){clientConnected=true;return client;}const compiler:RuntimeClientPort={isRunning:true,request:async r=>{requests.push(r);return{compiled:true};},close:vi.fn(async()=>{})};compilers.push(compiler);return compiler;}});
 const request={op:'job',action:'start',plan:{},settings:{tool:'pen'},pressureResponsesHex:[],pressureRequests:[180],programDigest:hash,motionApproved:true,bladeRemovedConfirmed:true,timeout:30,jobTimeout:60};
 return{service,client,compilers,requests,request,set:(s:unknown)=>{state=s;},failClose:()=>{closeFails=true;},holdClose:(p:Promise<void>)=>{closing=p;},connect:()=>service.connect({address:'01:02:03:04:05:06',hardwareApproved:true,cryptoResetApproved:true})};
}
describe('native job actor real contract',()=>{
 it('accepts native uint16 pressures and uint32 material IDs, not pass-count bounds as pressure bounds',()=>{expect(readJobMetadata(meta)).toEqual(meta);expect(readJobMetadata({...meta,passCount:32,pressureRequests:Array(32).fill(180)}).passCount).toBe(32);});
 it('completed is terminal, never active; a completed report needs exact counts',()=>{expect(readJobState(job('completed')).active).toBe(false);expect(()=>readJobState(job('completed',{active:true,sessionRetired:false}))).toThrow();expect(()=>readJobState(job('completed',{acceptedRecords:0}))).toThrow();});
 it('idle status performs no worker request and contains no physical claims',async()=>{const x=fixture();expect((await x.service.jobStatus()).phase).toBe('idle');expect(x.requests).toEqual([]);});
 it('approval reservation excludes all other native paths and can be declined safely',async()=>{
  const x=fixture();await x.connect();const c=x.service.reserveJobApproval();expect(x.service.ownsHardware).toBe(true);
  await expect(x.service.pollStatus()).rejects.toThrow();await expect(x.service.startLoading(12,true,true)).rejects.toThrow();await expect(x.service.controlMat('unload',true)).rejects.toThrow();await expect(x.service.runOfflineConfiguration({op:'configuration',action:'prepare_job'})).rejects.toThrow();expect(x.requests).toHaveLength(1);
  x.service.releaseJobApproval(c);expect(()=>x.service.loadingApprovalContext()).not.toThrow();
 });
 it('uses the actual worker request shape and rejects duplicate starts before dispatch',async()=>{
  const x=fixture();await x.connect();const c=x.service.reserveJobApproval();await x.service.startJob(x.request,c);await expect(x.service.startJob(x.request,c)).rejects.toThrow();expect(x.requests.filter(r=>r.op==='job'&&r.action==='start')).toHaveLength(1);
 });
 it('only genuine Go can admit jobStarted or successful completion',async()=>{
  const x=fixture();await x.connect();const c=x.service.reserveJobApproval();await x.service.startJob(x.request,c);x.set(job('waiting_for_go'));await x.service.jobStatus();
  await expect(x.service.controlJob('go',false,x.service.jobGoApprovalContext())).rejects.toThrow();
  x.set(job('completed'));await expect(x.service.jobStatus()).rejects.toThrow();expect(x.client.close).toHaveBeenCalled();
 });
 it('binds identity and monotonic counters, and does not accept unknown state fields',async()=>{
  for(const bad of [job('waiting_for_go',{programDigest:'b'.repeat(64)}),job('waiting_for_go',{operationId:2}),job('waiting_for_go',{totalRecords:10}),job('waiting_for_go',{rawSecret:'hidden'})]){
   const x=fixture();await x.connect();await x.service.startJob(x.request,x.service.reserveJobApproval());x.set(bad);await expect(x.service.jobStatus()).rejects.toThrow();expect(x.client.close).toHaveBeenCalled();
  }
 });
 it('keeps the hardware reserved until process close resolves and quarantines failed retirement',async()=>{
  const x=fixture();await x.connect();await x.service.startJob(x.request,x.service.reserveJobApproval());x.set(job('waiting_for_go'));await x.service.jobStatus();await x.service.controlJob('go',true,x.service.jobGoApprovalContext());x.set(retained());await x.service.jobStatus();
  let release!:()=>void;x.holdClose(new Promise<void>(r=>{release=r;}));const done=x.service.controlJob('end',true,x.service.jobRetainedApprovalContext());await Promise.resolve();expect(x.service.ownsHardware).toBe(true);release();await done;expect(x.service.ownsHardware).toBe(false);
  const y=fixture();await y.connect();await y.service.startJob(y.request,y.service.reserveJobApproval());y.failClose();y.set(job('failed'));await expect(y.service.jobStatus()).rejects.toThrow();expect(y.service.ownsHardware).toBe(true);
 });
 it('disconnect signals the job owner rather than racing a separate transport operation',async()=>{
  const x=fixture();await x.connect();await x.service.startJob(x.request,x.service.reserveJobApproval());x.set(job('waiting_for_go'));await x.service.jobStatus();await x.service.disconnect();expect(x.requests.some(r=>r.op==='job'&&r.action==='cancel')).toBe(true);expect(x.service.ownsHardware).toBe(false);
 });
});

it('recognizes pause phases as active job-started protocol states, never physical stop',()=>{for(const phase of ['pausing','paused'])expect(readJobState(job(phase,{jobStarted:true}))).toMatchObject({phase,active:true,motionStoppedVerified:false});});

async function startedActor(){const x=fixture();await x.connect();await x.service.startJob(x.request,x.service.reserveJobApproval());x.set(job('waiting_for_go'));await x.service.jobStatus();await x.service.controlJob('go',true,x.service.jobGoApprovalContext());x.set(job('sending'));await x.service.jobStatus();return x;}
it('owns queue pause/resume authority and prevents duplicate approval or replay',async()=>{const x=await startedActor();await x.service.controlJob('pause');x.set(job('paused',{jobStarted:true}));await x.service.jobStatus();const ctx=x.service.jobResumeApprovalContext();await expect(x.service.controlJob('resume',false,ctx)).rejects.toThrow();await x.service.controlJob('resume',true,ctx);expect(x.requests.at(-1)).toEqual({op:'job',action:'resume',operationId:1,resumeApproved:true});expect(()=>x.service.jobResumeApprovalContext()).toThrow();await expect(x.service.controlJob('resume',true,ctx)).rejects.toThrow();x.set(job('sending'));await x.service.jobStatus();await x.service.controlJob('pause');});
it('rejects unsolicited paused metadata and stale-generation resume',async()=>{const x=await startedActor();x.set(job('paused',{jobStarted:true}));await expect(x.service.jobStatus()).rejects.toThrow();const y=await startedActor();await y.service.controlJob('pause');y.set(job('paused',{jobStarted:true}));await y.service.jobStatus();const ctx=y.service.jobResumeApprovalContext();await y.service.disconnect();await expect(y.service.controlJob('resume',true,ctx)).rejects.toThrow();expect(y.requests.filter(r=>r.action==='resume')).toHaveLength(0);});

it('consumes source clearance inside the job queue and checks identity again after it awaits',async()=>{const x=await startedActor();await x.service.controlJob('pause');x.set(job('paused',{jobStarted:true}));await x.service.jobStatus();const ctx=x.service.jobResumeApprovalContext();await expect(x.service.controlJob('resume',true,ctx,async()=>{throw Error('Source approval stale while queued');})).rejects.toThrow(/stale/);expect(x.requests.filter(r=>r.action==='resume')).toHaveLength(0);});

const retained=()=>job('retained_ready',{jobStarted:true,active:true,sessionRetired:false,acceptedRecords:9,completedPasses:1});
it('retains an authorized drained job and gives next action a fresh monotonic operation and Go',async()=>{
 const x=await startedActor();x.set(retained());await x.service.jobStatus();
 const ctx=x.service.jobRetainedApprovalContext();
 const next={op:'job',action:'next',operationId:1,plan:{},settings:{tool:'pen'},pressureResponsesHex:[],pressureRequests:[180],programDigest:'e'.repeat(64),jobTimeout:60};
 await x.service.startNextJob(next,ctx);
 expect(x.requests.at(-1)).toMatchObject({op:'job',action:'next',operationId:1});
 expect(x.service.getJobState()).toMatchObject({operationId:2,phase:'waiting_for_go',jobStarted:false,acceptedRecords:0,completedPasses:0,active:true,sessionRetired:false});
 expect(()=>x.service.jobRetainedApprovalContext()).toThrow();
});
it('rejects stale retained contexts and requires approved explicit end before worker RPC',async()=>{
 const x=await startedActor();x.set(retained());await x.service.jobStatus();const ctx=x.service.jobRetainedApprovalContext();
 await expect(x.service.controlJob('end',false,ctx)).rejects.toThrow();expect(x.requests.filter(r=>r.action==='end')).toHaveLength(0);
 await x.service.controlJob('end',true,ctx);expect(x.requests.at(-1)).toMatchObject({op:'job',action:'end',operationId:1,endApproved:true});
});
it('uses a separate compiler client for prepare_job while retained and leaves owner open',async()=>{
 const x=await startedActor();x.set(retained());await x.service.jobStatus();
 await x.service.runOfflineConfiguration({op:'configuration',action:'prepare_job'});
 expect(x.client.close).not.toHaveBeenCalled();expect(x.compilers).toHaveLength(1);expect(x.requests.some(r=>r.op==='configuration'&&r.action==='prepare_job')).toBe(true);expect(x.compilers[0]!.close).toHaveBeenCalledOnce();
});

it('allows a fast fully drained action to be observed directly after the Go reply',async()=>{const x=fixture();await x.connect();await x.service.startJob(x.request,x.service.reserveJobApproval());x.set(job('waiting_for_go'));await x.service.jobStatus();await x.service.controlJob('go',true,x.service.jobGoApprovalContext());x.set(retained());await expect(x.service.jobStatus()).resolves.toMatchObject({phase:'retained_ready',active:true});});
it('keeps explicit End authority across an asynchronous retained reply and bars next actions while ending',async()=>{const x=await startedActor();x.set(retained());await x.service.jobStatus();const ctx=x.service.jobRetainedApprovalContext(),original=x.client.request;x.client.request=async r=>{if(r.op==='job'&&r.action==='end'){x.requests.push(r);return retained();}return original(r);};await x.service.controlJob('end',true,ctx);expect(()=>x.service.jobRetainedApprovalContext()).toThrow();await expect(x.service.runOfflineConfiguration({op:'configuration',action:'prepare_job'})).rejects.toThrow();x.set(job('completed'));await expect(x.service.jobStatus()).resolves.toMatchObject({phase:'completed',active:false});});
it('rejects a foreign next-action mat or coordinate frame before worker dispatch',async()=>{for(const change of [{mat:{widthIn:4.5,heightIn:6.5}},{coordinateFrame:'foreign'}]){const x=await startedActor();x.set(retained());await x.service.jobStatus();const ctx=x.service.jobRetainedApprovalContext(),n=x.requests.length;await expect(x.service.startNextJob({op:'job',action:'next',operationId:1,plan:change,settings:{tool:'pen'},pressureResponsesHex:[],pressureRequests:[180],programDigest:'e'.repeat(64),jobTimeout:60},ctx)).rejects.toThrow();expect(x.requests).toHaveLength(n);}});
it('never accepts successful session termination without an explicit End after drawing',async()=>{const x=await startedActor();x.set(job('completed'));await expect(x.service.jobStatus()).rejects.toThrow();});

const trialPt=20*72/25.4;
const bladePlan=()=>({schemaVersion:2,machine:'cricut_joy',coordinateFrame:'kindcut_canvas_pt72_v1',unit:'pt72',execution:'unsupported',material:{widthIn:4.5,heightIn:12,id:211},mat:{widthIn:4.5,heightIn:12},groups:[{tool:'fine_point_blade',operation:'cut',paths:[{id:'square',steps:[{op:'M',points:[{x:40,y:50}]},{op:'L',points:[{x:40+trialPt,y:50}]},{op:'L',points:[{x:40+trialPt,y:50+trialPt}]},{op:'L',points:[{x:40,y:50+trialPt}]},{op:'Z',points:[]}]}]}],bounds:{minX:40,minY:50,maxX:40+trialPt,maxY:50+trialPt},clipping:{policy:'reject',clippedPathIds:[],omittedPathIds:[]}});
it('admits only the validated first-cut marker and gives genuine private Go both confirmations',async()=>{
 const x=fixture(true);await x.connect();const c=x.service.reserveJobApproval();const req={...x.request,settings:structuredClone(trialPolicy.settings),plan:bladePlan(),pressureRequests:[223,223,223],bladeTrial:BLADE_TRIAL_ID};
 await x.service.startJob(req,c);x.set(job('waiting_for_go',{tool:'fine_point_blade',totalPasses:3}));await x.service.jobStatus();await x.service.controlJob('go',true,x.service.jobGoApprovalContext());expect(x.requests.at(-1)).toEqual({op:'job',action:'go',operationId:1,toolConfirmed:true,bladeInstalledConfirmed:true});
});
it('rejects invalid trial marker, geometry and pressure without worker requests',async()=>{
 for(const mutate of [(r:any)=>r.bladeTrial='wrong',(r:any)=>r.plan.groups[0].paths[0].steps.push({op:'M',points:[{x:0,y:0}]}),(r:any)=>r.plan.groups[0].paths[0].steps[1].points[0].x=NaN,(r:any)=>r.pressureRequests=[223,223]]){
 const x=fixture(true);await x.connect();const c=x.service.reserveJobApproval(),req={...x.request,settings:structuredClone(trialPolicy.settings),plan:bladePlan(),pressureRequests:[223,223,223],bladeTrial:BLADE_TRIAL_ID};mutate(req);const before=x.requests.length;await expect(x.service.startJob(req,c)).rejects.toThrow();expect(x.requests).toHaveLength(before);
 }
});
it('blocks any blade-trial continuation, pause and resume before RPC',async()=>{
 const x=fixture(true);await x.connect();const c=x.service.reserveJobApproval();await x.service.startJob({...x.request,settings:structuredClone(trialPolicy.settings),plan:bladePlan(),pressureRequests:[223,223,223],bladeTrial:BLADE_TRIAL_ID},c);x.set(job('waiting_for_go',{tool:'fine_point_blade',totalPasses:3}));await x.service.jobStatus();const n=x.requests.length;await expect(x.service.startNextJob({op:'job',action:'next'},{} as any)).rejects.toThrow();await expect(x.service.controlJob('pause')).rejects.toThrow();await expect(x.service.controlJob('resume')).rejects.toThrow();expect(x.requests).toHaveLength(n);
});


it('recognizes returned protocol state and preserves closed workflow metadata',()=>{
 expect(readJobState(job('returning_to_origin',{jobStarted:true,acceptedRecords:9,completedPasses:1,returnToOrigin:'running'}))).toMatchObject({returnToOrigin:'running',phase:'returning_to_origin'});
 const workflow={actionIndex:0,actionCount:2,containsBlade:true,actions:[{tool:'pen',profileId:'p',profileName:'Pen',passCount:1,pressureRequests:[100]},{tool:'fine_point_blade',profileId:'b',profileName:'Blade',passCount:3,pressureRequests:[223,223,223]}]};
 expect(readJobMetadata({...meta,workflow}).workflow).toEqual(workflow);
 expect(()=>readJobState({...retained(),returnToOrigin:'running'})).toThrow();
 expect(()=>readJobMetadata({...meta,workflow:{...workflow,motionApproved:true}})).toThrow();
});
it('admits an exact retained blade only after returned pen and sends fresh private blade Go',async()=>{
 const x=fixture();await x.connect();const plan=bladePlan(),penSettings={tool:'pen',materialId:211};
 await x.service.startJob({...x.request,plan,settings:penSettings},x.service.reserveJobApproval());
 x.set(job('waiting_for_go'));await x.service.jobStatus();await x.service.controlJob('go',true,x.service.jobGoApprovalContext());
 x.set({...retained(),returnToOrigin:'protocol_complete'});await x.service.jobStatus();
 const next={op:'job',action:'next',operationId:1,plan,settings:structuredClone(trialPolicy.settings),pressureResponsesHex:[],pressureRequests:[223,223,223],programDigest:'e'.repeat(64),jobTimeout:60,bladeTrial:BLADE_TRIAL_ID};
 const old=x.client.request;x.client.request=async r=>{if(r.op==='job'&&r.action==='next'){x.requests.push(r);return job('waiting_for_go',{operationId:2,programDigest:r.programDigest,tool:'fine_point_blade',totalPasses:3});}return old(r);};
 await x.service.startNextJob(next,x.service.jobRetainedApprovalContext());
 x.set(job('waiting_for_go',{operationId:2,programDigest:next.programDigest,tool:'fine_point_blade',totalPasses:3}));
 await x.service.controlJob('go',true,x.service.jobGoApprovalContext());expect(x.requests.at(-1)).toMatchObject({toolConfirmed:true,bladeInstalledConfirmed:true,operationId:2});
});

it('prepares a job in a separate offline worker while an idle Joy connection is retained',async()=>{const x=fixture();await x.connect();const before=x.requests.length;const r=await x.service.runOfflineConfiguration({op:'configuration',action:'prepare_job',plan:{}});expect(r).toEqual({compiled:true});expect(x.compilers).toHaveLength(1);expect(x.requests.slice(before)).toEqual([{op:'configuration',action:'prepare_job',plan:{}}]);expect(x.client.close).not.toHaveBeenCalled();expect(x.service.ownsHardware).toBe(true);});
it('general blade source needs genuine installation Go without the old square restriction',async()=>{const x=fixture(true);await x.connect();const p=bladePlan();p.groups[0]!.paths[0]!.steps[1]!.points[0]!.x+=10;const req={...x.request,plan:p,settings:structuredClone(trialPolicy.settings),pressureRequests:[223,223,223],bladeJob:'joy-blade-job-v1'};await x.service.startJob(req,x.service.reserveJobApproval());x.set(job('waiting_for_go',{tool:'fine_point_blade',totalPasses:3}));await x.service.jobStatus();await x.service.controlJob('go',true,x.service.jobGoApprovalContext());expect(x.requests.at(-1)).toMatchObject({toolConfirmed:true,bladeInstalledConfirmed:true});});

it('Cancel retains ownership until graceful worker retirement closes the connection',async()=>{const x=fixture();await x.connect();await x.service.startJob(x.request,x.service.reserveJobApproval());let release!:()=>void;x.holdClose(new Promise<void>(r=>{release=r;}));const cancel=x.service.controlJob('cancel');await Promise.resolve();await Promise.resolve();expect(x.service.ownsHardware).toBe(true);release();const result=await cancel;expect(result.phase).toBe('cancelled');expect(result.sessionRetired).toBe(true);expect(result.motionStoppedVerified).toBe(false);expect(x.client.close).toHaveBeenCalledTimes(1);expect((await x.service.getStatus()).session).toBeNull();expect(x.service.ownsHardware).toBe(false);});
