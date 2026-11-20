export type NativeJoyLoadingDiagnosticEvent={seq:number;atMs:number;startedMs:number|null;kind:'stage'|'exchange'|'io_error'|'failure'|'cleanup'|'capture_gap';stage:string;txHex:string|null;rxHex:string|null;code:string|null};
export type NativeJoyLoadingDiagnostics={version:1;operationId:number;lastStage:string;failure:null|{stage:string;code:string;errorType:string};events:NativeJoyLoadingDiagnosticEvent[];totalEvents:number;evictedEvents:number;captureIncomplete:boolean};
const invalid=():never=>{throw new Error('Invalid loading diagnostics.');};
function object(x:unknown,keys:string[]):Record<string,unknown>{if(!x||typeof x!=='object'||Array.isArray(x))return invalid();const v=x as Record<string,unknown>;if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return invalid();return v;}
function integer(x:unknown,min=0):number{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<min)return invalid();return x;}
function time(x:unknown):number{if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>Number.MAX_SAFE_INTEGER)return invalid();return x;}
function label(x:unknown):string{if(typeof x!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(x))return invalid();return x;}
function hex(x:unknown):string|null{if(x===null)return null;if(typeof x!=='string'||x.length>1024||x.length%2!==0||!/^[0-9a-f]*$/.test(x))return invalid();return x;}
const errors=new Set(['OperationDeadline','OperationCancelled','MaterialLost','UnknownError','Exception','ValueError','TypeError','RuntimeError','TimeoutError','ConnectionError','BrokenPipeError','EOFError','OSError','PermissionError','MeasurementScopeFailed','AlignmentScopeFailed','Cancelled','CancelledError']);
export function readLoadingDiagnostics(value:unknown,operationId:number):NativeJoyLoadingDiagnostics{return readDiagnostics(value,operationId,512);}
export function readJobDiagnostics(value:unknown,operationId:number):NativeJoyLoadingDiagnostics{return readDiagnostics(value,operationId,1024);}
function readDiagnostics(value:unknown,operationId:number,limit:512|1024):NativeJoyLoadingDiagnostics{
 const v=object(value,['version','operationId','lastStage','failure','events','totalEvents','evictedEvents','captureIncomplete']);
 if(v.version!==1||integer(v.operationId,1)!==integer(operationId,1)||typeof v.captureIncomplete!=='boolean'||!Array.isArray(v.events)||v.events.length>limit)return invalid();
 const total=integer(v.totalEvents),evicted=integer(v.evictedEvents);if(evicted+v.events.length!==total)return invalid();let prior=-1;
 const events=v.events.map((input,index)=>{const e=object(input,['seq','atMs','startedMs','kind','stage','txHex','rxHex','code']);const seq=integer(e.seq,1),atMs=time(e.atMs),startedMs=e.startedMs===null?null:time(e.startedMs);if(seq!==evicted+index+1||atMs<prior||(startedMs!==null&&startedMs>atMs)||!['stage','exchange','io_error','failure','cleanup','capture_gap'].includes(String(e.kind)))return invalid();prior=atMs;return{seq,atMs,startedMs,kind:e.kind as NativeJoyLoadingDiagnosticEvent['kind'],stage:label(e.stage),txHex:hex(e.txHex),rxHex:hex(e.rxHex),code:e.code===null?null:label(e.code)};});
 let failure:NativeJoyLoadingDiagnostics['failure']=null;if(v.failure!==null){const f=object(v.failure,['stage','code','errorType']);if(typeof f.errorType!=='string'||!errors.has(f.errorType))return invalid();failure={stage:label(f.stage),code:label(f.code),errorType:f.errorType};}
 return{version:1,operationId,lastStage:label(v.lastStage),failure,events,totalEvents:total,evictedEvents:evicted,captureIncomplete:v.captureIncomplete};
}
