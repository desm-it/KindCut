// Inert verification of compiled CommonJS app services and the frozen owned worker.
// Never imports Electron main, opens a device, discovers, or issues calibration/motion commands.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname,'../../..');
const compiled = path.join(root,'apps/desktop/dist/main');
const {NativeJoyService} = require(path.join(compiled,'native-joy-service.js'));
const {JoyRuntimeClient} = require(path.join(compiled,'joy-runtime-client.js'));
const {JoyConfigurationStore} = require(path.join(compiled,'joy-configuration-store.js'));
const {JoyConfigurationService} = require(path.join(compiled,'joy-configuration-service.js'));
async function main() {
 const runtime = path.join(root,'apps/desktop/resources/joy/kindcut-joy-runtime');
 assert((await fs.stat(runtime)).isFile());
 assert(process.env.TMPDIR,'Use the Hermes scratch TMPDIR, not system temp');
 const folder = await fs.mkdtemp(path.join(process.env.TMPDIR,'joy-frozen-config-'));
 const fixture = JSON.parse(await fs.readFile(path.join(root,'apps/desktop/native-tests/configuration.synthetic.json'),'utf8'));
 const commands=[];
 let secretReads=0;
 const native = new NativeJoyService({platform:'darwin',enabled:true,runtimePath:runtime,store:{exists:async()=>false,save:async()=>{throw Error('No provisioning allowed');},load:async()=>{secretReads++;throw Error('No key access allowed');}},clientFactory:()=>{
  const client=new JoyRuntimeClient({executable:runtime,args:['--stdio']});
  return {get isRunning(){return client.isRunning;},close:()=>client.close(),request:(r,timeout)=>{
   assert.equal(r.op,'configuration','Only offline configuration is permitted');commands.push(r.op);return client.request(r,timeout);
  }};
 }});
 try {
  const store = new JoyConfigurationStore(path.join(folder,'library.json'));
  const service = new JoyConfigurationService({store,offline:r=>native.runOfflineConfiguration(r),capture:async()=>{throw Error('No capture allowed');}});
  const profiles=['pen','fine_point_blade'].map(tool=>({id:tool,name:'SYNTHETIC TEST ONLY',provenance:'synthetic_test',settings:{...fixture.settings,profileId:tool,tool,operation:tool==='pen'?'draw':'cut'}}));
  await service.importLibrary({schemaVersion:1,kind:'kindcut_joy_configuration_library',profiles,calibrations:[{id:'synthetic-calibration',capturedAt:'2026-01-01T00:00:00.000Z',deviceFingerprint:'a'.repeat(64),firmwareSelector:8.164000001,source:'imported_unverified',physicalCalibrationVerified:false,pressureResponsesHex:fixture.rows}],selection:null});
  const checks=[];
  for(const tool of ['pen','fine_point_blade']) {
   await service.select({profileId:tool,calibrationId:'synthetic-calibration'});
   assert.equal((await new JoyConfigurationStore(path.join(folder,'library.json')).load()).selection.profileId,tool);
   const result=await service.compile({profileId:tool,calibrationId:'synthetic-calibration',source:{svg:'<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 360 960"><path fill="none" stroke="#112233" transform="matrix(1,0,0,1,80,80)" d="M0 0 L40 0 L40 40 Z"/></svg>',materialId:1,mat:{widthIn:4.5,heightIn:12},strokeTools:{'#112233':{tool,operation:tool==='pen'?'draw':'cut'}}}});
   assert.equal(result.execution,'unsupported');assert.equal(result.candidate.safetyValidated,false);assert.equal(result.candidate.configurationValidated,false);assert.equal(result.candidate.configurationBodyTemplates.length,3);
   const machine=Buffer.from(result.candidate.configurationBodyTemplates[0].bodyHex,'hex');assert.equal(machine[1],tool==='pen'?0x88:0x08);assert.equal(machine[10],tool==='pen'?2:0);
   checks.push({tool,bodyCount:3,flags:machine[1],mode:machine[10],execution:result.execution});
  }
  const sourceCatalog=await service.list();
  assert.equal(sourceCatalog.materials.length,173);assert.equal(new Set(sourceCatalog.materials.map(m=>m.sourceMaterialId)).size,96);
  for(const passCount of [1,2,3]) {
   const preset=sourceCatalog.materials.find(m=>m.passCount===passCount&&m.tool==='fine_point_blade'&&m.sourceMaterialId!==535);
   const adopted=await service.adopt({catalogId:preset.id,materialId:preset.sourceMaterialId,materialName:preset.name,confirmed:true});
   const profile=adopted.profiles.find(p=>p.sourceMaterialId===preset.sourceMaterialId&&p.tool===preset.tool);
   await service.select({profileId:profile.id,calibrationId:'synthetic-calibration'});
   const result=await service.compile({profileId:profile.id,calibrationId:'synthetic-calibration',source:{svg:'<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 360 960"><path fill="none" stroke="#112233" transform="matrix(1,0,0,1,80,80)" d="M0 0 L40 0 L40 40 Z"/></svg>',materialId:preset.sourceMaterialId,mat:{widthIn:4.5,heightIn:12},strokeTools:{'#112233':{tool:preset.tool,operation:'cut'}}}});
   assert.equal(result.passes.length,passCount);assert.deepEqual(result.passes.map(p=>p.pressureRequest),preset.pressureRequests);
   for(const pass of result.passes){assert.equal(pass.candidate.execution,'unsupported');assert.equal(pass.candidate.safetyValidated,false);assert.equal(pass.candidate.configurationValidated,false);assert.equal(pass.candidate.configurationBodyTemplates.length,3);assert.equal(Buffer.from(pass.candidate.configurationBodyTemplates[2].bodyHex,'hex')[2],2);}
   const stored=await new JoyConfigurationStore(path.join(folder,'library.json')).load();assert.equal(stored.profiles.find(p=>p.id===profile.id).recipe.passCount,passCount);
   checks.push({catalogId:preset.id,sourceMaterialId:preset.sourceMaterialId,passCount,pressures:result.passes.map(p=>p.pressureRequest),perPassBodies:result.passes.map(p=>p.candidate.configurationBodyTemplates.length),execution:result.execution});
  }
  assert.deepEqual(commands,Array(10).fill('configuration'));assert.equal(secretReads,0);assert.equal(native.ownsHardware,false);
  console.log(JSON.stringify({passed:true,compiledServices:true,frozenWorker:true,syntheticCalibrationOnly:true,includesSourceCatalog:true,hardwareAccess:false,secretReads,commands,checks},null,2));
 } finally {await native.disconnect();await fs.rm(folder,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
