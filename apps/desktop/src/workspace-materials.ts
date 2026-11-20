import type{CardSize}from'./workspace-utils';
export const PAPER_MATERIAL_IDS=[218,19,211];
export const MATERIAL_INSERT_ID=535;
/** New generic vinyl choices use the actual Premium Vinyl source record. Legacy ID20 stays Chalkboard. */
export const MATERIAL_VINYL_ID=473;
export const VINYL_MATERIALS=[{id:473,name:'Premium Vinyl'},{id:73,name:'Stencil Vinyl'},{id:87,name:'Holographic Vinyl'},{id:20,name:'Chalkboard Vinyl'},{id:431,name:'Dry Erase Vinyl'}]as const;
export const isVinylMaterial=(id:number)=>VINYL_MATERIALS.some(v=>v.id===id);
export const isNativeMakeMaterial=(id:number)=>PAPER_MATERIAL_IDS.includes(id)||id===MATERIAL_INSERT_ID||isVinylMaterial(id);
export function workspaceMaterialSelection(current:{materialId:number;matPreset:string;cardSize:CardSize|null;insertSlots:boolean},id:number){
 const insert=id===MATERIAL_INSERT_ID;
 return{materialId:id,matPreset:insert?'joy-card':isVinylMaterial(id)&&current.matPreset==='joy-card'?'joy-standard-short':current.matPreset,cardSize:insert?(current.cardSize??'medium' as const):null,insertSlots:insert?(current.materialId===id?current.insertSlots:true):false};
}

export const workspaceHasCutContent=(count:number,id:number,slots:boolean)=>count>0||id===MATERIAL_INSERT_ID&&slots;
