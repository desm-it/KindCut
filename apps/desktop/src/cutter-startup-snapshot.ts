type Preference='auto'|'native'|'slicebug';
/** Native startup is metadata-only; no discovery/connection and no implicit legacy process. */
export async function readCutterStartupSnapshot<N extends{enabled:boolean},L,S>(api:{preference:()=>Promise<Preference>;nativeSetup?:()=>Promise<N>;legacyStatus:()=>Promise<L>;legacySetup:()=>Promise<S>}):Promise<{kind:'native';setup:N}|{kind:'legacy';status:L;setup:S}>{
 const preference=await api.preference();
 if(preference!=='slicebug'){
  if(api.nativeSetup){const setup=await api.nativeSetup();if(setup.enabled)return{kind:'native',setup};}
  if(preference==='native')throw Error('Selected native backend is unavailable. No legacy fallback was started.');
 }
 const[status,setup]=await Promise.all([api.legacyStatus(),api.legacySetup()]);
 return{kind:'legacy',status,setup};
}
