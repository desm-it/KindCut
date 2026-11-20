import { describe,it,expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeJoyService } from "./native-joy-service";

const bundle={format:1 as const,settings8:'SENSITIVE-SETTINGS'.repeat(10),seedPrefixBase64:Buffer.alloc(33).toString('base64')};
const ready={state:'ready',machine:'cricut_joy',firmwareSelector:8.1,materialRecord:0,fallbackUsed:false,status:{status_byte_1:1,status_byte_2:2,extra_u16_raw:0,extra_u16_native:0,value_be32:3}};
async function setup(run:(s:NativeJoyService,seen:{requests:Record<string,unknown>[];saved:unknown[];loads:number})=>Promise<void>,enabled=false,importedExists=false){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kindcut-joy-service-'));const exe=path.join(dir,'runtime');await fs.writeFile(exe,'inert fixture',{mode:0o700});
 const seen={requests:[] as Record<string,unknown>[],saved:[] as unknown[],loads:0};
 const service=new NativeJoyService({platform:'darwin',enabled,runtimePath:exe,store:{exists:async()=>importedExists,save:async value=>{seen.saved.push(value);},load:async()=>{seen.loads++;return bundle;}},clientFactory:()=>({isRunning:true,close:async()=>{},request:async request=>{
   seen.requests.push(request);if(request.op==='provision')return{bundle,recordCount:22};
   return {...ready,settings8:'FORBIDDEN',status:{...ready.status,secret:'FORBIDDEN'}};
 }})});
 try{await run(service,seen);}finally{await service.disconnect();await fs.rm(dir,{recursive:true,force:true});}
}
describe('KindCut native Joy main-process service',()=>{
 it('does not silently prefer an old imported cache over the bundled default',async()=>setup(async(s,seen)=>{
   await s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true});
   expect(seen.loads).toBe(0);expect(seen.requests[0]).not.toHaveProperty('bundle');
 },true,true));
 it('uses bundled Joy profile without reading a keychain bundle when no override exists',async()=>setup(async(s,seen)=>{
   await s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true});
   expect(seen.loads).toBe(0);expect(seen.requests[0]).toMatchObject({op:'connect',profileId:'cricut-joy'});expect(seen.requests[0]).not.toHaveProperty('bundle');
 },true));
 it('cancels a pending keychain load before any late hardware connection',async()=>{
   let release!:(value:typeof bundle)=>void;let created=0;
   const load=new Promise<typeof bundle>(resolve=>{release=resolve;});
   const s=new NativeJoyService({platform:'darwin',enabled:true,preferImported:true,runtimePath:'/inert',store:{exists:async()=>true,save:async()=>{},load:()=>load},clientFactory:()=>{created++;return{isRunning:true,close:async()=>{},request:async()=>ready};}});
   const pending=s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true});
   const held=s.ownsHardware;await s.disconnect();release(bundle);
   await expect(pending).rejects.toThrow();expect(created).toBe(0);expect(held).toBe(true);expect(s.ownsHardware).toBe(false);
 });
 it('constructs and reports setup without spawning',async()=>setup(async(s,seen)=>{
   const info=await s.getStatus();expect(info.experimental).toBe(true);expect(seen.requests).toEqual([]);expect(seen.loads).toBe(0);
 }));
 it('rejects hardware while experimental backend is disabled',async()=>setup(async(s,seen)=>{
   await expect(s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true})).rejects.toThrow(/disabled/i);
   expect(seen.requests).toEqual([]);expect(seen.loads).toBe(0);
 }));
 it('requires both explicit approvals before loading provisioning',async()=>setup(async(s,seen)=>{
   await expect(s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:false})).rejects.toThrow(/approval/i);
   expect(seen.loads).toBe(0);expect(seen.requests).toEqual([]);
 },true));
 it('protects imported material and returns no bundle to the renderer',async()=>setup(async(s,seen)=>{
   const result=await s.importProvisioning({sourcePath:'/explicit/cache',approved:true});
   expect(seen.requests[0]).toEqual({op:'provision',importApproved:true,sourcePath:'/explicit/cache'});
   expect(seen.saved).toEqual([bundle]);expect(result).toEqual({recordCount:22});expect(JSON.stringify(result)).not.toContain('SENSITIVE');
 }));
 it('whitelists session metadata rather than forwarding worker objects',async()=>setup(async(s,seen)=>{
   const result=await s.connect({address:'00:11:22:33:44:55',hardwareApproved:true,cryptoResetApproved:true});
   expect(result).toEqual(ready);expect(JSON.stringify(result)).not.toContain('FORBIDDEN');expect(seen.requests[0]?.op).toBe('connect');
 },true));
 it('does not poll hardware before a session is approved',async()=>setup(async(s,seen)=>{
   await expect(s.pollStatus()).rejects.toThrow(/session/i);expect(seen.requests).toEqual([]);
 },true));
});
