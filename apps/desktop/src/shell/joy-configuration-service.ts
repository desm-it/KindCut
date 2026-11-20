import {compileNormalizedSvgForJoy} from '@cricut-companion/svg-preflight';
import type {NativeConfigurationCatalog,NativeConfigurationCompileResult,NativeConfigurationSource} from './native-joy-configuration-types';
import {calibration,exact,identifier,library,record,type JoyConfigurationLibrary,type JoyCalibration} from './joy-configuration-store';
import materialData from './joy-material-catalog.json';
interface Store {load():Promise<JoyConfigurationLibrary>;transact(f:(d:JoyConfigurationLibrary)=>JoyConfigurationLibrary|Promise<JoyConfigurationLibrary>):Promise<JoyConfigurationLibrary>}
interface Options {store:Store;offline(request:Record<string,unknown>):Promise<Record<string,unknown>>;capture():Promise<JoyCalibration>}
const error=()=>new Error('Native Joy configuration is incomplete, incompatible or unavailable. Disconnect before editing/preparing; select matching material, tool and saved calibration.');
export class JoyConfigurationService {
 constructor(private readonly o:Options){}
 private summary(d:JoyConfigurationLibrary):NativeConfigurationCatalog{return {profiles:d.profiles.map(p=>({id:p.id,name:p.name,materialId:Number(p.settings.materialId),tool:p.settings.tool as 'pen'|'fine_point_blade',mode:'precision',pressureRequest:Number(p.settings.pressureRequest),provenance:p.provenance,...(p.recipe?{passCount:p.recipe.passCount,pressureRequests:p.recipe.pressureRequests,sourceMaterialId:p.recipe.sourceMaterialId,workspaceMaterialName:p.recipe.workspaceMaterialName}:{})})),calibrations:d.calibrations.map(c=>({id:c.id,capturedAt:c.capturedAt,firmwareSelector:c.firmwareSelector,source:c.source,physicalCalibrationVerified:false})),selection:d.selection,materials:materialData.materials.map(({settings,...m})=>({...m,tool:m.tool as 'pen'|'fine_point_blade',mode:'precision' as const}))};}
 async list(){return this.summary(await this.o.store.load());}
 async ensureMakeSelection(materialId:number,tools:ReadonlyArray<'pen'|'fine_point_blade'>,device?:{deviceFingerprint:string;firmwareSelector:number}):Promise<{profileId:string;calibrationId:string}>{
  if(!Number.isSafeInteger(materialId)||materialId<1||!Array.isArray(tools)||!tools.length||new Set(tools).size!==tools.length||tools.some(t=>t!=='pen'&&t!=='fine_point_blade'))throw error();
  const matches=tools.map(tool=>{const candidates=materialData.materials.filter(m=>m.sourceMaterialId===materialId&&m.tool===tool&&m.mode==='precision');if(candidates.length!==1)throw error();return candidates[0]!;});
  const chooseCalibration=(d:JoyConfigurationLibrary)=>{const candidates=device?d.calibrations.filter(c=>c.deviceFingerprint===device.deviceFingerprint&&c.firmwareSelector===device.firmwareSelector):d.calibrations;return candidates.find(c=>c.id===d.selection?.calibrationId)?.id??(candidates.length===1?candidates[0]!.id:null);};
  const initial=library(await this.o.store.load());
  if(!(chooseCalibration(initial)))throw Error('A saved Joy calibration is required. Enable advanced info in Settings, then select or capture calibration in Make.');
  const updated=await this.o.store.transact(d=>{
   const chosen=new Map<string,JoyConfigurationLibrary['profiles'][number]>();
   for(const source of matches){
    const existing=d.profiles.filter(p=>p.settings.materialId===materialId&&p.settings.tool===source.tool&&p.settings.mode==='precision');
    const selected=d.selection&&existing.find(p=>p.id===d.selection!.profileId);
    if(selected){chosen.set(source.tool,selected);continue;}
    if(existing.length===1){chosen.set(source.tool,existing[0]!);continue;}
    if(existing.length>1)throw error();
    const id=`joy-${source.id}`.slice(0,80);if(d.profiles.some(p=>p.id===id))throw error();
    const profile={id,name:source.name,provenance:'recovered_pass83_source_defaults',settings:{...source.settings,profileId:id},recipe:{catalogId:source.id,sourceMaterialId:source.sourceMaterialId,workspaceMaterialName:source.name,passCount:source.passCount,pressureRequests:[...source.pressureRequests]}};
    d.profiles.push(profile);chosen.set(source.tool,profile);
   }
   const calibrationId=chooseCalibration(d);
   if(!calibrationId)throw Error('A saved Joy calibration is required. Enable advanced info in Settings, then select or capture calibration in Make.');
   const profileId=d.selection&&[...chosen.values()].some(p=>p.id===d.selection!.profileId)?d.selection.profileId:chosen.get(tools[0]!)!.id;
   return library({...d,selection:{profileId,calibrationId}});
  });
  const selection=updated.selection;if(!selection||!updated.profiles.some(p=>p.id===selection.profileId)||!updated.calibrations.some(c=>c.id===selection.calibrationId))throw error();return {profileId:selection.profileId,calibrationId:selection.calibrationId};
 }
 async adopt(input:{catalogId:string;materialId:number;materialName:string;confirmed:true}){const v=record(input);exact(v,['catalogId','materialId','materialName','confirmed']);const source=materialData.materials.find(m=>m.id===v.catalogId);if(!source||v.confirmed!==true||v.materialId!==source.sourceMaterialId||!Number.isSafeInteger(v.materialId)||typeof v.materialName!=='string'||!v.materialName.trim()||v.materialName.length>128)throw error();return this.summary(await this.o.store.transact(d=>{const id=`joy-${source.id}`.slice(0,80),settings={...source.settings,profileId:id,materialId:source.sourceMaterialId};const p={id,name:v.materialName as string,provenance:'recovered_pass83_source_defaults',settings,recipe:{catalogId:source.id,sourceMaterialId:source.sourceMaterialId,workspaceMaterialName:v.materialName as string,passCount:source.passCount,pressureRequests:source.pressureRequests}};return library({...d,profiles:[...d.profiles.filter(x=>x.id!==id),p],selection:null});}));}
 async importLibrary(value:unknown){
  const incoming=library(value);
  const updated=await this.o.store.transact(async d=>{
   for(const p of incoming.profiles){const r=await this.o.offline({op:'configuration',action:'validate',settings:p.settings});p.settings=record(r.settings);p.provenance='imported_unverified';}
   for(const c of incoming.calibrations)c.source='imported_unverified';
   const profiles=new Map(d.profiles.map(p=>[p.id,p]));incoming.profiles.forEach(p=>profiles.set(p.id,p));
   const calibrations=new Map(d.calibrations.map(c=>[c.id,c]));incoming.calibrations.forEach(c=>calibrations.set(c.id,c));
   return library({...d,profiles:[...profiles.values()],calibrations:[...calibrations.values()],selection:d.selection});
  });return this.summary(updated);
 }
 async exportLibrary(){return this.o.store.load();}
 async select(input:unknown){const v=record(input);exact(v,['profileId','calibrationId']);const profileId=identifier(v.profileId),calibrationId=identifier(v.calibrationId);return this.summary(await this.o.store.transact(d=>library({...d,selection:{profileId,calibrationId}})));}
 async update(input:unknown){const v=record(input);exact(v,['profileId','pressureRequest']);const id=identifier(v.profileId);if(!Number.isInteger(v.pressureRequest)||Number(v.pressureRequest)<1||Number(v.pressureRequest)>65535)throw error();return this.summary(await this.o.store.transact(async d=>{const p=d.profiles.find(p=>p.id===id);if(!p||(p.recipe&&p.recipe.passCount!==1))throw error();const validated=await this.o.offline({op:'configuration',action:'validate',settings:{...p.settings,pressureRequest:v.pressureRequest}});p.settings=record(validated.settings);if(p.recipe)p.recipe.pressureRequests=[Number(v.pressureRequest)];p.provenance='user_adjusted_unverified';return d;}));}
 async storeCalibration(value:unknown){const c=calibration(value);return this.summary(await this.o.store.transact(d=>({...d,calibrations:[...d.calibrations.filter(x=>x.id!==c.id),c]})));}
 async capture(){return this.storeCalibration(await this.o.capture());}
 async compile(input:{profileId:string;calibrationId:string;source:NativeConfigurationSource}):Promise<NativeConfigurationCompileResult>{
  try{
   const v=record(input);exact(v,['profileId','calibrationId','source']);const d=await this.o.store.load();const p=d.profiles.find(p=>p.id===identifier(v.profileId)),c=d.calibrations.find(c=>c.id===identifier(v.calibrationId));if(!p||!c)throw error();
   const s=record(v.source);exact(s,['svg','materialId','mat','strokeTools']);if(s.materialId!==p.settings.materialId)throw error();
   const plan=compileNormalizedSvgForJoy(s.svg as string,{materialId:s.materialId as number,mat:s.mat as NativeConfigurationSource['mat'],strokeTools:s.strokeTools as NativeConfigurationSource['strokeTools'],boundsPolicy:'clip'});
   if(plan.groups.length!==1||plan.groups[0]?.tool!==p.settings.tool||plan.groups[0]?.operation!==p.settings.operation)throw error();
   const recipe=p.recipe,pressures=recipe?.pressureRequests??[Number(p.settings.pressureRequest)];if(recipe&&(recipe.pressureRequests.length!==recipe.passCount||recipe.sourceMaterialId!==p.settings.materialId||recipe.pressureRequests[0]!==p.settings.pressureRequest))throw error();
   const passes=[] as Array<{passNumber:number;pressureRequest:number;candidate:Record<string,unknown>}>;for(let i=0;i<pressures.length;i++){const pressureRequest=pressures[i]!,candidate=record(await this.o.offline({op:'configuration',action:'compile',plan,settings:{...p.settings,pressureRequest},pressureResponsesHex:c.pressureResponsesHex}));if(candidate.execution!=='unsupported'||candidate.safetyValidated!==false||candidate.configurationValidated!==false)throw error();passes.push({passNumber:i+1,pressureRequest,candidate});}
   return {candidate:{...passes[0]!.candidate,passPlan:{count:passes.length,pressures,execution:'unsupported'},profileBinding:{profileId:p.id,calibrationId:c.id,deviceFingerprint:c.deviceFingerprint,provenance:p.provenance}},passes,execution:'unsupported',physicalCalibrationVerified:false};
  }catch{throw error();}
 }
}
