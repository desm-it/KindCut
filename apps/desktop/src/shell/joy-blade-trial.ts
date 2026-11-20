import {isDeepStrictEqual} from 'node:util';
import policy from './joy-blade-trial-policy.json';

export const BLADE_TRIAL_ID = 'joy-20mm-square-v1';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function reject(message: string): never { throw new Error(`Blade trial rejected: ${message}.`); }
function equal(a: unknown, b: unknown): boolean { return isDeepStrictEqual(a,b); }
function close(a: number, b: number): boolean { return Math.abs(a-b) <= 1e-6; }

function keys(v:unknown,required:string[],optional:string[]=[]):asserts v is Record<string,unknown>{if(!record(v)||required.some(k=>!(k in v))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))reject('noncanonical plan fields');}
function canonical(plan:unknown){
 keys(plan,['schemaVersion','machine','unit','execution','coordinateFrame','material','mat','bounds','clipping','groups']);
 keys(plan.material,['widthIn','heightIn','id']);keys(plan.mat,['widthIn','heightIn']);keys(plan.bounds,['minX','minY','maxX','maxY']);keys(plan.clipping,['policy','clippedPathIds','omittedPathIds']);
 if(!Array.isArray(plan.groups))reject('groups');for(const group of plan.groups){keys(group,['tool','operation','paths']);if(!Array.isArray(group.paths))reject('paths');for(const path of group.paths){keys(path,['id','steps'],['color']);if(!Array.isArray(path.steps))reject('steps');for(const step of path.steps){keys(step,['op','points']);if(!Array.isArray(step.points))reject('points');for(const point of step.points)keys(point,['x','y']);}}}
}

/** Pure admission for the narrowly reviewed first-cut fixture. This is not physical-safety certification. */
export function requireBladeTrial(plan: unknown, settings: unknown, pressureRequests: unknown): void {
  canonical(plan);
  if (!record(plan) || !record(settings)) reject('plan and settings objects are required');
  const expectedSettings = structuredClone(policy.settings) as Record<string, unknown>;
  const actualSettings = { ...settings };
  delete actualSettings.profileId;
  if (!equal(actualSettings, expectedSettings)) reject('settings differ from the complete reviewed material preset');
  if (!Array.isArray(pressureRequests) || !equal(pressureRequests, policy.pressureRequests)) reject('pressure recipe mismatch');
  if (plan.schemaVersion !== 2 || plan.machine!=='cricut_joy' || plan.coordinateFrame !== policy.coordinateFrame || plan.unit !== 'pt72' || plan.execution !== 'unsupported') reject('plan frame or schema mismatch');
  if (!record(plan.material) || plan.material.id !== policy.materialId || !finite(plan.material.widthIn) || !finite(plan.material.heightIn) ||
    !record(plan.mat) || !finite(plan.mat.widthIn)||!finite(plan.mat.heightIn)|| !close(plan.mat.widthIn as number, policy.mat.widthIn) || !close(plan.mat.heightIn as number, policy.mat.heightIn)) reject('material or mat mismatch');
  if (!Array.isArray(plan.groups) || plan.groups.length !== 1) reject('exactly one tool group is required');
  const group = plan.groups[0];
  if (!record(group) || group.tool !== 'fine_point_blade' || group.operation !== 'cut' || !Array.isArray(group.paths) || group.paths.length !== 1) reject('exactly one blade cut path is required');
  const path = group.paths[0];
  if (!record(path) || !Array.isArray(path.steps)) reject('path steps are malformed');
  const steps = path.steps;
  const closed = steps.length === 5 && record(steps[4]) && steps[4].op === 'Z' && Array.isArray(steps[4].points) && steps[4].points.length === 0;
  const explicitClose = steps.length === 5 && record(steps[4]) && steps[4].op === 'L';
  const explicitCloseWithZ = steps.length === 6 && record(steps[4]) && steps[4].op === 'L' && record(steps[5]) && steps[5].op === 'Z' && Array.isArray(steps[5].points) && steps[5].points.length === 0;
  if (!(closed || explicitClose || explicitCloseWithZ) || !record(steps[0]) || steps[0].op !== 'M' || !Array.isArray(steps[0].points) || steps[0].points.length !== 1) reject('path must contain one move and exactly four square corners');
  const points: Array<{x:number;y:number}> = [];
  const readPoint = (v: unknown): {x:number;y:number} => {
    if (!record(v) || !finite(v.x) || !finite(v.y)) reject('coordinates must be finite numbers');
    return {x:v.x,y:v.y};
  };
  points.push(readPoint(steps[0].points[0]));
  const explicit = explicitClose || explicitCloseWithZ;
  const count = explicit ? 4 : 3;
  for (let i=1; i<=count; i++) {
    const step=steps[i];
    if (!record(step) || step.op!=='L' || !Array.isArray(step.points) || step.points.length!==1) reject('only single-point lines are supported');
    points.push(readPoint(step.points[0]));
  }
  if (explicit) {
    if (!close(points[4]!.x,points[0]!.x) || !close(points[4]!.y,points[0]!.y)) reject('explicit closing line must return to the start');
    points.pop();
  }
  if (points.length!==4 || new Set(points.map(p=>`${p.x},${p.y}`)).size!==4) reject('square corners must be distinct');
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const side=policy.squareSideMm*72/25.4;
  if (!close(maxX-minX,side) || !close(maxY-minY,side)) reject('side must be exactly 20mm in pt72');
  const corners=new Set([`${minX},${minY}`,`${minX},${maxY}`,`${maxX},${minY}`,`${maxX},${maxY}`]);
  if (corners.size!==4 || points.some(p=>!corners.has(`${p.x},${p.y}`))) reject('geometry must be an axis-aligned square');
  for(let i=0;i<4;i++){const a=points[i]!,b=points[(i+1)%4]!;if(!((close(a.x,b.x)&&!close(a.y,b.y))||(close(a.y,b.y)&&!close(a.x,b.x))))reject('square edges must not cross or run diagonally');}
  if (!record(plan.bounds) || !['minX','minY','maxX','maxY'].every(k=>finite((plan.bounds as Record<string,unknown>)[k]))|| !close(plan.bounds.minX as number,minX) || !close(plan.bounds.maxX as number,maxX) || !close(plan.bounds.minY as number,minY) || !close(plan.bounds.maxY as number,maxY)) reject('reported bounds do not match literal path');
  if (!record(plan.clipping) || !['clip','reject'].includes(String(plan.clipping.policy))|| !Array.isArray(plan.clipping.clippedPathIds) || plan.clipping.clippedPathIds.length!==0 || !Array.isArray(plan.clipping.omittedPathIds) || plan.clipping.omittedPathIds.length!==0) reject('clipped or omitted geometry is forbidden');
  const margin=policy.edgeMarginMm*72/25.4,matW=policy.mat.widthIn*72,matH=policy.mat.heightIn*72,materialW=(plan.material.widthIn as number)*72,materialH=(plan.material.heightIn as number)*72;
  if (minX<margin-1e-6 || minY<margin-1e-6 || maxX>matW-margin+1e-6 || maxY>matH-margin+1e-6 || maxX>materialW-margin+1e-6 || maxY>materialH-margin+1e-6) reject('square violates 10mm material or mat margin');
}
