import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readJobState,type NativeJobState} from './native-joy-job-types';
import {readLoadingDiagnostics,type NativeJoyLoadingDiagnosticEvent,type NativeJoyLoadingDiagnostics} from './native-joy-loading-diagnostics';

const LIMIT=8192,BYTES=8*1024*1024;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export interface NativeJoyJobReport {
 schemaVersion:1;kind:'kindcut_joy_job_diagnostics';reportId:string;startedAt:string;
 operationId:number|null;phase:string;active:boolean;jobStarted:boolean;programDigest:string|null;
 state:NativeJobState|null;failure:NativeJoyLoadingDiagnostics['failure'];
 events:NativeJoyLoadingDiagnosticEvent[];totalEvents:number;captureIncomplete:boolean;
 completeCapture:boolean;gaps:Array<[number,number]>;
}
const keys=['schemaVersion','kind','reportId','startedAt','operationId','phase','active','jobStarted','programDigest','state','failure','events','totalEvents','captureIncomplete','completeCapture','gaps'];
const bad=():never=>{throw Error('Native job diagnostic report is invalid or unavailable.');};
function summarize(r:NativeJoyJobReport){
 let next=1;const gaps:Array<[number,number]>=[];
 for(const e of r.events){if(e.seq>next)gaps.push([next,e.seq-1]);next=e.seq+1;}
 if(next<=r.totalEvents)gaps.push([next,r.totalEvents]);r.gaps=gaps;
 r.completeCapture=!r.active&&r.state!==null&&r.totalEvents>0&&!r.captureIncomplete&&!gaps.length;
 return r;
}
function validate(value:unknown):NativeJoyJobReport {
 if(!value||typeof value!=='object'||Array.isArray(value))return bad();const x=value as Record<string,unknown>;
 if(Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k))||x.schemaVersion!==1||x.kind!=='kindcut_joy_job_diagnostics'||!uuid(x.reportId)||typeof x.startedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x.startedAt)||!Number.isFinite(Date.parse(x.startedAt))||typeof x.active!=='boolean'||typeof x.jobStarted!=='boolean'||typeof x.captureIncomplete!=='boolean'||typeof x.completeCapture!=='boolean'||!Number.isSafeInteger(x.totalEvents)||Number(x.totalEvents)<0||!Array.isArray(x.events)||x.events.length>LIMIT||!Array.isArray(x.gaps))return bad();
 const state=x.state===null?null:readJobState(x.state),id=x.operationId;
 if(state===null){if(id!==null||x.phase!=='not_started'||x.active||x.jobStarted||x.programDigest!==null||x.events.length||x.totalEvents!==0||x.failure!==null)return bad();}
 else if(state.operationId!==id||state.phase!==x.phase||state.active!==x.active||state.jobStarted!==x.jobStarted||state.programDigest!==x.programDigest)return bad();
 let previous=0,priorTime=-1;
 const events=x.events.map(raw=>{
  const e=raw as NativeJoyLoadingDiagnosticEvent;
  if(!e||!Number.isSafeInteger(e.seq)||e.seq<=previous||e.seq>Number(x.totalEvents))return bad();
  const clean=readLoadingDiagnostics({version:1,operationId:id,lastStage:e.stage,failure:x.failure,events:[e],totalEvents:e.seq,evictedEvents:e.seq-1,captureIncomplete:x.captureIncomplete},Number(id)).events[0]!;
  if(clean.atMs<priorTime)return bad();previous=clean.seq;priorTime=clean.atMs;return clean;
 });
 const failure=id===null?null:readLoadingDiagnostics({version:1,operationId:id,lastStage:'report',failure:x.failure,events:[],totalEvents:0,evictedEvents:0,captureIncomplete:x.captureIncomplete},Number(id)).failure;
 const r=summarize({schemaVersion:1,kind:'kindcut_joy_job_diagnostics',reportId:x.reportId,startedAt:x.startedAt,operationId:id as number|null,phase:String(x.phase),active:x.active,jobStarted:x.jobStarted,programDigest:x.programDigest as string|null,state,failure,events,totalEvents:Number(x.totalEvents),captureIncomplete:x.captureIncomplete,completeCapture:false,gaps:[]});
 if(r.completeCapture!==x.completeCapture||JSON.stringify(r.gaps)!==JSON.stringify(x.gaps))return bad();return r;
}

/** Trusted-main only. Journaling never sends commands or upgrades physical claims. */
export class NativeJoyJobJournal {
 private current:NativeJoyJobReport|null=null;
 private tail:Promise<void>=Promise.resolve();
 constructor(readonly directory:string){if(!path.isAbsolute(directory))throw Error('Absolute private job diagnostic directory required.');}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const p=this.tail.then(run);this.tail=p.then(()=>{},()=>{});return p;}
 private async ensure(){await fs.mkdir(this.directory,{recursive:true,mode:0o700});const s=await fs.lstat(this.directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Unsafe diagnostic directory.');await fs.chmod(this.directory,0o700);}
 private async readBounded(file:string,limit=BYTES){const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();if(!s.isFile()||s.size>limit)return bad();const b=await h.readFile();if(b.length>limit)return bad();return b;}finally{await h.close();}}
 private async atomic(target:string,bytes:string){
  const tmp=path.join(path.dirname(target),`.kindcut-job-${randomUUID()}.tmp`);
  try{const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await fs.rename(tmp,target);}
  finally{await fs.rm(tmp,{force:true});}
 }
 private async save(r:NativeJoyJobReport){
  validate(r);const bytes=JSON.stringify(r,null,2)+'\n';if(Buffer.byteLength(bytes)>BYTES)throw Error('Job diagnostic storage bound exceeded.');
  const file=path.join(this.directory,`job-${r.reportId}.json`);await this.atomic(file,bytes);
  if((await this.readBounded(file)).toString()!==bytes)throw Error('Job report readback failed.');
  const pointer=JSON.stringify({reportId:r.reportId})+'\n',pointerFile=path.join(this.directory,'latest.json');await this.atomic(pointerFile,pointer);
  if((await this.readBounded(pointerFile,128)).toString()!==pointer)throw Error('Job report pointer readback failed.');
 }
 async preflight():Promise<void>{return this.serial(async()=>{
  await this.ensure();const r:NativeJoyJobReport={schemaVersion:1,kind:'kindcut_joy_job_diagnostics',reportId:randomUUID(),startedAt:new Date().toISOString(),operationId:null,phase:'not_started',active:false,jobStarted:false,programDigest:null,state:null,failure:null,events:[],totalEvents:0,captureIncomplete:false,completeCapture:false,gaps:[]};
  await this.save(r);this.current=r;
 });}
 async observe(value:unknown):Promise<void>{return this.serial(async()=>{
  const state=readJobState(value);if(state.phase==='idle')return;
  if(!this.current)throw Error('Job diagnostic preflight required.');const r=structuredClone(this.current);
  if(r.operationId!==null&&(r.operationId!==state.operationId||r.programDigest!==state.programDigest))throw Error('Job diagnostic identity changed.');
  if(r.jobStarted&&!state.jobStarted)throw Error('Job dispatch history regressed.');
  r.operationId=state.operationId;r.programDigest=state.programDigest;r.phase=state.phase;r.active=state.active;r.jobStarted=state.jobStarted;r.state=state;
  const d=state.diagnostics;
  if(d){const bySeq=new Map(r.events.map(e=>[e.seq,e]));for(const e of d.events){const prior=bySeq.get(e.seq);if(prior&&JSON.stringify(prior)!==JSON.stringify(e))throw Error('Job diagnostic history changed.');bySeq.set(e.seq,e);}
   r.events=[...bySeq.values()].sort((a,b)=>a.seq-b.seq);if(r.events.length>LIMIT){r.events=[...r.events.slice(0,256),...r.events.slice(-(LIMIT-256))];r.captureIncomplete=true;}
   r.totalEvents=Math.max(r.totalEvents,d.totalEvents);r.failure??=d.failure;r.captureIncomplete||=d.captureIncomplete;
  }else{r.captureIncomplete=true;}
  summarize(r);await this.save(r);this.current=r;
 });}
 private async load(){
  const directory=await fs.lstat(this.directory);if(!directory.isDirectory()||directory.isSymbolicLink())return bad();
  const pointer=JSON.parse((await this.readBounded(path.join(this.directory,'latest.json'),128)).toString());if(!pointer||Object.keys(pointer).length!==1||!uuid(pointer.reportId))return bad();
  const r=validate(JSON.parse((await this.readBounded(path.join(this.directory,`job-${pointer.reportId}.json`))).toString()));if(r.reportId!==pointer.reportId)return bad();return r;
 }
 async recoveryInfo():Promise<import('./native-joy-job-recovery').NativeJobRecoveryInfo|null>{return this.serial(async()=>{
  let r:NativeJoyJobReport;try{r=await this.load();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('Saved job recovery observation invalid.');}
  const status=r.active||r.state===null?'interrupted':r.phase;
  if(!['interrupted','completed','cancelled','failed'].includes(status))return bad();
  return{status:status as 'interrupted'|'completed'|'cancelled'|'failed',reportId:r.reportId,operationId:r.operationId,
   lastKnownPhase:r.phase,jobStarted:r.jobStarted,acceptedRecords:r.state?.acceptedRecords??0,
   completedPasses:r.state?.completedPasses??0,totalRecords:r.state?.totalRecords??0,totalPasses:r.state?.totalPasses??0,
   captureComplete:r.completeCapture,machineState:'unknown',canResume:false,requiresFreshApproval:true};
 });}
 async readLatest():Promise<NativeJoyJobReport>{return this.serial(()=>this.load());}
 async restoreTerminalState():Promise<(NativeJobState&{historical:true})|null>{return this.serial(async()=>{
  let r:NativeJoyJobReport;try{r=await this.load();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('Saved job diagnostic history invalid.');}
  return r.state&&!r.active&&['completed','failed','cancelled'].includes(r.phase)?{...r.state,historical:true}:null;
 });}
 async exportTo(target:string):Promise<void>{return this.serial(async()=>{
  if(!path.isAbsolute(target))throw Error('Host-selected absolute export path required.');const r=await this.load(),bytes=JSON.stringify(r,null,2)+'\n';await this.atomic(target,bytes);
  if(createHash('sha256').update(await this.readBounded(target)).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw Error('Job export readback failed.');
 });}
}
