// PROTOTYPE: centerline ("skeleton") tracing of the user's *actual* font, so
// single-line text keeps the chosen typeface instead of using a fixed stroke font.
//
// Pipeline: render the text to a bitmap → Zhang–Suen thinning to a 1px skeleton →
// follow the skeleton pixels into ordered polylines → simplify (Douglas–Peucker) →
// map back into the item's frame coordinate space. All pure JS / canvas, no extra
// binaries. Quality is font-dependent (great for thin/uniform fonts, messier for
// bold/serif) — this is here so we can eyeball it before committing to an approach.
import type { WorkspaceItemFrame } from "./workspace-utils";
import type { WorkspaceTextContent } from "./workspace-objects";
import type { Stroke } from "./single-line-font";

const SCALE = 4; // bitmap supersampling — higher = smoother, less-aliased skeleton
const MARGIN = 4; // bitmap padding (px) so glyphs never touch the border (thinning skips edges)
const SIMPLIFY_EPS = 1.4; // Douglas–Peucker tolerance in bitmap px (straightens runs)
const CORNER_DEG = 58; // turns sharper than this stay sharp; gentler ones become smooth curves
// Prune a dead-end branch only when it is shorter than this fraction of the glyph's
// GLOBAL stroke width. A nub below ~0.6× of a stroke width can only be thinning fuzz;
// a real crossbar arm / tail is ~1× a stroke width or more, so it always survives.
// (Measuring width globally avoids the crossing-junction inflation that deleted the
// t-crossbar and clipped the x — the whole short arm sits inside that inflated zone,
// so no local measurement can be trusted there.)
const PRUNE_FRAC = 0.6;
const SQRT2 = Math.SQRT2;

// Small LRU-ish cache so the live canvas render and the cut export don't re-trace.
const cache = new Map<string, Stroke[]>();
const CACHE_MAX = 240;

function cacheKey(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): string {
  return [
    tc.text, tc.fontFamily, tc.fontSize, tc.fontWeight, tc.fontStyle,
    tc.textDecoration, tc.textAlign, tc.letterSpacing, tc.lineHeight,
    Math.round(frame.width), Math.round(frame.height),
  ].join("|");
}

export function traceCenterlineStrokes(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): Stroke[] {
  const key = cacheKey(tc, frame);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = computeCenterlineStrokes(tc, frame);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}

// Convenience: traced strokes serialized to a smooth (corner-aware Bézier) path "d".
export function traceCenterlinePathD(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): string {
  return smoothStrokesToPathD(traceCenterlineStrokes(tc, frame));
}

// Drop all cached traces — call when fonts finish loading so glyphs that were traced
// against a fallback font get re-traced against the real one.
export function clearCenterlineCache(): void {
  cache.clear();
}

function computeCenterlineStrokes(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): Stroke[] {
  const rendered = renderBinary(tc, frame);
  if (!rendered) return [];
  const { grid, w, h } = rendered;
  // Distance-to-edge (≈ half the local stroke width) — measured BEFORE thinning.
  const dist = distanceTransform(grid, w, h);
  thinZhangSuen(grid, w, h);
  // Glyph stroke width = 2 × the typical (median) half-width along the skeleton.
  const skelDist: number[] = [];
  for (let i = 0; i < w * h; i++) if (grid[i]) skelDist.push(dist[i]!);
  const strokeWidth = 2 * median(skelDist) || 1;
  // Drop dead-end branches shorter than ~0.6× a stroke width (thinning fuzz only).
  pruneSpurs(grid, w, h, strokeWidth * PRUNE_FRAC);
  const polylines = traceSkeleton(grid, w, h);
  const out: Stroke[] = [];
  for (const line of polylines) {
    if (line.length < 2) continue;
    // Smooth out skeleton pixel-jitter (keeps endpoints fixed), then push each free
    // endpoint back out to the glyph edge (thinning retracts ends by ~half a stroke
    // width).
    const smoothed = smoothPolyline(line, 2);
    const extended = extendToEdges(smoothed, grid, dist, w, h);
    // Detect real corners on the DENSE line over a stroke-width window (so true curves
    // aren't mistaken for corners), split there, then simplify each run independently.
    const window = Math.max(2, Math.min(8, Math.round(strokeWidth * 0.6)));
    for (const run of splitAtCorners(extended, window)) {
      const simplified = simplify(run, SIMPLIFY_EPS);
      if (simplified.length < 2) continue;
      out.push(simplified.map(([x, y]) => [(x - MARGIN) / SCALE, (y - MARGIN) / SCALE]) as Stroke);
    }
  }
  return out;
}

// ── Step 1: rasterize the text in the same coordinate space as the frame ───────────
function renderBinary(
  tc: WorkspaceTextContent,
  frame: WorkspaceItemFrame,
): { grid: Uint8Array; w: number; h: number } | null {
  const w = Math.ceil(frame.width * SCALE) + MARGIN * 2;
  const h = Math.ceil(frame.height * SCALE) + MARGIN * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(MARGIN, MARGIN);
  ctx.scale(SCALE, SCALE);
  const fontStr = `${tc.fontStyle === "italic" ? "italic " : ""}${tc.fontWeight === "bold" ? "bold " : ""}${tc.fontSize}px ${tc.fontFamily}`;
  ctx.font = fontStr;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  const lines = tc.text.split("\n");
  const lineH = tc.fontSize * tc.lineHeight;
  lines.forEach((line, i) => {
    const chars = [...line];
    const lineW = chars.reduce((acc, c) => acc + ctx.measureText(c).width, 0)
      + Math.max(0, chars.length - 1) * tc.letterSpacing;
    const baseline = tc.fontSize + i * lineH;
    const xStart = tc.textAlign === "center"
      ? (frame.width - lineW) / 2
      : tc.textAlign === "right"
        ? frame.width - 1 - lineW
        : 1;
    let x = xStart;
    for (const c of chars) {
      ctx.fillText(c, x, baseline);
      x += ctx.measureText(c).width + tc.letterSpacing;
    }
    if (tc.textDecoration === "underline") {
      ctx.fillRect(xStart, baseline + tc.fontSize * 0.1, lineW, Math.max(1, tc.fontSize * 0.05));
    }
  });
  ctx.restore();

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // e.g. non-DOM/jsdom contexts
  }
  const grid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Black text on white → foreground where the red channel is dark.
    grid[i] = data[i * 4]! < 128 ? 1 : 0;
  }
  return { grid, w, h };
}

// ── Step 2: Zhang–Suen thinning to a 1px skeleton ──────────────────────────────────
function thinZhangSuen(grid: Uint8Array, w: number, h: number): void {
  const idx = (x: number, y: number) => y * w + x;
  const toRemove: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toRemove.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!grid[idx(x, y)]) continue;
          const p = [
            grid[idx(x, y - 1)]!,     // P2 N
            grid[idx(x + 1, y - 1)]!, // P3 NE
            grid[idx(x + 1, y)]!,     // P4 E
            grid[idx(x + 1, y + 1)]!, // P5 SE
            grid[idx(x, y + 1)]!,     // P6 S
            grid[idx(x - 1, y + 1)]!, // P7 SW
            grid[idx(x - 1, y)]!,     // P8 W
            grid[idx(x - 1, y - 1)]!, // P9 NW
          ] as [number, number, number, number, number, number, number, number];
          const B = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
          if (B < 2 || B > 6) continue;
          let A = 0;
          for (let i = 0; i < 8; i++) if (p[i] === 0 && p[(i + 1) % 8] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p[0] && p[2] && p[4]) continue; // P2*P4*P6
            if (p[2] && p[4] && p[6]) continue; // P4*P6*P8
          } else {
            if (p[0] && p[2] && p[6]) continue; // P2*P4*P8
            if (p[0] && p[4] && p[6]) continue; // P2*P6*P8
          }
          toRemove.push(idx(x, y));
        }
      }
      if (toRemove.length) {
        changed = true;
        for (const i of toRemove) grid[i] = 0;
      }
    }
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ── Step 2a: distance transform (2-pass chamfer) — value ≈ px to nearest background ─
function distanceTransform(grid: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  const idx = (x: number, y: number) => y * w + x;
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0; // outside = background
    return grid[idx(x, y)] ? d[idx(x, y)]! : 0;
  };
  for (let i = 0; i < w * h; i++) d[i] = grid[i] ? INF : 0;
  // Forward pass (top-left → bottom-right)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[idx(x, y)]) continue;
      let v = d[idx(x, y)]!;
      v = Math.min(v, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + SQRT2, at(x + 1, y - 1) + SQRT2);
      d[idx(x, y)] = v;
    }
  }
  // Backward pass (bottom-right → top-left)
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      if (!grid[idx(x, y)]) continue;
      let v = d[idx(x, y)]!;
      v = Math.min(v, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + SQRT2, at(x - 1, y + 1) + SQRT2);
      d[idx(x, y)] = v;
    }
  }
  return d;
}

// ── Step 2b: prune dead-end branches shorter than minLen (thinning fuzz) ───────────
function pruneSpurs(grid: Uint8Array, w: number, h: number, minLen: number): void {
  const idx = (x: number, y: number) => y * w + x;
  const neighbors = (x: number, y: number): Array<[number, number]> => {
    const r: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid[idx(nx, ny)]) r.push([nx, ny]);
      }
    }
    return r;
  };

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    const endpoints: Array<[number, number]> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[idx(x, y)] && neighbors(x, y).length === 1) endpoints.push([x, y]);
      }
    }
    for (const [ex, ey] of endpoints) {
      if (!grid[idx(ex, ey)]) continue; // already removed this pass
      // Walk the branch until we hit a junction (deg>2) or another endpoint.
      const path: Array<[number, number]> = [[ex, ey]];
      let px = -1;
      let py = -1;
      let cx = ex;
      let cy = ey;
      let endDeg = 1;
      while (true) {
        const ns = neighbors(cx, cy).filter(([a, b]) => !(a === px && b === py));
        if (ns.length !== 1) { endDeg = neighbors(cx, cy).length; break; }
        px = cx;
        py = cy;
        [cx, cy] = ns[0]!;
        path.push([cx, cy]);
        const deg = neighbors(cx, cy).length;
        if (deg !== 2) { endDeg = deg; break; }
      }
      // Prune only true fuzz: the far end is a junction and the branch is below the
      // (global) minLen. A real crossbar arm / tail is ~a full stroke width or longer,
      // so it always clears the bar. (A component ending in another endpoint is a real
      // stroke — leave it, e.g. the i-dot.)
      if (endDeg > 2 && path.length - 1 < minLen) {
        for (let i = 0; i < path.length - 1; i++) grid[idx(path[i]![0], path[i]![1])] = 0;
        changed = true;
      }
    }
  }
}

// ── Step 3: follow skeleton pixels into ordered polylines ──────────────────────────
function traceSkeleton(grid: Uint8Array, w: number, h: number): Array<Array<[number, number]>> {
  const idx = (x: number, y: number) => y * w + x;
  const visited = new Uint8Array(w * h);
  const neighbors = (x: number, y: number): Array<[number, number]> => {
    const r: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid[idx(nx, ny)]) r.push([nx, ny]);
      }
    }
    return r;
  };

  const polylines: Array<Array<[number, number]>> = [];

  function walk(sx: number, sy: number, fx: number, fy: number): Array<[number, number]> {
    const line: Array<[number, number]> = [[sx, sy]];
    let px = sx;
    let py = sy;
    let cx = fx;
    let cy = fy;
    while (true) {
      line.push([cx, cy]);
      visited[idx(cx, cy)] = 1;
      const ns = neighbors(cx, cy);
      if (ns.length !== 2) break; // endpoint or junction — stop
      const cont = ns.filter(([a, b]) => !(a === px && b === py));
      const next = cont.find(([a, b]) => !visited[idx(a, b)]) ?? cont[0];
      if (!next) break;
      px = cx;
      py = cy;
      [cx, cy] = next;
      if (visited[idx(cx, cy)]) { line.push([cx, cy]); break; }
    }
    return line;
  }

  // Seed from endpoints/junctions (neighbor count != 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[idx(x, y)]) continue;
      if (neighbors(x, y).length === 2) continue;
      visited[idx(x, y)] = 1;
      for (const [nx, ny] of neighbors(x, y)) {
        if (visited[idx(nx, ny)]) continue;
        polylines.push(walk(x, y, nx, ny));
      }
    }
  }
  // Remaining loops (e.g. 'O') have no endpoint/junction seed
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[idx(x, y)] || visited[idx(x, y)]) continue;
      const ns = neighbors(x, y);
      if (!ns.length) continue;
      visited[idx(x, y)] = 1;
      polylines.push(walk(x, y, ns[0]![0], ns[0]![1]));
    }
  }
  return polylines;
}

// ── Step 3a: light moving-average smoothing (endpoints fixed) to kill pixel jitter ─
function smoothPolyline(pts: Stroke, passes: number): Stroke {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]] as [number, number]);
  let cur: Stroke = pts.map((p) => [p[0], p[1]] as [number, number]);
  for (let pass = 0; pass < passes; pass++) {
    const next: Stroke = cur.map((p) => [p[0], p[1]] as [number, number]);
    for (let i = 1; i < cur.length - 1; i++) {
      next[i] = [
        cur[i - 1]![0] * 0.25 + cur[i]![0] * 0.5 + cur[i + 1]![0] * 0.25,
        cur[i - 1]![1] * 0.25 + cur[i]![1] * 0.5 + cur[i + 1]![1] * 0.25,
      ];
    }
    cur = next;
  }
  return cur;
}

// ── Step 3b: extend free endpoints out to the glyph edge (undo skeleton retraction) ─
function extendToEdges(line: Stroke, grid: Uint8Array, dist: Float32Array, w: number, h: number): Stroke {
  const idx = (x: number, y: number) => y * w + x;
  const isFill = (x: number, y: number): boolean => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    return rx >= 0 && ry >= 0 && rx < w && ry < h && dist[idx(rx, ry)]! > 0;
  };
  const degree = ([x, y]: [number, number]): number => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid[idx(nx, ny)]) c++;
      }
    }
    return c;
  };
  // March from the end point along the local tangent until leaving the glyph fill.
  const tip = (pts: Stroke, atEnd: boolean): [number, number] | null => {
    const n = pts.length;
    const end = atEnd ? pts[n - 1]! : pts[0]!;
    const k = Math.min(4, n - 1);
    const inner = atEnd ? pts[n - 1 - k]! : pts[k]!;
    let dx = end[0] - inner[0];
    let dy = end[1] - inner[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    dx /= len;
    dy /= len;
    const maxSteps = Math.ceil((dist[idx(Math.round(end[0]), Math.round(end[1]))] || 1) * 1.8) + 3;
    let best: [number, number] | null = null;
    for (let s = 1; s <= maxSteps; s++) {
      const x = end[0] + dx * s;
      const y = end[1] + dy * s;
      if (!isFill(x, y)) break; // reached the edge
      best = [x, y];
    }
    return best;
  };

  const result: Stroke = line.map((p) => [p[0], p[1]] as [number, number]);
  if (degree(result[0]!) === 1) {
    const t = tip(result, false);
    if (t) result.unshift(t);
  }
  if (degree(result[result.length - 1]!) === 1) {
    const t = tip(result, true);
    if (t) result.push(t);
  }
  return result;
}

// ── Step 3c: split a dense polyline at real corners (windowed turn angle) ───────────
const CORNER_COS = Math.cos((CORNER_DEG * Math.PI) / 180);

function splitAtCorners(pts: Stroke, k: number): Stroke[] {
  if (pts.length <= 2) return [pts];
  const corners: number[] = [];
  for (let i = k; i < pts.length - k; i++) {
    const ax = pts[i]![0] - pts[i - k]![0];
    const ay = pts[i]![1] - pts[i - k]![1];
    const bx = pts[i + k]![0] - pts[i]![0];
    const by = pts[i + k]![1] - pts[i]![1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < CORNER_COS) corners.push(i);
  }
  const bounds = [0, ...corners, pts.length - 1];
  const runs: Stroke[] = [];
  for (let c = 0; c < bounds.length - 1; c++) {
    const run = pts.slice(bounds[c]!, bounds[c + 1]! + 1);
    if (run.length >= 2) runs.push(run);
  }
  return runs;
}

// ── Step 4: Douglas–Peucker simplification ─────────────────────────────────────────
function simplify(points: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const [ax, ay] = points[0]!;
  const [bx, by] = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i]!, ax, ay, bx, by);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist > eps) {
    const left = simplify(points.slice(0, index + 1), eps);
    const right = simplify(points.slice(index), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0]!, points[points.length - 1]!];
}

function perpDist([px, py]: [number, number], ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

// ── Step 5: serialize to a smooth path. Each stroke is already a single corner-free
// run (split happened on the dense line), so just render it as one smooth Catmull-Rom →
// cubic-Bézier curve; adjacent runs meet at the shared corner point, staying crisp. ───
function smoothStrokesToPathD(strokes: Stroke[]): string {
  return strokes.map(catmullRomPath).filter(Boolean).join(" ");
}

function catmullRomPath(pts: Stroke): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M${r(pts[0]!)} L${r(pts[1]!)}`;
  return `M${r(pts[0]!)}${catmullRom(pts)}`;
}

// Catmull-Rom through `run` as cubic Béziers, tangents clamped at the run ends.
function catmullRom(run: Stroke): string {
  if (run.length === 2) return ` L${r(run[1]!)}`;
  let d = "";
  for (let i = 0; i < run.length - 1; i++) {
    const p0 = run[i - 1] ?? run[i]!;
    const p1 = run[i]!;
    const p2 = run[i + 1]!;
    const p3 = run[i + 2] ?? run[i + 1]!;
    const cp1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const cp2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r(cp1)} ${r(cp2)} ${r(p2)}`;
  }
  return d;
}

function r(p: [number, number]): string {
  return `${Math.round(p[0] * 100) / 100} ${Math.round(p[1] * 100) / 100}`;
}
