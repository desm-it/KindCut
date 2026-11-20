export interface NativeJoyMaterialOption {id:number;name:string}
/** Exact source IDs only: neither translated names nor similar stock names establish a match. */
export function nativeJoyMaterialOptions(rows:ReadonlyArray<{sourceMaterialId:number;name:string}>):NativeJoyMaterialOption[]{
 const names=new Map<number,string>();
 for(const row of rows){
  if(!Number.isSafeInteger(row.sourceMaterialId)||row.sourceMaterialId<1||typeof row.name!=='string'||!row.name.trim()||row.name.length>300)throw Error('Invalid native material metadata.');
  if(names.has(row.sourceMaterialId)&&names.get(row.sourceMaterialId)!==row.name)throw Error('Conflicting native material identity.');
  names.set(row.sourceMaterialId,row.name);
 }
 return [...names].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
}
