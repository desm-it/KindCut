// Pure SVG path geometry: parses path data and flattens curves and arcs into
// polylines, so fills and hit tests can work on plain point lists.

export type Point = { x: number; y: number };

/** Affine matrix in SVG order: [a, b, c, d, e, f] maps (x, y) to (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = [number, number, number, number, number, number];

export type FlatSubpath = { points: Point[]; closed: boolean };

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/** Parses an SVG transform list such as `translate(10 5) rotate(30) matrix(…)`. Unknown parts are ignored. */
export function parseSvgTransform(transform: string | null | undefined): Matrix {
  let result: Matrix = IDENTITY_MATRIX;
  if (!transform) {
    return result;
  }
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of transform.matchAll(pattern)) {
    const name = match[1];
    const args = (match[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.some((value) => !Number.isFinite(value))) {
      continue;
    }
    let next: Matrix | null = null;
    switch (name) {
      case "matrix":
        if (args.length === 6) next = args as Matrix;
        break;
      case "translate":
        next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const radians = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        next = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case "skewX":
        next = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        next = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    if (next) {
      result = multiplyMatrices(result, next);
    }
  }
  return result;
}

// ── Path data parsing ────────────────────────────────────────────────────────

const PARAM_COUNTS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

type PathCommand = { command: string; args: number[] };

/** Tokenises path data, reading arc flags as single digits so compact forms like `a1 1 0 00 1 1` parse. */
export function parseSvgPathData(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  let index = 0;
  const length = d.length;

  const skipSeparators = () => {
    while (index < length && /[\s,]/.test(d[index] ?? "")) index += 1;
  };
  const readNumber = (): number | null => {
    skipSeparators();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(index, index + 64));
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  };
  const readFlag = (): number | null => {
    skipSeparators();
    const char = d[index];
    if (char !== "0" && char !== "1") return null;
    index += 1;
    return Number(char);
  };

  let current: string | null = null;
  while (index < length) {
    skipSeparators();
    if (index >= length) break;
    const char = d[index] ?? "";
    if (/[a-zA-Z]/.test(char)) {
      if (!(char.toLowerCase() in PARAM_COUNTS)) break;
      current = char;
      index += 1;
      if (char.toLowerCase() === "z") {
        commands.push({ command: char, args: [] });
        current = null;
      }
      continue;
    }
    if (!current) break;

    const lower = current.toLowerCase();
    const count = PARAM_COUNTS[lower] ?? 0;
    const args: number[] = [];
    for (let argIndex = 0; argIndex < count; argIndex += 1) {
      const value = lower === "a" && (argIndex === 3 || argIndex === 4) ? readFlag() : readNumber();
      if (value === null) return commands;
      args.push(value);
    }
    commands.push({ command: current, args });
    // Extra coordinate pairs after a moveto are implicit linetos.
    if (current === "M") current = "L";
    else if (current === "m") current = "l";
  }
  return commands;
}

// ── Flattening ───────────────────────────────────────────────────────────────

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cubicSegmentCount(p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number): number {
  // Wang's formula for cubic Béziers.
  const ddx = Math.max(Math.abs(p0.x - 2 * p1.x + p2.x), Math.abs(p1.x - 2 * p2.x + p3.x));
  const ddy = Math.max(Math.abs(p0.y - 2 * p1.y + p2.y), Math.abs(p1.y - 2 * p2.y + p3.y));
  return Math.min(256, Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / tolerance))));
}

function pushCubic(out: Point[], p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number): void {
  const count = cubicSegmentCount(p0, p1, p2, p3, tolerance);
  for (let step = 1; step <= count; step += 1) {
    const t = step / count;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const e = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y });
  }
}

function pushQuadratic(out: Point[], p0: Point, p1: Point, p2: Point, tolerance: number): void {
  const dd = Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y);
  const count = Math.min(256, Math.max(1, Math.ceil(Math.sqrt((0.25 * dd) / tolerance))));
  for (let step = 1; step <= count; step += 1) {
    const t = step / count;
    const mt = 1 - t;
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    });
  }
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
  return sign * Math.acos(Math.min(1, Math.max(-1, dot)));
}

/** Flattens an SVG elliptical arc using the endpoint-to-center conversion from the SVG spec (F.6.5). */
function pushArc(
  out: Point[],
  from: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: number,
  sweep: number,
  to: Point,
  tolerance: number,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) {
    out.push(to);
    return;
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

  const startAngle = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const radius = Math.max(rx, ry);
  const maxStep = radius > tolerance ? 2 * Math.acos(1 - tolerance / radius) : Math.PI / 2;
  const count = Math.min(512, Math.max(1, Math.ceil(Math.abs(delta) / Math.max(maxStep, 1e-3))));
  for (let step = 1; step <= count; step += 1) {
    const angle = startAngle + (delta * step) / count;
    const x = rx * Math.cos(angle);
    const y = ry * Math.sin(angle);
    out.push(step === count ? to : { x: cosPhi * x - sinPhi * y + cx, y: sinPhi * x + cosPhi * y + cy });
  }
}

/**
 * Flattens path data into polylines. `tolerance` is the maximum distance (in
 * path units) between a curve and its polyline.
 */
export function flattenSvgPath(d: string, tolerance = 0.25): FlatSubpath[] {
  const subpaths: FlatSubpath[] = [];
  let points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastControl: Point | null = null;
  let lastCommand = "";

  const finish = (closed: boolean) => {
    if (points.length > 1) {
      subpaths.push({ points, closed });
    }
    points = [];
  };

  for (const { command, args } of parseSvgPathData(d)) {
    const relative = command === command.toLowerCase();
    const lower = command.toLowerCase();
    const ox = relative ? current.x : 0;
    const oy = relative ? current.y : 0;
    const arg = (position: number) => args[position] ?? 0;

    switch (lower) {
      case "m":
        finish(false);
        current = { x: ox + arg(0), y: oy + arg(1) };
        start = current;
        points = [current];
        break;
      case "l":
        current = { x: ox + arg(0), y: oy + arg(1) };
        points.push(current);
        break;
      case "h":
        current = { x: ox + arg(0), y: current.y };
        points.push(current);
        break;
      case "v":
        current = { x: current.x, y: oy + arg(0) };
        points.push(current);
        break;
      case "c": {
        const c1 = { x: ox + arg(0), y: oy + arg(1) };
        const c2 = { x: ox + arg(2), y: oy + arg(3) };
        const end = { x: ox + arg(4), y: oy + arg(5) };
        pushCubic(points, current, c1, c2, end, tolerance);
        lastControl = c2;
        current = end;
        break;
      }
      case "s": {
        const reflected = lastControl && /[cs]/i.test(lastCommand)
          ? { x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y }
          : current;
        const c2 = { x: ox + arg(0), y: oy + arg(1) };
        const end = { x: ox + arg(2), y: oy + arg(3) };
        pushCubic(points, current, reflected, c2, end, tolerance);
        lastControl = c2;
        current = end;
        break;
      }
      case "q": {
        const control = { x: ox + arg(0), y: oy + arg(1) };
        const end = { x: ox + arg(2), y: oy + arg(3) };
        pushQuadratic(points, current, control, end, tolerance);
        lastControl = control;
        current = end;
        break;
      }
      case "t": {
        const control: Point = lastControl && /[qt]/i.test(lastCommand)
          ? { x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y }
          : current;
        const end = { x: ox + arg(0), y: oy + arg(1) };
        pushQuadratic(points, current, control, end, tolerance);
        lastControl = control;
        current = end;
        break;
      }
      case "a": {
        const end = { x: ox + arg(5), y: oy + arg(6) };
        pushArc(points, current, arg(0), arg(1), arg(2), arg(3), arg(4), end, tolerance);
        current = end;
        break;
      }
      case "z":
        if (points.length > 0 && distance(points[points.length - 1] ?? start, start) > 1e-9) {
          points.push(start);
        }
        finish(true);
        current = start;
        points = [start];
        break;
    }
    if (!/[cqst]/.test(lower)) {
      lastControl = null;
    }
    lastCommand = command;
  }
  finish(false);
  return subpaths;
}

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Cuts a polyline at the edges of `rect` and returns the runs that lie inside
 * (Liang–Barsky per segment, joining consecutive inside pieces).
 */
export function clipPolylineToRect(points: Point[], rect: Rect): Point[][] {
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const runs: Point[][] = [];
  let run: Point[] | null = null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index] as Point;
    const b = points[index + 1] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    let visible = true;
    for (const [p, q] of [[-dx, a.x - minX], [dx, maxX - a.x], [-dy, a.y - minY], [dy, maxY - a.y]] as const) {
      if (p === 0) {
        if (q < 0) visible = false;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (!visible || t0 > t1) {
      run = null;
      continue;
    }
    const start = t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy };
    const end = t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy };
    const last = run?.[run.length - 1];
    if (run && last && t0 === 0 && last.x === start.x && last.y === start.y) {
      run.push(end);
    } else {
      run = [start, end];
      runs.push(run);
    }
    // Leaving through an edge ends this run; the next inside piece starts a new one.
    if (t1 < 1) run = null;
  }
  return runs.filter((candidate) => candidate.length > 1);
}

export function formatPolylinePath(polylines: Array<{ points: Point[]; closed?: boolean }>, decimals = 3): string {
  const factor = 10 ** decimals;
  const format = (value: number) => String(Math.round(value * factor) / factor);
  return polylines
    .filter((polyline) => polyline.points.length > 1)
    .map((polyline) => {
      const [first, ...rest] = polyline.points;
      const head = `M${format(first?.x ?? 0)} ${format(first?.y ?? 0)}`;
      const body = rest.map((point) => `L${format(point.x)} ${format(point.y)}`).join("");
      return `${head}${body}${polyline.closed ? "Z" : ""}`;
    })
    .join("");
}
