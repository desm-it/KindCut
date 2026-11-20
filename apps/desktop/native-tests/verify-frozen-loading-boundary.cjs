// Actual compiled CJS client + relocated frozen OWNED worker, metadata/denial only.
// No discovery, target connection, provisioning key access, movement or job request.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const{JoyRuntimeClient}=require(path.join(root,'apps/desktop/dist/main/joy-runtime-client.js'));
(async()=>{
 const runtime=process.env.KINDCUT_VERIFY_RUNTIME;
 assert(runtime&&path.isAbsolute(runtime),'Supply the owned relocated frozen runtime path');
 const client=new JoyRuntimeClient({executable:runtime,args:['--stdio']});
 try{
  const before=await client.request({op:'loading',action:'status'},5000);
  assert.equal(before.phase,'idle');assert.equal(before.active,false);assert.equal(before.jobStarted,false);
  // Explicitly denied local admission; no initialized session exists.
  await assert.rejects(()=>client.request({op:'loading',action:'start',heightInches:12,motionApproved:false,bladeRemovedConfirmed:false},5000));
  assert.equal(client.isRunning,false);
  await assert.rejects(()=>client.request({op:'loading',action:'status'},5000),/closed/);
  console.log(JSON.stringify({passed:true,compiledClient:true,relocatedFrozenWorker:true,initialPhase:before.phase,deniedAdmissionRetiresClient:true,hardwareAccess:false,scope:'metadata and denied admission only; full physical loading not exercised'}));
 }finally{await client.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
