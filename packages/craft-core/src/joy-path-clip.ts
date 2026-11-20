import type { Point } from "./svg-path-geometry";

export type JoyPathStep = { op: "M" | "L" | "C" | "Z"; points: Point[] };
export interface JoyClipRect { minX: number; minY: number; maxX: number; maxY: number }
export interface JoyClippedPath { steps: JoyPathStep[]; clipped: boolean; bounds: JoyClipRect | null }
type Curve = [Point, Point, Point, Point];
type Interval = [number, number];
// Intersection-only snapping, never control-point clamping. Large ill-conditioned
// geometry fails rather than promising arbitrary-precision clipping.
const EPS = 1e-8;
const COORDINATE_LIMIT = 1_000_000;
const copy = (p: Point): Point => ({ x: p.x, y: p.y });
const same = (p: Point, q: Point): boolean => p.x === q.x && p.y === q.y;
function check(p: Point): void {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > COORDINATE_LIMIT || Math.abs(p.y) > COORDINATE_LIMIT) {
    throw new Error("Geometry exceeds finite clipping precision limits.");
  }
}
function lerp(p: Point, q: Point, t: number): Point {
  return { x: p.x * (1-t) + q.x * t, y: p.y * (1-t) + q.y * t };
}
function split(c: Curve, t: number): [Curve, Curve] {
  const a=lerp(c[0],c[1],t), b=lerp(c[1],c[2],t), d=lerp(c[2],c[3],t);
  const e=lerp(a,b,t), f=lerp(b,d,t), g=lerp(e,f,t);
  return [[copy(c[0]),a,e,g],[g,f,d,copy(c[3])]];
}
function at(c: Curve, t: number): Point { return split(c,t)[0][3]; }
function portion(c: Curve, from: number, to: number): Curve {
  if (from===0 && to===1) return c.map(copy) as Curve;
  const left=to===1 ? c : split(c,to)[0];
  return from===0 ? left : split(left,from/to)[1];
}
function quadratic(a: number,b: number,c: number): number[] {
  if (a===0) return b===0 ? [] : [-c/b];
  const discriminant=b*b-4*a*c;
  if(discriminant<0) return [];
  const q=-0.5*(b+(b<0?-1:1)*Math.sqrt(discriminant));
  return q===0 ? [-b/(2*a)] : [q/a,c/q];
}
function critical(values: number[]): number[] {
  const a=-values[0]!+3*values[1]!-3*values[2]!+values[3]!;
  const b=3*values[0]!-6*values[1]!+3*values[2]!;
  const c=-3*values[0]!+3*values[1]!;
  return quadratic(3*a,2*b,c).filter(t=>Number.isFinite(t)&&t>0&&t<1);
}
function unique(values: number[]): number[] {
  return values.sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]!>Number.EPSILON*4);
}
function edgeRoots(c: Curve, axis: "x"|"y", edge: number): number[] {
  const values=c.map(p=>p[axis]-edge);
  if(values.every(v=>v===0)) return [];
  const scale=Math.max(1,...values.map(Math.abs));
  const normalized=values.map(v=>v/scale);
  const evaluate=(t:number):number=> {
    let v=[...normalized];
    for(let n=3;n>0;n--) for(let i=0;i<n;i++) v[i]=v[i]!*(1-t)+v[i+1]!*t;
    return v[0]!;
  };
  const cuts=unique([0,...critical(normalized),1]);
  const roots:number[]=[];
  for(let i=0;i<cuts.length-1;i++) {
    let lo=cuts[i]!,hi=cuts[i+1]!;
    let fl=evaluate(lo);const fh=evaluate(hi);
    if(fl===0) roots.push(lo);
    if(fh===0) roots.push(hi);
    if((fl<0)===(fh<0)||fl===0||fh===0) continue;
    for(let n=0;n<64;n++) {
      const mid=(lo+hi)/2;
      if(mid===lo||mid===hi) break;
      const fm=evaluate(mid);
      if(fm===0){lo=mid;hi=mid;break;}
      if((fm<0)===(fl<0)){lo=mid;fl=fm;}else hi=mid;
    }
    roots.push((lo+hi)/2);
  }
  return roots.filter(t=>t>0&&t<1);
}
function inside(p:Point,r:JoyClipRect):boolean {
  return p.x>=r.minX&&p.x<=r.maxX&&p.y>=r.minY&&p.y<=r.maxY;
}
function snap(p:Point,r:JoyClipRect):Point {
  const q=copy(p);
  for(const axis of ['x','y'] as const) {
    const low=axis==='x'?r.minX:r.minY, high=axis==='x'?r.maxX:r.maxY;
    if(Math.abs(q[axis]-low)<=EPS) q[axis]=low;
    else if(Math.abs(q[axis]-high)<=EPS) q[axis]=high;
  }
  if(!inside(q,r)) throw new Error("Clipping intersection exceeds numerical precision budget.");
  return q;
}
function lineIntervals(p:Point,q:Point,r:JoyClipRect):Interval[] {
  if(same(p,q)) return [];
  if(inside(p,r)&&inside(q,r)) return [[0,1]];
  let lo=0,hi=1;
  const axes: Array<[number, number, number, number]> = [
    [p.x, q.x-p.x, r.minX, r.maxX], [p.y, q.y-p.y, r.minY, r.maxY],
  ];
  for(const [start,delta,min,max] of axes) {
    if(delta===0){if(start<min||start>max)return [];continue;}
    const a=(min-start)/delta,b=(max-start)/delta;
    lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
    if(lo>=hi)return [];
  }
  return [[lo,hi]];
}
function curveIntervals(c:Curve,r:JoyClipRect):Interval[] {
  if(c.every(p=>inside(p,r)))return [[0,1]];
  // Include extrema even when a tangent boundary root rounds slightly away
  // from zero. Sampling the sole interval at that tangent could otherwise
  // misclassify an entirely exterior curve as an interior one.
  const cuts=unique([0,1,...critical(c.map(p=>p.x)),...critical(c.map(p=>p.y)),...edgeRoots(c,'x',r.minX),...edgeRoots(c,'x',r.maxX),...edgeRoots(c,'y',r.minY),...edgeRoots(c,'y',r.maxY)]);
  const result:Interval[]=[];
  for(let i=0;i<cuts.length-1;i++) {
    const from=cuts[i]!,to=cuts[i+1]!;
    if(!inside(at(c,(from+to)/2),r)) continue;
    const previous=result.at(-1);
    if(previous&&previous[1]===from)previous[1]=to;
    else result.push([from,to]);
  }
  return result;
}

/** Clip stroked centerlines. Do not invent polygon edges along the clip border. */
export function clipJoyPath(steps: readonly JoyPathStep[], rect: JoyClipRect): JoyClippedPath {
  check({x:rect.minX,y:rect.minY});check({x:rect.maxX,y:rect.maxY});
  if(rect.minX>=rect.maxX||rect.minY>=rect.maxY)throw new Error("Invalid clipping rectangle.");
  if(!Array.isArray(steps)||steps.length>100_000)throw new Error("Clipping step budget exceeded.");
  const output:JoyPathStep[]=[];
  let bounds:JoyClipRect|null=null, clipped=false, move=true, whole=true;
  let current:Point|null=null, start:Point|null=null, subpathOutput=0, outputPoints=0, inputPoints=0;
  const append=(s:JoyPathStep):void=> {
    outputPoints+=s.points.length;
    if(outputPoints>100_000||output.length>=100_000)throw new Error("Clipping output budget exceeded.");
    output.push(s);
  };
  const include=(p:Point):void=> {
    const q=snap(p,rect);
    if(!bounds) bounds={minX:q.x,minY:q.y,maxX:q.x,maxY:q.y};
    else {bounds.minX=Math.min(bounds.minX,q.x);bounds.minY=Math.min(bounds.minY,q.y);bounds.maxX=Math.max(bounds.maxX,q.x);bounds.maxY=Math.max(bounds.maxY,q.y);}
  };
  const emit=(a:Point,step:JoyPathStep):void=> {
    if(move)append({op:'M',points:[copy(a)]});
    append(step);move=false;
    include(a);
    if(step.op==='C') {
      const curve=[a,...step.points] as Curve;
      include(curve[3]);
      for(const t of unique([...critical(curve.map(p=>p.x)),...critical(curve.map(p=>p.y))])) include(at(curve,t));
    }else include(step.points[0]!);
  };
  const segment=(a:Point,step:JoyPathStep):void=> {
    const end=step.points.at(-1)!;
    const curve=step.op==='C'?[a,...step.points] as Curve:null;
    const intervals=curve?curveIntervals(curve,rect):lineIntervals(a,end,rect);
    const changed=intervals.length!==1||intervals[0]![0]!==0||intervals[0]![1]!==1;
    if(changed){clipped=true;whole=false;}
    if(!intervals.length){move=true;return;}
    for(const [from,to] of intervals) {
      if(from>0)move=true;
      if(curve) {
        const part=portion(curve,from,to);
        if(from>0)part[0]=snap(part[0],rect);
        if(to<1)part[3]=snap(part[3],rect);
        emit(part[0],{op:'C',points:part.slice(1)});
      }else {
        const first=from===0?copy(a):snap(lerp(a,end,from),rect);
        const last=to===1?copy(end):snap(lerp(a,end,to),rect);
        emit(first,{op:'L',points:[last]});
      }
      if(to<1)move=true;
    }
  };
  for(const step of steps) {
    const expected=step.op==='C'?3:step.op==='Z'?0:1;
    if(!['M','L','C','Z'].includes(step.op)||!Array.isArray(step.points)||step.points.length!==expected)throw new Error("Invalid clipping path step.");
    inputPoints+=step.points.length;
    if(inputPoints>100_000)throw new Error("Clipping input budget exceeded.");
    step.points.forEach(check);
    if(step.op==='M'){current=copy(step.points[0]!);start=copy(current);move=true;whole=true;subpathOutput=output.length;continue;}
    if(!current||!start)throw new Error("Clipping path requires M.");
    if(step.op==='Z') {
      if(whole&&output.length>subpathOutput&&inside(current,rect)&&inside(start,rect)) {append({op:'Z',points:[]});include(start);}
      else segment(current,{op:'L',points:[start]});
      current=null;start=null;move=true;
    }else {segment(current,step);current=copy(step.points.at(-1)!);}
  }
  return {steps:output,clipped,bounds};
}
