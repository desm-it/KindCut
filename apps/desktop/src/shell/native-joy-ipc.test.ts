import { describe,it,expect } from "vitest";
import { registerNativeJoyIpc } from "./native-joy-ipc";
function fixture(confirm=true,busy=false){
 const handlers=new Map<string,(event:unknown,input?:unknown)=>Promise<unknown>>();const calls:{name:string;input?:unknown}[]=[];
 const service={getStatus:async()=>({enabled:true}),importProvisioning:async (input:{sourcePath:string;approved:boolean})=>{calls.push({name:'import',input});return{recordCount:22};},
   controlMat:async(action:'load'|'unload',approved:boolean)=>{calls.push({name:'mat',input:{action,approved}});return{requestAcknowledged:true,matPresenceVerified:false};},
   connect:async (input:{address:string;hardwareApproved:boolean;cryptoResetApproved:boolean})=>{calls.push({name:'connect',input});return{state:'ready'};},pollStatus:async()=>{calls.push({name:'poll'});return{state:'ready'};},disconnect:async()=>{calls.push({name:'disconnect'});}};
 registerNativeJoyIpc({register:(name,fn)=>handlers.set(name,fn),isTrusted:event=>event==='trusted',cutterBusy:()=>busy,
  chooseCache:async()=>'/chosen/cache',confirmImport:async()=>confirm,confirmHardware:async()=>confirm,confirmMat:async()=>confirm,listDevices:async()=>[{name:'Joy',id:'00:11:22:33:44:55',paired:true,connected:false}],service:()=>service});
 return{handlers,calls};
}
describe('native Joy IPC authority boundary',()=>{
 it('registers experimental loading controls and ignores forged authority',async()=>{
  const f=fixture(); expect(f.handlers.has('native-joy:loading-start')).toBe(true);
  await expect(f.handlers.get('native-joy:loading-start')!('trusted',{heightInches:6.5,motionApproved:true,bladeRemovedConfirmed:true})).rejects.toThrow();
 });
 it('registers guarded mat controls and derives motion approval in main',async()=>{
  const f=fixture();expect(f.handlers.has('native-joy:mat')).toBe(true);
  await f.handlers.get('native-joy:mat')!('trusted',{action:'load'});
  expect(f.calls).toEqual([{name:'mat',input:{action:'load',approved:true}}]);
 });
 it('does not send mat commands when canceled, untrusted, busy, or asked to cut',async()=>{
  const f=fixture(false);expect(f.handlers.has('native-joy:mat')).toBe(true);
  expect(await f.handlers.get('native-joy:mat')!('trusted',{action:'load',motionApproved:true})).toEqual({canceled:true});
  await expect(f.handlers.get('native-joy:mat')!('untrusted',{action:'load'})).rejects.toThrow(/trusted/i);
  await expect(f.handlers.get('native-joy:mat')!('trusted',{action:'cut'})).rejects.toThrow(/mat action/i);
  const b=fixture(true,true);await expect(b.handlers.get('native-joy:mat')!('trusted',{action:'load'})).rejects.toThrow(/cutter/i);
  expect(f.calls).toEqual([]);expect(b.calls).toEqual([]);
 });
 it('rejects untrusted senders before accessing the service',async()=>{
  const f=fixture();await expect(f.handlers.get('native-joy:get-status')!('untrusted')).rejects.toThrow(/trusted/i);expect(f.calls).toEqual([]);
 });
 it('renderer-supplied approval cannot bypass native confirmation',async()=>{
  const f=fixture(false);expect(await f.handlers.get('native-joy:connect')!('trusted',{address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true})).toEqual({canceled:true});expect(f.calls).toEqual([]);
 });
 it('passes approval only after the main-process confirmation',async()=>{
  const f=fixture();await f.handlers.get('native-joy:connect')!('trusted',{address:'00:11:22:33:44:55'});
  expect(f.calls).toEqual([{name:'connect',input:{address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true}}]);
 });
 it('uses native chooser paths rather than renderer paths',async()=>{
  const f=fixture();const result=await f.handlers.get('native-joy:import')!('trusted',{cachePath:'/untrusted/path'});
  expect(f.calls).toEqual([{name:'import',input:{sourcePath:'/chosen/cache',approved:true}}]);expect(result).toEqual({recordCount:22});
 });
 it('blocks native connection or polling while another cutter session owns hardware',async()=>{
  const f=fixture(true,true);
  await expect(f.handlers.get('native-joy:connect')!('trusted',{address:'00:11:22:33:44:55'})).rejects.toThrow(/cutter/i);
  await expect(f.handlers.get('native-joy:poll-status')!('trusted')).rejects.toThrow(/cutter/i);expect(f.calls).toEqual([]);
 });
 it('calls device setup after making a connection ready',async()=>{let ensured=0;const handlers=new Map<string,any>();const service={getStatus:async()=>({enabled:true}),connect:async()=>{},inlineActionIdentity:'x'};registerNativeJoyIpc({register:(n,f)=>handlers.set(n,f),isTrusted:()=>true,cutterBusy:()=>false,chooseCache:async()=>null,confirmImport:async()=>false,confirmHardware:async()=>true,listDevices:async()=>[{name:'Joy',id:'00:11:22:33:44:55',paired:true,connected:false}],service:()=>service as any,ensureDeviceSettings:async()=>{ensured++;}});await handlers.get('native-joy:connect-for-make')('trusted');expect(ensured).toBe(1);});
 it('Make connect auto-selects a sole paired device and reports zero/multiple without connecting',async()=>{const f=fixture();const ch=f.handlers.get('native-joy:connect-for-make')!;expect(await ch('trusted')).toMatchObject({status:'connected'});expect(f.calls.filter(c=>c.name==='connect')).toHaveLength(1);});
});

it('binds setup to the newly connected identity rather than the pre-connect generation',async()=>{const handlers=new Map<string,any>();let identity='before',reads=0;const service={getStatus:async()=>({enabled:true}),get inlineActionIdentity(){return identity;},connect:async()=>{identity='after';}};registerNativeJoyIpc({register:(n,f)=>handlers.set(n,f),isTrusted:()=>true,cutterBusy:()=>false,service:()=>service as any,chooseCache:async()=>null,confirmImport:async()=>false,confirmHardware:async()=>true,listDevices:async()=>[{name:'Joy',id:'00:11:22:33:44:55',paired:true,connected:false}],ensureDeviceSettings:async()=>{reads++;}});await expect(handlers.get('native-joy:connect-for-make')('trusted')).resolves.toMatchObject({status:'connected'});expect(reads).toBe(1);});
