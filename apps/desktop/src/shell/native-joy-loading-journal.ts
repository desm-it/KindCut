import fs from'node:fs/promises';import path from'node:path';import{randomUUID,createHash}from'node:crypto';
import type{NativeJoyLoadingState}from'./native-joy-service';
import{readLoadingDiagnostics,type NativeJoyLoadingDiagnostics,type NativeJoyLoadingDiagnosticEvent}from'./native-joy-loading-diagnostics';
const LIMIT=8192,BYTES=8*1024*1024;
const phases=['not_started','idle','loading_and_aligning','waiting_for_mat','gripped','measuring_y','positioning','waiting_for_go','releasing','completed','cancelled','failed'];
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const bad=():never=>{throw Error('Invalid loading diagnostic report.');};
export interface NativeJoyLoadingReport{schemaVersion:1;kind:'kindcut_joy_loading_diagnostics';reportId:string;startedAt:string;heightInches:6.5|12;operationId:number|null;phase:string;active:boolean;failure:NativeJoyLoadingDiagnostics['failure'];events:NativeJoyLoadingDiagnosticEvent[];totalEvents:number;captureIncomplete:boolean;completeCapture:boolean;gaps:Array<[number,number]>;jobStarted:false}
const keys=['schemaVersion','kind','reportId','startedAt','heightInches','operationId','phase','active','failure','events','totalEvents','captureIncomplete','completeCapture','gaps','jobStarted'];
function summarize(r:NativeJoyLoadingReport){let next=1;const gaps:Array<[number,number]>=[];for(const e of r.events){if(e.seq>next)gaps.push([next,e.seq-1]);next=e.seq+1;}if(next<=r.totalEvents)gaps.push([next,r.totalEvents]);r.gaps=gaps;r.completeCapture=!r.active&&r.phase!=='not_started'&&r.totalEvents>0&&!r.captureIncomplete&&gaps.length===0;return r;}
function validate(value:unknown):NativeJoyLoadingReport{
 if(!value||typeof value!=='object'||Array.isArray(value))return bad();const x=value as Record<string,unknown>;
 if(Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k))||x.schemaVersion!==1||x.kind!=='kindcut_joy_loading_diagnostics'||!uuid(x.reportId)||typeof x.startedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x.startedAt)||!Number.isFinite(Date.parse(x.startedAt))||(x.heightInches!==6.5&&x.heightInches!==12)||typeof x.phase!=='string'||!phases.includes(x.phase)||typeof x.active!=='boolean'||typeof x.captureIncomplete!=='boolean'||typeof x.completeCapture!=='boolean'||x.jobStarted!==false||!Number.isSafeInteger(x.totalEvents)||Number(x.totalEvents)<0||!Array.isArray(x.events)||x.events.length>LIMIT||!Array.isArray(x.gaps))return bad();
 const id=x.operationId;if(id!==null&&(!Number.isSafeInteger(id)||Number(id)<1))return bad();if(id===null&&(x.events.length||x.totalEvents!==0||x.failure!==null||x.phase!=='not_started'))return bad();let previous=0,priorTime=-1;
 const events=x.events.map(raw=>{const e=raw as NativeJoyLoadingDiagnosticEvent;if(!e||!Number.isSafeInteger(e.seq)||e.seq<=previous||e.seq>Number(x.totalEvents))return bad();const clean=readLoadingDiagnostics({version:1,operationId:id,lastStage:e.stage,failure:x.failure,events:[e],totalEvents:e.seq,evictedEvents:e.seq-1,captureIncomplete:x.captureIncomplete},Number(id)).events[0]!;if(clean.atMs<priorTime)return bad();previous=clean.seq;priorTime=clean.atMs;return clean;});
 const failure=id===null?null:readLoadingDiagnostics({version:1,operationId:id,lastStage:'report',failure:x.failure,events:[],totalEvents:0,evictedEvents:0,captureIncomplete:x.captureIncomplete},Number(id)).failure;
 const result=summarize({schemaVersion:1,kind:'kindcut_joy_loading_diagnostics',reportId:x.reportId,startedAt:x.startedAt,heightInches:x.heightInches,operationId:id as number|null,phase:x.phase,active:x.active,failure,events,totalEvents:Number(x.totalEvents),captureIncomplete:x.captureIncomplete,completeCapture:false,gaps:[],jobStarted:false});
 if(JSON.stringify(result.gaps)!==JSON.stringify(x.gaps)||result.completeCapture!==x.completeCapture)return bad();return result;
}
/** Private trusted-main journal. Device-owner callbacks never perform filesystem I/O. */
export class NativeJoyLoadingJournal{
 private current:NativeJoyLoadingReport|null=null;private tail:Promise<void>=Promise.resolve();
 constructor(readonly directory:string){if(!path.isAbsolute(directory))throw Error('An absolute loading diagnostic directory is required.');}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.tail.then(run);this.tail=result.then(()=>{},()=>{});return result;}
 private async ensure(){await fs.mkdir(this.directory,{recursive:true,mode:0o700});if(!(await fs.lstat(this.directory)).isDirectory()||(await fs.lstat(this.directory)).isSymbolicLink())throw Error('Unsafe loading diagnostic directory.');await fs.chmod(this.directory,0o700);}
 private async atomic(file:string,bytes:string){const tmp=path.join(this.directory,`.${randomUUID()}.tmp`);try{await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});await fs.rename(tmp,path.join(this.directory,file));}finally{await fs.rm(tmp,{force:true});}}
 private async save(r:NativeJoyLoadingReport){const bytes=JSON.stringify(r,null,2)+'\n';if(Buffer.byteLength(bytes)>BYTES)throw Error('Loading diagnostic report exceeded its bound.');await this.atomic(`loading-${r.reportId}.json`,bytes);await this.atomic('latest.json',JSON.stringify({reportId:r.reportId})+'\n');}
 async prepare(height:6.5|12):Promise<void>{return this.serial(async()=>{if(height!==6.5&&height!==12)throw Error('Invalid loading diagnostic mat size.');await this.ensure();const r:NativeJoyLoadingReport={schemaVersion:1,kind:'kindcut_joy_loading_diagnostics',reportId:randomUUID(),startedAt:new Date().toISOString(),heightInches:height,operationId:null,phase:'not_started',active:false,failure:null,events:[],totalEvents:0,captureIncomplete:false,completeCapture:false,gaps:[],jobStarted:false};await this.save(r);this.current=r;});}
 async record(state:NativeJoyLoadingState):Promise<void>{return this.serial(async()=>{
  if(!state.diagnostics)return;if(!this.current)throw Error('No prepared loading diagnostic report.');const d=readLoadingDiagnostics(state.diagnostics,state.operationId),r=structuredClone(this.current);
  if(r.operationId!==null&&r.operationId!==d.operationId)throw Error('Loading diagnostic operation changed.');r.operationId=d.operationId;
  const bySeq=new Map(r.events.map(e=>[e.seq,e]));for(const e of d.events){const prior=bySeq.get(e.seq);if(prior&&JSON.stringify(prior)!==JSON.stringify(e))throw Error('Loading diagnostic history changed.');bySeq.set(e.seq,e);}
  r.events=[...bySeq.values()].sort((a,b)=>a.seq-b.seq);if(r.events.length>LIMIT){r.events=[...r.events.slice(0,256),...r.events.slice(-(LIMIT-256))];r.captureIncomplete=true;}
  r.totalEvents=Math.max(r.totalEvents,d.totalEvents);r.failure=r.failure??d.failure;r.phase=state.phase;r.active=state.active;r.captureIncomplete=r.captureIncomplete||d.captureIncomplete;summarize(r);validate(r);await this.save(r);this.current=r;
 });}
 private async load():Promise<NativeJoyLoadingReport>{
  const directory=await fs.lstat(this.directory),pointerPath=path.join(this.directory,'latest.json');if(!directory.isDirectory()||directory.isSymbolicLink())return bad();const pointerStat=await fs.lstat(pointerPath);if(!pointerStat.isFile()||pointerStat.isSymbolicLink()||pointerStat.size>128)return bad();
  const pointer=await fs.readFile(pointerPath,'utf8');if(pointer.length>128)return bad();const p=JSON.parse(pointer);if(!p||Object.keys(p).length!==1||!uuid(p.reportId))return bad();
  const file=path.join(this.directory,`loading-${p.reportId}.json`),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>BYTES)return bad();const report=validate(JSON.parse(await fs.readFile(file,'utf8')));if(report.reportId!==p.reportId)return bad();return report;
 }
 async restoreTerminalState():Promise<NativeJoyLoadingState|null>{return this.serial(async()=>{
  let r:NativeJoyLoadingReport;try{r=await this.load();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('Saved loading diagnostics are invalid.');}
  if(r.active||!['failed','cancelled','completed'].includes(r.phase)||r.operationId===null)return null;
  const tail:NativeJoyLoadingDiagnosticEvent[]=[];let expected=r.totalEvents;for(let i=r.events.length-1;i>=0&&tail.length<512;i--){const e=r.events[i]!;if(e.seq!==expected)break;tail.unshift(e);expected--;}
  const diagnostics=readLoadingDiagnostics({version:1,operationId:r.operationId,lastStage:tail.at(-1)?.stage??'history',failure:r.failure,events:tail,totalEvents:r.totalEvents,evictedEvents:r.totalEvents-tail.length,captureIncomplete:r.captureIncomplete||r.gaps.length>0},r.operationId);
  return{operationId:r.operationId,phase:r.phase as NativeJoyLoadingState['phase'],active:false,sessionRetired:true,physicalLoadingVerified:false,physicalAlignmentVerified:false,motionStoppedVerified:false,jobStarted:false,diagnostics,historical:true};
 });}
 async readLatest():Promise<NativeJoyLoadingReport>{return this.serial(async()=>{try{return await this.load();}catch{throw Error('Loading diagnostic report unavailable or invalid.');}});}
 async exportTo(target:string):Promise<void>{return this.serial(async()=>{if(!path.isAbsolute(target))throw Error('A host-selected diagnostic export path is required.');const report=await this.load();const bytes=JSON.stringify(report,null,2)+'\n';await fs.writeFile(target,bytes,{mode:0o600});await fs.chmod(target,0o600);const written=await fs.readFile(target);if(createHash('sha256').update(written).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw Error('Diagnostic export verification failed.');});}
}
