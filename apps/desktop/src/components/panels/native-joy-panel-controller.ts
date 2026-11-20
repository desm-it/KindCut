import type {NativeJoySetup,NativeJoySnapshot,NativeJoyLoadingState} from '../../shell/native-joy-service';

export type NativeJoyPanelAction='refresh'|'import'|'connect'|'poll'|'disconnect'|'load'|'unload'|'startLoading'|'finishLoading'|'cancelLoading'|'export-diagnostics';
export interface NativeJoyPanelDevice {name:string;id:string;paired:boolean;connected:boolean}
export interface NativeJoyPanelApi {
  cancelMakeConnection?():Promise<{canceled:boolean}>;
  connectForMake?(address?:string):Promise<{status:'connected'|'not_found'|'choose_device';devices:Array<{name:string;id:string;paired:boolean;connected:boolean}>}|{canceled:true}>;
  devices?():Promise<NativeJoyPanelDevice[]>;
  mat?(action:'load'|'unload'):Promise<{requestAcknowledged:boolean;matPresenceVerified:false;responseCode?:number}|{canceled:true}>;
  getSetupStatus():Promise<NativeJoySetup>;
  importProvisioning():Promise<{recordCount:number}|{canceled:true}>;
  connect(address:string):Promise<NativeJoySnapshot|{canceled:true}>;
  pollStatus():Promise<NativeJoySnapshot>;
  disconnect():Promise<unknown>;
  loadingStart?(height:6.5|12):Promise<NativeJoyLoadingState|{canceled:true}>;
  loadingStatus?():Promise<NativeJoyLoadingState>;
  loadingGo?():Promise<NativeJoyLoadingState>;
  loadingCancel?():Promise<NativeJoyLoadingState>;
  exportLoadingDiagnostics?():Promise<{canceled:boolean}>;
}
export type NativeJoyConnectionNotice='connect_failed'|'not_found'|'search_failed'|null;
export interface NativeJoyPanelState {
  connectionCancelling?:boolean;connectionNotice:NativeJoyConnectionNotice;setup:NativeJoySetup|null;busy:boolean;address:string;error:string;message:string;
  loading:NativeJoyLoadingState|null;height:6.5|12;devices:NativeJoyPanelDevice[];
}
export const nativeJoyPanelInitialState=():NativeJoyPanelState=>({connectionNotice:null,setup:null,busy:false,address:'',error:'',message:'',loading:null,height:12,devices:[]});

/** UI lifecycle only. Every hardware decision/approval stays in the main process. */
export class NativeJoyPanelController {
  private state=nativeJoyPanelInitialState();
  private live=false;
  private connectionEpoch=0;
  private connectionPending=false;
  private owned=false;
  private disposalCancelIssued=false;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private pollPending:Promise<void>|null=null;
  constructor(private readonly api:NativeJoyPanelApi|undefined,private readonly change:(s:NativeJoyPanelState)=>void){}
  get snapshot():NativeJoyPanelState{return {...this.state,devices:[...this.state.devices],loading:this.state.loading?{...this.state.loading}:null};}
  private set(update:Partial<NativeJoyPanelState>){if(!this.live)return;this.state={...this.state,...update};this.change(this.snapshot);}
  async mount(){this.live=true;await this.metadata();if(this.api?.loadingStatus){try{const status=await this.api.loadingStatus();if(this.live)this.accept(status);}catch{/* Old/inert peers may not have persisted loading state. */}}}
  dispose(){
    this.live=false;this.clearTimer();
    if(this.owned&&this.state.loading?.active)this.cancelDisposedOwner();
  }
  private cancelDisposedOwner(){
    if(this.disposalCancelIssued||!this.api?.loadingCancel)return;
    this.disposalCancelIssued=true;
    void this.api.loadingCancel().catch(()=>{});
  }
  setAddress(address:string){this.set({address});}
  setHeight(height:6.5|12){if(height!==6.5&&height!==12)throw Error('Unsupported mat size.');if(!this.state.loading?.active)this.set({height});}
  private clearTimer(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;}
  private schedule(){
    this.clearTimer();
    if(this.live&&this.owned&&this.state.loading?.active&&!this.state.busy&&this.api?.loadingStatus){
      this.timer=setTimeout(()=>this.poll(),500);
    }
  }
  private poll(){
    this.timer=null;
    if(!this.live||!this.owned||!this.state.loading?.active)return;
    // Explicit actions wait for an in-flight poll. Their finally always
    // reschedules, so a tick during a slow dialog/Go cannot lose polling.
    if(this.state.busy){return;}
    this.pollPending=this.readStatus();
    void this.pollPending.finally(()=>{this.pollPending=null;this.schedule();});
  }
  private async readStatus(){
    try{
      const status=await this.api!.loadingStatus!();
      if(!this.live)return;
      if(status.operationId!==this.state.loading?.operationId)throw Error('Stale loading view.');
      this.accept(status);
      if(!status.active)await this.metadata();
    }catch{this.set({error:'Could not read alignment status. Use Disconnect to retire the session. Physical stopping is not verified.'});}
  }
  private accept(status:NativeJoyLoadingState){
    this.owned=status.active;
    this.set({loading:status});
    if(!status.active){
      const retirement=status.sessionRetired?'Session retired.':'Session retirement has not been verified.';
      const message=status.phase==='completed'?`Loading session ended. ${retirement} No job was started; physical mat ejection and alignment are unverified.`
        :status.phase==='cancelled'?`Loading canceled. ${retirement} Physical motion stopping is not verified.`
        :status.phase==='failed'?`Loading failed. ${retirement} Physical loading, alignment and stopping are not verified.`
        :`Loading session did not complete. ${retirement} Physical loading, alignment and stopping are not verified.`;
      this.set({message});
    }
  }
  private async metadata(epoch?:number){
    if(!this.api||!this.live)return;
    try{const setup=await this.api.getSetupStatus();if(epoch===undefined||epoch===this.connectionEpoch)this.set({setup});}
    catch{if(epoch===undefined||epoch===this.connectionEpoch)this.set({error:'Could not read local Native Joy setup metadata.'});}
  }
  async cancelConnection(){
    if(!this.live||!this.connectionPending||this.state.connectionCancelling||!this.api?.cancelMakeConnection)return;
    const epoch=++this.connectionEpoch;this.connectionPending=false;this.set({busy:true,connectionCancelling:true,error:'',connectionNotice:null});
    try{const result=await this.api.cancelMakeConnection();if(epoch!==this.connectionEpoch||!this.live)return;await this.metadata(epoch);this.set({message:result.canceled?'Connection attempt canceled.':'Connection attempt already ended; the existing session was left unchanged.'});}
    catch{if(epoch===this.connectionEpoch)this.set({error:'Could not safely retire the connection attempt. The existing owner was not replaced.',connectionNotice:'connect_failed'});}
    finally{if(epoch===this.connectionEpoch)this.set({busy:false,connectionCancelling:false});}
  }
  async connectForMake(){
    if(!this.live||this.state.busy||this.state.setup?.session||this.state.loading?.active)return;
    if(!this.api?.connectForMake){this.set({error:'Automatic connection needs the updated desktop runtime.'});return;}
    const epoch=++this.connectionEpoch;this.connectionPending=true;this.set({busy:true,error:'',message:'',connectionNotice:null,connectionCancelling:false});
    try{
      const result=await this.api.connectForMake(this.state.devices.length>1&&this.state.address?this.state.address:undefined);
      if(!this.live||epoch!==this.connectionEpoch)return;
      if('canceled'in result){this.set({message:'Connection canceled.'});return;}
      const devices=result.devices,address=devices.some(d=>d.id===this.state.address)?this.state.address:devices.length===1?devices[0]!.id:'';
      this.set({devices,address,connectionNotice:result.status==='not_found'?'not_found':null});await this.metadata(epoch);
    }catch{if(this.live&&epoch===this.connectionEpoch){this.set({connectionNotice:'connect_failed',error:''});await this.metadata(epoch);}}
    finally{if(epoch===this.connectionEpoch){this.connectionPending=false;this.set({busy:false});}}
  }
  async run(action:NativeJoyPanelAction){
    if(!this.live||this.state.busy)return;
    if(this.state.loading?.active&&!['finishLoading','cancelLoading','disconnect'].includes(action))return;
    if(action==='export-diagnostics'&&this.state.loading?.active)return;
    const api=this.api;if(!api){this.set({error:'Native setup is available only in the KindCut desktop app.'});return;}
    this.set({busy:true,error:'',message:'',...(['refresh','connect','disconnect'].includes(action)?{connectionNotice:null}:{})});
    try{
      await this.pollPending;
      if(!this.live)return;
      let result:unknown;
      if(action==='export-diagnostics'){
        if(!api.exportLoadingDiagnostics)throw Error('Loading diagnostics export is unavailable.');
        const outcome=await api.exportLoadingDiagnostics();if(!this.live)return;
        this.set({message:outcome.canceled?'Diagnostics export canceled. No file was saved.':'Loading diagnostics exported.'});
      }else if(action==='startLoading'||action==='load'){
        if(!api.loadingStart)throw Error('Experimental loading is unavailable.');
        this.set({loading:null});
        result=await api.loadingStart(this.state.height);
        if(!this.live){
          // An approval/start may finish after the component was removed.
          // Its owner was not yet known at dispose(), so retire it now.
          if(result&&typeof result==='object'&&'active'in result&&result.active===true)this.cancelDisposedOwner();
          return;
        }
        if(result&&typeof result==='object'&&'canceled'in result&&result.canceled===true){
          this.set({message:'Alignment setup canceled. No sequence was started.'});return;
        }
        this.accept(result as NativeJoyLoadingState);
      }else if(action==='finishLoading'||action==='cancelLoading'){
        if(!this.state.loading?.active)return;
        if(action==='finishLoading'){
          if(!api.loadingGo||this.state.loading.phase!=='waiting_for_go')return;
          result=await api.loadingGo();
        }else{
          if(!api.loadingCancel)throw Error('Cancel control unavailable.');
          result=await api.loadingCancel();
        }
        if(!this.live)return;
        const status=result as NativeJoyLoadingState;this.accept(status);
        if(status.active)this.set({message:action==='finishLoading'?'Finishing the check; waiting for session cleanup. No job has started.':'Cancellation requested; waiting for cleanup. This is not a guaranteed emergency stop.'});
        else await this.metadata();
      }else if(action==='refresh'){
        if(api.devices){const devices=await api.devices();if(!this.live)return;
          const address=devices.some(v=>v.id===this.state.address)?this.state.address:devices.length===1?devices[0]!.id:'';
          this.set({devices,address,connectionNotice:devices.length?null:'not_found'});}
      }else{
        if(action==='import')result=await api.importProvisioning();
        else if(action==='connect')result=await api.connect(this.state.address);
        else if(action==='poll')result=await api.pollStatus();
        else if(action==='disconnect')result=await api.disconnect();
        else if(action==='unload'){
          if(!api.mat)throw Error('Mat controls need the updated desktop runtime.');
          result=await api.mat('unload');
        }
        if(!this.live)return;
        if(result&&typeof result==='object'&&'canceled'in result&&result.canceled===true){
          this.set({message:'Canceled. No backend switch or automatic retry was performed.'});
        }else if(action==='disconnect'){
          this.owned=false;this.set({message:'Native session disconnected. Physical stopping is not verified.'});
        }else if(action==='connect')this.set({message:'Native session connected.'});
        else if(action==='poll')this.set({message:'Device status updated.'});
        else if(result&&typeof result==='object'&&'recordCount'in result)this.set({message:`Provisioning saved: ${Number(result.recordCount)} records.`});
      }
      if(!action.endsWith('Loading'))await this.metadata();
    }catch{
      if(action==='connect'||action==='refresh')this.set({connectionNotice:action==='connect'?'connect_failed':'search_failed',error:''});
      else this.set({error:action.endsWith('Loading')?'Experimental alignment action failed. Use Disconnect if ownership is uncertain. Physical stopping is not verified.':'Native Joy request failed. Check setup; no automatic retry was made.'});
      await this.metadata();
    }finally{this.set({busy:false});this.schedule();}
  }
}
