import {describe,it,expect} from 'vitest';
import {registerNativeJoyConfigurationIpc} from './native-joy-configuration-ipc';
function harness(){const handlers=new Map<string,(e:unknown,i?:unknown)=>Promise<unknown>>();let trusted=true,approved=true,busy=false,context=1,captures=0,stored=0,dialog:()=>Promise<boolean>=async()=>approved;
 const native={loadingApprovalContext:()=>context,captureCalibration:async(a:boolean,c:number)=>{if(!a||c!==context)throw new Error('stale');captures++;return {} as any;}};
 const service={storeCalibration:async()=>{stored++;return {};},list:async()=>({profiles:[]})} as any;
 registerNativeJoyConfigurationIpc({register:(n,h)=>handlers.set(n,h),isTrusted:()=>trusted,cutterBusy:()=>busy,service:()=>service,native:()=>native,confirmRead:()=>dialog(),readImport:async()=>null,writeExport:async()=>false});
 return {call:(name:string,input?:unknown)=>handlers.get(`native-joy:configuration-${name}`)!({},input),get captures(){return captures;},get stored(){return stored;},untrust:()=>{trusted=false;},deny:()=>{approved=false;},changeDuringApproval:()=>{dialog=async()=>{context++;return true;};},competeDuringApproval:()=>{dialog=async()=>{busy=true;return true;};}};
}
describe('trusted configuration IPC',()=>{
 it('rejects untrusted access and renderer-supplied approvals/table bytes',async()=>{const h=harness();await expect(h.call('capture',{readApproved:true})).rejects.toThrow();expect(h.captures).toBe(0);h.untrust();await expect(h.call('list')).rejects.toThrow();});
 it('does nothing on denied approval',async()=>{const h=harness();h.deny();expect(await h.call('capture')).toEqual({canceled:true});expect(h.captures).toBe(0);});
 it('binds approval before the modal and rejects changed session/legacy ownership',async()=>{for(const how of ['changeDuringApproval','competeDuringApproval']as const){const h=harness();h[how]();await expect(h.call('capture')).rejects.toThrow();expect(h.captures).toBe(0);expect(h.stored).toBe(0);}});
 it('stores only the host-approved captured result',async()=>{const h=harness();await h.call('capture');expect(h.captures).toBe(1);expect(h.stored).toBe(1);});
});
