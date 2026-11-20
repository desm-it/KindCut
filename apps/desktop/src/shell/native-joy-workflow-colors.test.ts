import{it,expect}from'vitest';import{readJobMetadata}from'./native-joy-job-types';
const meta:any={programDigest:'a'.repeat(64),tool:'pen',operation:'draw',materialId:211,passCount:1,recordCount:2,pressureRequests:[100],heightInches:12,physicalCalibrationVerified:false,workflow:{actionIndex:0,actionCount:2,containsBlade:false,actions:['#112233','#445566'].map(color=>({tool:'pen',profileId:'p',profileName:'Pen',color,passCount:1,pressureRequests:[100]}))}};
it('preserves the exact colour of each frozen pen step',()=>{expect(readJobMetadata(meta).workflow!.actions.map(a=>a.color)).toEqual(['#112233','#445566']);});
it('rejects arbitrary workflow colour values',()=>{const bad=structuredClone(meta);bad.workflow.actions[0].color='url(http://x)';expect(()=>readJobMetadata(bad)).toThrow();});
