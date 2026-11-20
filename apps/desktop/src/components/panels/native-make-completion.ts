import type{NativeJobState}from'../../shell/native-joy-job-types';
/** Completion belongs to a source snapshot, never to whatever the editor shows later. */
export function nativeMakeFinishedForSource(job:(NativeJobState&{historical?:boolean})|null|undefined,source:unknown,completedSource:unknown,visible:boolean){return visible&&completedSource!==null&&job?.phase==='completed'&&!job.historical&&source===completedSource;}
