import {describe,it,expect} from 'vitest';
import {readJobMetadata,readJobState} from './native-joy-job-types';
const metadata={programDigest:'a'.repeat(64),tool:'pen',operation:'draw',materialId:4,passCount:2,recordCount:8,pressureRequests:[1,32],heightInches:6.5,physicalCalibrationVerified:false};
const state={operationId:1,phase:'waiting_for_go',active:true,sessionRetired:false,jobStarted:false,programDigest:'a'.repeat(64),tool:'pen',acceptedRecords:0,completedPasses:0,totalRecords:8,totalPasses:2,physicalCompletionVerified:false,motionStoppedVerified:false};
describe('job DTO validators',()=>{
 it('accepts and copies a strict metadata DTO',()=>{const result=readJobMetadata(metadata);expect(result).toEqual(metadata);expect(result.pressureRequests).not.toBe(metadata.pressureRequests);});
 it('rejects malformed digest, tool pairs, pressure bounds and unknown data',()=>{for(const v of [{...metadata,programDigest:'A'.repeat(64)},{...metadata,tool:'pen',operation:'cut'},{...metadata,pressureRequests:[0,1]},{...metadata,extra:'secret'}])expect(()=>readJobMetadata(v)).toThrow();});
 it('validates safe job state and rejects impossible counters / physical claims',()=>{expect(readJobState(state)).toMatchObject(state);expect(()=>readJobState({...state,acceptedRecords:9})).toThrow();expect(()=>readJobState({...state,motionStoppedVerified:true})).toThrow();expect(()=>readJobState({...state,extra:'x'})).toThrow();});
});
