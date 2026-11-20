export interface MakeRoutingApi {preference:()=>Promise<'auto'|'native'|'slicebug'>;nativeSetup?:()=>Promise<{enabled:boolean;platform:string}>}
/** Routing is metadata-only. Unknown state must not implicitly launch legacy planning. */
export async function resolveMakeRoute(api:MakeRoutingApi):Promise<'native'|'slicebug'>{
 const preference=await api.preference();
 if(preference==='slicebug')return 'slicebug';
 if(preference==='native')return 'native';
 if(preference!=='auto'||!api.nativeSetup)throw Error('Cutter startup is unknown. Select a backend before making.');
 const setup=await api.nativeSetup();
 if(!setup||typeof setup.enabled!=='boolean'||!['darwin','win32','linux'].includes(setup.platform))throw Error('Cutter platform metadata is unavailable.');
 if(setup.enabled){if(setup.platform!=='darwin')throw Error('Native Joy platform metadata is inconsistent.');return 'native';}
 return 'slicebug';
}
