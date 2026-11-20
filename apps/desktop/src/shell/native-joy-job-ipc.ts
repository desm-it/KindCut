export interface NativeJoyJobIpcDependencies {
 register(name:string,handler:(event:unknown,input?:unknown)=>Promise<unknown>):void;
 isTrusted(event:unknown):boolean;
 service():{prepareAutomatic?(source:unknown):Promise<unknown>;prepare(input:unknown):Promise<unknown>;start(input:unknown):Promise<unknown>;armNext?(input:unknown):Promise<unknown>;go():Promise<unknown>;pause?():Promise<unknown>;resume?():Promise<unknown>;end?():Promise<unknown>;cancel():Promise<unknown>;status():Promise<unknown>;invalidate():void};
 restoreHistory?():Promise<unknown|null>;
 recoveryInfo?():Promise<unknown|null>;
 canExport():boolean;export():Promise<{canceled:boolean}>;
}
function closed(input:unknown,keys:string[]){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid native job request.');
 const x=input as Record<string,unknown>;
 if(Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))throw Error('Unexpected native job request fields.');
 return x;
}
/** Narrow trusted-main interface: no raw packets, file paths or approval flags. */
export function registerNativeJoyJobIpc(d:NativeJoyJobIpcDependencies){
 const add=(name:string,keys:string[]|null,run:(input?:unknown)=>Promise<unknown>)=>{
  d.register(`native-joy:job-${name}`,async(event,input)=>{
   if(!d.isTrusted(event))throw Error('Trusted main-frame sender required.');
   if(keys)closed(input,keys);else if(input!==undefined)throw Error('No renderer fields accepted.');
   return run(input);
  });
 };
 add('prepare-auto',['source'],v=>{const s=d.service();if(!s.prepareAutomatic)throw Error('Automatic preparation unavailable.');return s.prepareAutomatic((v as {source:unknown}).source);});
 add('prepare',['profileId','calibrationId','source'],v=>d.service().prepare(v));
 add('start',['jobId','source'],v=>d.service().start(v));
 add('arm-next',['jobId','source'],v=>{const s=d.service();if(!s.armNext)throw Error('Frozen next-action arming unavailable.');return s.armNext(v);});
 add('go',null,()=>d.service().go());
 add('pause',null,()=>{const s=d.service();if(!s.pause)throw Error('Queue pause unavailable.');return s.pause();});
 add('resume',null,()=>{const s=d.service();if(!s.resume)throw Error('Queue resume unavailable.');return s.resume();});
 add('end',null,()=>{const s=d.service();if(!s.end)throw Error('Explicit loaded-session End unavailable.');return s.end();});
 add('cancel',null,()=>d.service().cancel());
 add('recovery-info',null,()=>d.recoveryInfo?d.recoveryInfo():Promise.resolve(null));
 add('status',null,async()=>{const s=await d.service().status();return (s as {phase?:string}).phase==='idle'&&d.restoreHistory?await d.restoreHistory()??s:s;});
 add('invalidate',null,async()=>{d.service().invalidate();return{invalidated:true};});
 add('export',null,()=>{if(!d.canExport())throw Error('Retire all cutter sessions before diagnostic export.');return d.export();});
}
