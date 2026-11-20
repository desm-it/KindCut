import type {NativeConfigurationSource,NativeConfigurationCatalog} from '../../native-joy-configuration-types';
import type {NativeJobMetadata,NativeJobState} from '../../shell/native-joy-job-types';
import type {NativeJobRecoveryInfo} from '../../shell/native-joy-job-recovery';
export type JobPreview=NativeJobMetadata&{jobId:string};
export type JobDisplay=NativeJobState&{historical?:true};
export interface NativeJobApi {
 jobPrepareAutomatic?(source:NativeConfigurationSource):Promise<JobPreview>;
 jobArmNext?(input:{jobId:string;source:NativeConfigurationSource}):Promise<NativeJobState>;
 jobPrepare(input:{profileId:string;calibrationId:string;source:NativeConfigurationSource}):Promise<JobPreview>;
 jobStart(input:{jobId:string;source:NativeConfigurationSource}):Promise<NativeJobState|{canceled:true}>;
 jobEnd?():Promise<NativeJobState|{canceled:true}>;
 jobPause?():Promise<NativeJobState>;jobResume?():Promise<NativeJobState|{canceled:true}>;
 jobGo():Promise<NativeJobState|{canceled:true}>;jobCancel():Promise<NativeJobState>;jobStatus():Promise<JobDisplay>;
 jobInvalidate():Promise<unknown>;exportJobDiagnostics():Promise<{canceled:boolean}>;
 configurationList():Promise<NativeConfigurationCatalog>;
 jobRecoveryInfo?():Promise<NativeJobRecoveryInfo|null>;
}
export interface JobPanelState {cancelPending?:boolean;job:JobDisplay|null;preview:JobPreview|null;busy:boolean;stale:boolean;message:string;error:string;recovery:NativeJobRecoveryInfo|null;pausePending:boolean;resumePending:boolean;endPending:boolean}
export const initialJobPanel=():JobPanelState=>({job:null,preview:null,busy:false,stale:false,message:'',error:'',recovery:null,pausePending:false,resumePending:false,endPending:false,cancelPending:false});
export function nativeJobApi(value:unknown):NativeJobApi|undefined {
 if(!value||typeof value!=='object')return undefined;
 return ['jobPrepare','jobStart','jobGo','jobCancel','jobStatus','jobInvalidate','exportJobDiagnostics','configurationList'].every(k=>typeof(value as Record<string,unknown>)[k]==='function')?value as NativeJobApi:undefined;
}
export class NativeJobController {
 state=initialJobPanel();private disposed=false;private revision=0;private action=0;private timer:ReturnType<typeof setTimeout>|null=null;
 constructor(private readonly api:NativeJobApi|undefined,private readonly change:(s:JobPanelState)=>void,private readonly source:()=>Promise<NativeConfigurationSource>){}
 private emit(patch:Partial<JobPanelState>){if(this.disposed)return;this.state={...this.state,...patch};this.change(this.state);}
 async mount(){if(!this.api){this.emit({error:'Native job API unavailable in this build.'});return;}await this.refresh();}
 private async refresh(){
  if(this.disposed||!this.api)return;
  try{const epoch=this.action,job=await this.api.jobStatus();if(epoch!==this.action||this.disposed)return;if(this.state.job?.active&&job.phase==='idle')throw Error('Active job state disappeared.');if(this.state.job?.active&&job.active&&job.operationId<this.state.job.operationId)return;if(!this.disposed)this.emit({job,...(!job.active?{endPending:false,cancelPending:false}:{}),...(job.phase==='paused'||!job.active?{pausePending:false}:{}),...(!job.active||job.phase!=='paused'?{resumePending:false}:{})});if(!job.active&&this.api.jobRecoveryInfo){const recovery=await this.api.jobRecoveryInfo();if(!this.disposed)this.emit({recovery});}}
  catch{this.emit({error:'Job status or diagnostic persistence failed. Keep clear; stopping is not verified.'});}
  finally{if(!this.disposed&&this.state.job?.active){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.refresh();},300);}}
 }
 invalidate(){
  this.revision++;this.emit({preview:null,stale:Boolean(this.state.job?.active),message:this.state.job?.active?(String(this.state.job.phase)==='retained_ready'?'Workspace changed. The completed action is immutable; the mat session remains retained. Prepare the next explicit action.':'The workspace changed. The admitted job is immutable; cancel before preparing another design.'):''});
  void this.api?.jobInvalidate().catch(()=>{this.emit({error:'Could not invalidate the prepared job; do not start it.'});});
 }
 async run(action:'arm-next'|'prepare'|'start'|'go'|'pause'|'resume'|'end'|'cancel'|'export'){
  if(!this.api||this.disposed||(action==='cancel'&&this.state.cancelPending))return;if(this.state.busy&&action!=='cancel')return;
  const request=++this.action,revision=this.revision;this.emit({busy:true,error:'',message:''});
  try{
   if(action==='prepare'){
    const source=await this.source();let preview:JobPreview;
    if(this.api.jobPrepareAutomatic)preview=await this.api.jobPrepareAutomatic(source);
    else{
     const catalog=await this.api.configurationList(),selection=catalog.selection;
     if(!selection)throw Error('Choose and save a matching pen or fine-point blade profile and calibration first.');
     const profile=catalog.profiles.find(p=>p.id===selection.profileId);
     if(!profile||!['pen','fine_point_blade'].includes(profile.tool)||profile.materialId!==source.materialId||!catalog.calibrations.some(c=>c.id===selection.calibrationId))throw Error('The saved pen/blade profile must match this workspace material exactly.');
     if(revision!==this.revision)throw Error('Workspace changed during preparation.');
     preview=await this.api.jobPrepare({...selection,source});
    }
    if(revision!==this.revision||this.disposed)return;
    this.emit({preview,stale:false,message:preview.workflow?(preview.workflow.actionIndex===0?'Combined job frozen: all tool recipes and paths are bound. Load with an EMPTY clamp; pen first, then a separately confirmed blade change.':'The next frozen tool is prepared; completed pen paths will NOT be redrawn. Arm it, observe stopped motion, install its blade and approve a new Go.'):preview.tool==='fine_point_blade'?'Blade tool plan prepared: all paths and saved material passes are frozen. Load with blade removed, then confirm blade installation separately.':this.state.job?.active&&String(this.state.job.phase)==='retained_ready'?'Next pen action prepared for the retained mat; arm it, then separately confirm Go. This includes ALL current pen paths—exclude previous artwork unless redrawing is intentional.':'Experimental pen program prepared. Connect the same Joy, then explicitly load and align.'});
   }else if(action==='arm-next'){
    const j=this.state.job,p=this.state.preview;
    if(!this.api.jobArmNext||!j?.active||j.historical||j.phase!=='retained_ready'||!j.workflow||!p?.workflow||p.workflow.actionIndex!==j.workflow.actionIndex+1||this.state.stale)throw Error('No unchanged frozen next tool can be armed.');
    const source=await this.source();if(revision!==this.revision)throw Error('Workspace changed before next tool.');
    const result=await this.api.jobArmNext({jobId:p.jobId,source});
    if(revision!==this.revision||this.disposed)return;
    this.emit({job:result,preview:null,message:''});
   }else if(action==='start'){
    const preview=this.state.preview;if(!preview||this.state.stale)throw Error('Prepare the current design again first.');
    const source=await this.source();if(revision!==this.revision)throw Error('Workspace changed before loading.');
    const held=this.state.job?.active&&String(this.state.job.phase)==='retained_ready';
    const result=await this.api.jobStart({jobId:preview.jobId,source});if(request!==this.action||this.disposed)return;
    if('canceled'in result)this.emit({message:'Load approval declined; no loading request was sent.'});
    else this.emit({job:{...result,...(preview.workflow?{workflow:preview.workflow}:{})},preview:null,message:held?'New tool armed on the retained mat; no reloading or redrawing. Confirm its matching tool and clearance with a fresh Go.':'Leave the mat out until the live insertion cue.'});
   }else if(action==='go'){
    if(!this.state.job?.active||this.state.job.historical||this.state.job.phase!=='waiting_for_go'||this.state.stale)throw Error('No current unchanged job is waiting for its tool confirmation.');
    const result=await this.api.jobGo();if(request!==this.action||this.disposed)return;
    if('canceled'in result)this.emit({message:'Tool start declined; the loaded session remains held. Cancel when finished.'});
    else this.emit({job:result,message:this.state.job?.tool==='fine_point_blade'?'Native restricted cut admitted. Keep clear; physical stopping is not verified.':'Native pen job admitted. Keep clear; physical stopping is not verified.'});
   }else if(action==='pause'){
    const job=this.state.job;if(!job?.active||job.tool!=='pen'||Boolean(job.workflow?.containsBlade)||job.historical||!job.jobStarted||!['setting_up','sending','draining'].includes(job.phase)||this.state.pausePending||this.state.resumePending||!this.api.jobPause)throw Error('No live queue can be paused.');
    const result=await this.api.jobPause();if(request!==this.action||this.disposed)return;this.emit({job:result,pausePending:result.active&&!['paused','pausing'].includes(result.phase),message:'Queue pause requested. Buffered motion may continue; do not touch the machine.'});
   }else if(action==='resume'){
    if(!this.state.job?.active||this.state.job.tool!=='pen'||Boolean(this.state.job.workflow?.containsBlade)||this.state.job.historical||this.state.job.phase!=='paused'||this.state.stale||this.state.resumePending||!this.api.jobResume)throw Error('No unchanged healthy live queue can resume.');
    const result=await this.api.jobResume();if(request!==this.action||this.disposed)return;if('canceled'in result)this.emit({message:'Resume clearance declined; queue remains held subject to the original deadline.'});
    else this.emit({job:result,resumePending:result.active&&result.phase==='paused',message:'Resume requested on the same owned pen program. Keep clear.'});
   }else if(action==='end'){
    if(!this.state.job?.active||this.state.job.historical||String(this.state.job.phase)!=='retained_ready'||this.state.endPending||!this.api.jobEnd)throw Error('No live completed-action mat session can be ended.');
    const result=await this.api.jobEnd();if(request!==this.action||this.disposed)return;if('canceled'in result)this.emit({message:'End declined; loaded mat session remains retained.'});
    else{this.revision++;this.emit({job:result,preview:null,endPending:result.active,message:'Explicit End requested. Cleanup may move or eject; observe the machine, and do not repeat it.'});}
   }else if(action==='cancel'){
    this.revision++;this.emit({preview:null});
    if(!this.state.job?.active||this.state.job.historical)throw Error('No live job to cancel.');
    this.emit({cancelPending:true});const result=await this.api.jobCancel();if(request!==this.action||this.disposed)return;this.emit({job:result,cancelPending:result.active,message:result.sessionRetired?'Cancellation finished; the owned connection was retired. Physical stopping is not verified.':'Stopping the owned job and closing its connection; keep clear. Physical stopping is not guaranteed.'});
   }else{
    if(this.state.job?.active)throw Error('End the job before exporting diagnostics.');
    const result=await this.api.exportJobDiagnostics();this.emit({message:result.canceled?'Diagnostic export canceled.':'Diagnostic report exported and read back.'});
   }
  }catch(error){if(request===this.action)this.emit({error:error instanceof Error?error.message:'Experimental native job failed.'});}
  finally{if(request===this.action)this.emit({busy:false});if(!this.disposed&&this.state.job?.active)void this.refresh();}
 }
 dispose(){this.disposed=true;if(this.timer)clearTimeout(this.timer);this.timer=null;this.revision++;void this.api?.jobInvalidate().catch(()=>{});}
}
