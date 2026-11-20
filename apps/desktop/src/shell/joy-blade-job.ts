/** Source/resource validation, not physical-safety or material suitability certification. */
export const BLADE_JOB_ID='joy-blade-job-v1';
type Obj=Record<string,unknown>;
const fail=():never=>{throw Error('Blade job source/settings/recipe are invalid or unsupported.');};
function keys(v:unknown,required:string[],optional:string[]=[]):asserts v is Obj{if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!(k in v))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const uint=(v:unknown,max:number,min=0)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
export function requireBladeJob(plan:unknown,settings:unknown,pressures:unknown):void{
 keys(plan,['schemaVersion','coordinateFrame','machine','unit','execution','material','mat','bounds','clipping','groups']);
 if(plan.schemaVersion!==2||plan.coordinateFrame!=='kindcut_canvas_pt72_v1'||plan.machine!=='cricut_joy'||plan.unit!=='pt72'||plan.execution!=='unsupported')fail();
 keys(plan.material,['widthIn','heightIn','id']);keys(plan.mat,['widthIn','heightIn'],['mode']);keys(plan.bounds,['minX','minY','maxX','maxY']);keys(plan.clipping,['policy','clippedPathIds','omittedPathIds']);
 if(!uint(plan.material.id,0xffffffff,1)||!finite(plan.mat.widthIn)||plan.mat.widthIn<=0||plan.mat.widthIn>4.5||!finite(plan.mat.heightIn)||!(plan.mat.mode===undefined&&[6.5,12].includes(Number(plan.mat.heightIn))||plan.mat.mode==='card'&&plan.mat.widthIn===4.5&&plan.mat.heightIn===6.25))fail();
 for(const k of['widthIn','heightIn'])if(!finite(plan.material[k])||Number(plan.material[k])<=0||Number(plan.material[k])>Number(plan.mat[k]))fail();
 if(Object.values(plan.bounds).some(v=>!finite(v))||Number(plan.bounds.minX)>Number(plan.bounds.maxX)||Number(plan.bounds.minY)>Number(plan.bounds.maxY))fail();
 if(!['clip','reject'].includes(String(plan.clipping.policy))||!Array.isArray(plan.clipping.clippedPathIds)||!Array.isArray(plan.clipping.omittedPathIds)||plan.clipping.clippedPathIds.length||plan.clipping.omittedPathIds.length)fail();
 if(!Array.isArray(plan.groups)||plan.groups.length!==1)fail();const group=(plan.groups as unknown[])[0];keys(group,['tool','operation','paths']);if(group.tool!=='fine_point_blade'||group.operation!=='cut'||!Array.isArray(group.paths)||!group.paths.length||group.paths.length>1000)fail();
 const ids=new Set<string>();let total=0;
 for(const path of group.paths as unknown[]){keys(path,['id','steps'],['color']);if(typeof path.id!=='string'||!path.id||path.id.length>256||ids.has(path.id)||path.color!==undefined&&(typeof path.color!=='string'||!/^#[0-9a-f]{6}$/i.test(path.color)))fail();ids.add(path.id as string);if(!Array.isArray(path.steps)||!path.steps.length)fail();let active=false,drawn=false;
 for(const step of path.steps as unknown[]){keys(step,['op','points']);const n=step.op==='M'||step.op==='L'?1:step.op==='C'?3:step.op==='Z'?0:-1;if(!Array.isArray(step.points)||n<0||step.points.length!==n||++total>100000)fail();if(step.op==='M')active=true;else{if(!active)fail();if(step.op==='Z')active=false;else drawn=true;}for(const p of step.points as unknown[]){keys(p,['x','y']);if(!finite(p.x)||!finite(p.y)||Math.abs(p.x)>1e9||Math.abs(p.y)>1e9)fail();}}if(!drawn)fail();}
 keys(settings,['schemaVersion','materialId','tool','operation','mode','context','pressureRequest','speeds','nonXY','geometry'],['profileId']);if(settings.schemaVersion!==1||settings.materialId!==plan.material.id||settings.tool!=='fine_point_blade'||settings.operation!=='cut'||settings.mode!=='precision'||!uint(settings.context,0xffffffff)||!uint(settings.pressureRequest,65535,1))fail();
 keys(settings.speeds,['cutVelocity_ips','moveVelocity_ips','cutAcceleration_ips2','moveAcceleration_ips2']);keys(settings.nonXY,['unit','cutVelocity','moveVelocity','cutAcceleration','moveAcceleration']);keys(settings.geometry,['unit','flags','lift_threshold','parallel_offset','lagging_offset','nodes']);keys(settings.geometry.flags,['p_bias_enabled','roc_threshold_enabled','t_bias_enabled','use_calc_offsets','centered_bl','tan_theta']);
 if(settings.nonXY.unit!=='native_unverified'||settings.geometry.unit!=='native_unverified'||Object.values(settings.geometry.flags).some(v=>typeof v!=='boolean')||!Array.isArray(settings.geometry.nodes)||settings.geometry.nodes.length!==5||settings.geometry.nodes.some(v=>!uint(v,255)))fail();
 for(const v of Object.values(settings.speeds))if(!Array.isArray(v)||v.length!==2||v.some(n=>!finite(n)||n<0))fail();for(const[k,v]of Object.entries(settings.nonXY))if(k!=='unit'&&(!Array.isArray(v)||v.length!==3||v.some(n=>!finite(n)||n<0)))fail();for(const k of['lift_threshold','parallel_offset','lagging_offset'])if(!finite(settings.geometry[k]))fail();
 if(!Array.isArray(pressures)||!pressures.length||pressures.length>32||pressures.some(v=>!uint(v,65535,1))||pressures[0]!==settings.pressureRequest)fail();
}
