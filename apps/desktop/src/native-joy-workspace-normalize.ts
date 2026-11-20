import {arcCubics} from './native-joy-workspace-curves';
import { DOMParser } from '@xmldom/xmldom';

const NS = 'http://www.w3.org/2000/svg';
type Mat = [number, number, number, number, number, number];
type Point = [number, number];
type Step = { op: 'M' | 'L' | 'C' | 'Z'; p: number[] };
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Adapter only for the explicit workspace export subset; never silently drops geometry/style. */
export function normalizeWorkspaceSvgForJoy(svg:string,mat:{widthIn:number;heightIn:number},roles?:Record<string,{tool:string;operation:string}>):string{return normalizeWorkspace(svg,mat,false,roles);}
/** Wireframe preview only. Never use this result as execution admission. */
export function normalizeWorkspaceSvgForJoyPreview(svg:string,mat:{widthIn:number;heightIn:number}):string{return normalizeWorkspace(svg,mat,true);}
function normalizeWorkspace(svg: string, mat: {widthIn: number; heightIn: number}, previewOnly:boolean,roles?:Record<string,{tool:string;operation:string}>): string {
  if (svg.length > 1_000_000 || (svg.match(/</g)?.length ?? 0) > 10_000 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?xml-stylesheet/i.test(svg)) {
    throw Error('Unsupported SVG directives or excessive markup.');
  }
  const bad = (): never => { throw Error('Malformed workspace SVG XML.'); };
  const doc = new DOMParser({errorHandler: {warning: bad, error: bad, fatalError: bad}}).parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== NS) throw Error('Expected workspace SVG.');
  allow(root, ['xmlns', 'width', 'height', 'viewBox']);
  const vb = numbers(root.getAttribute('viewBox') ?? '');
  if (vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0 || !(vb[2]! > 0) || !(vb[3]! > 0) || !Number.isFinite(mat.widthIn) || !Number.isFinite(mat.heightIn) || mat.widthIn <= 0 || mat.heightIn <= 0) throw Error('Invalid workspace dimensions.');
  const inch = (s: string): number => {
    const m = /^((?:\d+(?:\.\d*)?|\.\d+))in$/.exec(s);
    if (!m || !Number.isFinite(Number(m[1]))) throw Error('Expected physical-inch workspace dimensions.');
    return Number(m[1]);
  };
  if (Math.abs(inch(root.getAttribute('width') ?? '') - mat.widthIn) > 1e-8 || Math.abs(inch(root.getAttribute('height') ?? '') - mat.heightIn) > 1e-8) throw Error('Workspace physical dimensions do not match selected mat.');
  const out: string[] = [];
  let count = 0;
  const children = (el: Element, parent: Mat, depth: number): void => {
    if (depth > 64) throw Error('Workspace SVG nesting budget exceeded.');
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes.item(i);
      if (n?.nodeType === 1) walk(n as Element, parent, depth);
      else if (n?.nodeType === 3 && !n.nodeValue?.trim() || n?.nodeType === 8) continue;
      else throw Error('Unsupported SVG node/text.');
    }
  };
  const walk = (el: Element, parent: Mat, depth: number): void => {
    if (++count > 10_000) throw Error('Workspace SVG element budget exceeded.');
    if (el.namespaceURI !== NS) throw Error('Unsupported foreign SVG namespace.');
    if (el.localName === 'g') {
      allow(el, ['transform']);
      const t = el.getAttribute('transform');
      children(el, t ? mul(parent, parseTransform(t)) : parent, depth + 1);
      return;
    }
    if (el.localName !== 'path') throw Error(`Unsupported workspace SVG element: ${el.localName}.`);
    allow(el, ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'transform']);
    if (el.childNodes.length) throw Error('Unsupported path children.');
    const steps = normalizePath(el.getAttribute('d') ?? '');
    const fill = el.getAttribute('fill');
    const stroke = el.getAttribute('stroke') ?? '';
    if (!/^#[0-9a-fA-F]{6}$/.test(stroke)) throw Error('Workspace stroke must be explicit six-digit hex.');
    const rule = el.getAttribute('fill-rule');
    if (rule && !['evenodd', 'nonzero'].includes(rule)) throw Error('Unsupported fill rule.');
    // Only an unambiguous, single simple polygon may turn a solid cut shape into its boundary.
    // Curved/compound/self-intersecting fills require explicit outline mode or a future fill resolver.
    // The workspace producer emits explicit CUT contours; preserve every M/C/Z, including holes.
    const bladeContour=roles?.[stroke.toLowerCase()]?.tool==='fine_point_blade'&&roles[stroke.toLowerCase()]?.operation==='cut'&&fill?.toLowerCase()===stroke.toLowerCase();
    if (fill !== 'none' && (!/^#[0-9a-fA-F]{6}$/.test(fill??'') || !previewOnly&&!bladeContour&&(fill?.toLowerCase() !== stroke.toLowerCase() || !simplePolygon(steps)))) throw Error('Filled complex geometry is unsupported; switch to hollow/outline before inspection.');
    const t = el.getAttribute('transform');
    const matrix = t ? mul(parent, parseTransform(t)) : parent;
    if (matrix[0] * matrix[3] - matrix[1] * matrix[2] === 0) throw Error('Singular workspace transform.');
    const attrs = [`d="${steps.map(s => s.op + s.p.join(' ')).join(' ')}"`, 'fill="none"', `stroke="${stroke.toLowerCase()}"`];
    const sw = el.getAttribute('stroke-width');
    if (sw) {
      if (!NUMBER.test(sw) || !Number.isFinite(Number(sw)) || Number(sw) <= 0) throw Error('Unsupported stroke width.');
      attrs.push(`stroke-width="${Number(sw)}"`);
    }
    for (const [a, values] of [['stroke-linecap', ['butt', 'round', 'square']], ['stroke-linejoin', ['miter', 'round', 'bevel']]] as const) {
      const v = el.getAttribute(a);
      if (v) { if (!(values as readonly string[]).includes(v)) throw Error('Unsupported path styling.'); attrs.push(`${a}="${v}"`); }
    }
    attrs.push(`transform="matrix(${matrix.join(',')})"`);
    out.push(`<path ${attrs.join(' ')}/>`);
    if (out.length > 1000) throw Error('Workspace path budget exceeded.');
  };
  children(root, IDENTITY, 0);
  if (!out.length) throw Error('Workspace has no paths.');
  if(out.reduce((n,p)=>n+p.length,0)>990_000)throw Error('Workspace normalized SVG budget exceeded.');
  // Native facade converts px->pt72. 80-DPI workspace viewBox is retained, so 80 units is 72pt.
  return `<svg xmlns="${NS}" width="${mat.widthIn * 96}" height="${mat.heightIn * 96}" viewBox="0 0 ${vb[2]} ${vb[3]}" preserveAspectRatio="none">${out.join('')}</svg>`;
}

function allow(el: Element, names: string[]): void {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (!a || !names.includes(a.name)) throw Error(`Unsupported workspace SVG attribute: ${a?.name}.`);
  }
}
function numbers(s: string): number[] {
  if (!s.trim() || /^\s*,|,\s*,|,\s*$/.test(s)) throw Error('Malformed number list.');
  const tokens = s.trim().split(/[\s,]+/);
  if (tokens.some(t => !NUMBER.test(t) || !Number.isFinite(Number(t)))) throw Error('Invalid number.');
  return tokens.map(Number);
}
function parseTransform(s: string): Mat {
  const re = /\s*(matrix|translate|scale|rotate)\s*\(([^()]*)\)\s*/y;
  let result: Mat = IDENTITY, end = 0, count = 0;
  while (end < s.length) {
    re.lastIndex = end;
    const m = re.exec(s);
    if (!m || ++count > 256) throw Error('Malformed or unsupported transform.');
    const p = numbers(m[2]!);
    let t: Mat;
    if (m[1] === 'matrix' && p.length === 6) t = p as Mat;
    else if (m[1] === 'translate' && (p.length === 1 || p.length === 2)) t = [1, 0, 0, 1, p[0]!, p[1] ?? 0];
    else if (m[1] === 'scale' && (p.length === 1 || p.length === 2)) t = [p[0]!, 0, 0, p[1] ?? p[0]!, 0, 0];
    else if (m[1] === 'rotate' && (p.length === 1 || p.length === 3)) {
      const a = p[0]! * Math.PI / 180, c = Math.cos(a), d = Math.sin(a), x = p[1] ?? 0, y = p[2] ?? 0;
      t = [c, d, -d, c, x - c * x + d * y, y - d * x - c * y];
    } else throw Error('Invalid transform arguments.');
    result = mul(result, t);
    end = re.lastIndex;
    if (s[end] === ',') { end++; if (!s.slice(end).trim()) throw Error('Trailing transform comma.'); }
  }
  return result;
}
function mul(a: Mat, b: Mat): Mat {
  const v: Mat = [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
  if (v.some(n => !Number.isFinite(n))) throw Error('Nonfinite transform.');
  return v;
}
function normalizePath(d: string): Step[] {
  const re = /[MLCHVZQSTAmlchvzqsta]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens: string[] = []; let pos = 0;
  for (const m of d.matchAll(re)) {
    const gap = d.slice(pos, m.index);
    if (!/^[\s,]*$/.test(gap) || (gap.includes(',') && (gap.replace(/\s/g,'') !== ',' || /^[a-z]$/i.test(tokens.at(-1) ?? '') || /^[a-z]$/i.test(m[0])))) throw Error('Unsupported or malformed workspace path command.');
    tokens.push(m[0]); pos = m.index + m[0].length;
    if (tokens.length > 100_000) throw Error('Workspace path token budget exceeded.');
  }
  if (!/^\s*$/.test(d.slice(pos)) || !tokens.length) throw Error('Unsupported or malformed workspace path command.');
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, active = false;
  let cubic:Point|null=null,quadratic:Point|null=null;
  const out: Step[] = [];
  const emit=(op:Step['op'],p:number[])=>{if(p.some(v=>!Number.isFinite(v)))throw Error('Nonfinite workspace path.');if(out.length>=20_000)throw Error('Workspace normalized path budget exceeded.');out.push({op,p});};
  const n = (): number => {const v=tokens[i++];if(!v||!NUMBER.test(v)||!Number.isFinite(Number(v)))throw Error('Malformed/nonfinite path arguments.');return Number(v);};
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) cmd = tokens[i++]!;
    const upper = cmd.toUpperCase(), rel = cmd !== upper;
    if (!cmd || !active && upper !== 'M') throw Error('Path must start a subpath with M.');
    if (upper === 'Z') { emit('Z',[]);x=sx;y=sy;active=false;cmd='';cubic=quadratic=null;continue; }
    const count = upper==='A'?7:upper==='C'?6:upper==='S'||upper==='Q'?4:upper==='H'||upper==='V'?1:2;
    const begin=i,a=Array.from({length:count},n),from:Point=[x,y],prevC=cubic,prevQ=quadratic;cubic=quadratic=null;
    const pair=(j:number):Point=>[a[j]!+(rel?from[0]:0),a[j+1]!+(rel?from[1]:0)];
    if(upper==='H'){x=rel?x+a[0]!:a[0]!;emit('L',[x,y]);}
    else if(upper==='V'){y=rel?y+a[0]!:a[0]!;emit('L',[x,y]);}
    else if(upper==='M'||upper==='L'){[x,y]=pair(0);emit(upper,[x,y]);if(upper==='M'){sx=x;sy=y;active=true;cmd=rel?'l':'L';}}
    else if(upper==='C'){const c1=pair(0),c2=pair(2),end=pair(4);emit('C',[...c1,...c2,...end]);cubic=c2;[x,y]=end;}
    else if(upper==='S'){const c1:Point=prevC?[2*x-prevC[0],2*y-prevC[1]]:from,c2=pair(0),end=pair(2);emit('C',[...c1,...c2,...end]);cubic=c2;[x,y]=end;}
    else if(upper==='Q'||upper==='T'){const q:Point=upper==='Q'?pair(0):prevQ?[2*x-prevQ[0],2*y-prevQ[1]]:from,end=pair(upper==='Q'?2:0);emit('C',[x+2/3*(q[0]-x),y+2/3*(q[1]-y),end[0]+2/3*(q[0]-end[0]),end[1]+2/3*(q[1]-end[1]),...end]);quadratic=q;[x,y]=end;}
    else if(upper==='A'){if(!/^[01]$/.test(tokens[begin+3]!)||!/^[01]$/.test(tokens[begin+4]!))throw Error('Workspace arc flags must be 0 or 1.');const end=pair(5);for(const segment of arcCubics(from,end,a[0]!,a[1]!,a[2]!,a[3]!,a[4]!))emit(segment.op,segment.p);[x,y]=end;}
    else throw Error('Unsupported workspace path command.');
  }
  return out;
}
function simplePolygon(steps: Step[]): boolean {
  if (steps[0]?.op !== 'M' || steps.at(-1)?.op !== 'Z' || steps.slice(1,-1).some(s => s.op !== 'L')) return false;
  const p: Point[] = steps.slice(0,-1).map(s => [s.p[0]!,s.p[1]!]);
  const same = (a: Point,b: Point): boolean => a[0]===b[0] && a[1]===b[1];
  if (p.length > 1 && same(p[0]!,p.at(-1)!)) p.pop();
  if (p.length < 3 || p.length > 1024) return false;
  let area=0;
  for (let i=0;i<p.length;i++) { const a=p[i]!,b=p[(i+1)%p.length]!; if(same(a,b)) return false; area+=a[0]*b[1]-b[0]*a[1]; }
  if (!Number.isFinite(area) || area === 0) return false;
  const cross=(a:Point,b:Point,c:Point):number=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(a:Point,b:Point,c:Point):boolean=>cross(a,b,c)===0&&c[0]>=Math.min(a[0],b[0])&&c[0]<=Math.max(a[0],b[0])&&c[1]>=Math.min(a[1],b[1])&&c[1]<=Math.max(a[1],b[1]);
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) {
    if(j===i+1 || i===0&&j===p.length-1) continue;
    const a=p[i]!,b=p[(i+1)%p.length]!,c=p[j]!,d=p[(j+1)%p.length]!;
    if(on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)||Math.sign(cross(a,b,c))*Math.sign(cross(a,b,d))<0&&Math.sign(cross(c,d,a))*Math.sign(cross(c,d,b))<0) return false;
  }
  return true;
}
