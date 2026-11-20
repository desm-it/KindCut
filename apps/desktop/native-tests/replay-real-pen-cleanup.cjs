/* Captured physical trial -> actual DTO reader + actual source view. NO DEVICE I/O. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const repo=path.resolve(__dirname,'../../..'),input=path.resolve(process.argv[2]||'');assert(process.argv[2]&&path.isAbsolute(input));
 const report=JSON.parse(await fs.readFile(input,'utf8'));
 const{readJobState}=require(path.join(repo,'apps/desktop/dist/main/native-joy-job-types.js'));
 const state=readJobState(report.state);assert.equal(state.phase,'failed');assert.equal(state.acceptedRecords,20);assert.equal(state.completedPasses,1);assert.equal(state.diagnostics.failure.stage,'disarming');assert.equal(state.diagnostics.failure.code,'cleanup_failed');assert.equal(state.diagnostics.failure.errorType,'TimeoutError');assert.equal(report.completeCapture,true);assert.deepEqual(report.gaps,[]);
 const{createServer}=await import('vite'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const server=await createServer({root:path.join(repo,'apps/desktop'),server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
 try{
  const{NativeJoyJobView}=await server.ssrLoadModule('/src/components/panels/NativeJoyJobPanel.tsx');const{initialJobPanel}=await server.ssrLoadModule('/src/components/panels/native-joy-job-controller.ts');
  const html=renderToStaticMarkup(React.createElement(NativeJoyJobView,{state:{...initialJobPanel(),job:state},setup:null,available:true,onAction:()=>{throw Error('Replay cannot perform actions');}}));
  assert(html.includes('Drawing protocol completed; session cleanup failed'));assert(html.includes('Do not repeat the drawing automatically'));assert(!html.includes('Job stage: failed'));
  console.log(JSON.stringify({passed:true,capturedRealTrial:true,sourceReportId:report.reportId,records:20,passes:1,totalCapturedEvents:report.totalEvents,completeCapture:true,originalCleanupErrorPreserved:state.diagnostics.failure,actualDtoAndSourceViewUsed:true,noDeviceOrSessionOpened:true,physicalCalibrationVerified:false}));
 }finally{await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
