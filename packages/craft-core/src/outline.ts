// Geometry behind two object options that are stored as settings and generated
// when drawn or cut, so they can always be changed or switched off again:
//  • a dashed line (cut as dashes, cardstock folds along it), and
//  • an outline at a distance around an object (a border or shadow layer).

import type { Point } from "./svg-path-geometry";

// ── Dashed lines ────────────────────────────────────────────────────────────

export type DashSettings = {
  enabled: boolean;
  /** Length of each cut or drawn piece, in millimetres. */
  dashMm: number;
  /** Length of the bridge left between two pieces, in millimetres. */
  gapMm: number;
};

export const DASH_LIMITS = { dashMm: { min: 1, max: 10 }, gapMm: { min: 1, max: 10 } } as const;

/** 3 mm cuts with 3 mm bridges: folds cleanly in cardstock and stays in one piece. */
export const DEFAULT_DASH: DashSettings = { enabled: true, dashMm: 3, gapMm: 3 };

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeDash(value: unknown): DashSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled !== false,
    dashMm: clampNumber(record.dashMm, DASH_LIMITS.dashMm.min, DASH_LIMITS.dashMm.max, DEFAULT_DASH.dashMm),
    gapMm: clampNumber(record.gapMm, DASH_LIMITS.gapMm.min, DASH_LIMITS.gapMm.max, DEFAULT_DASH.gapMm),
  };
}

function pointAt(points: Point[], lengths: number[], distance: number, from: number): { point: Point; segment: number } {
  let segment = from;
  while (segment < lengths.length - 1 && distance > (lengths[segment + 1] ?? 0)) segment++;
  const start = points[segment] ?? { x: 0, y: 0 };
  const end = points[segment + 1] ?? start;
  const span = (lengths[segment + 1] ?? 0) - (lengths[segment] ?? 0);
  const t = span > 0 ? (distance - (lengths[segment] ?? 0)) / span : 0;
  return { point: { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, segment };
}

/**
 * Cuts a polyline into dashes. The pattern is stretched slightly so it fits a
 * whole number of times: an open line starts and ends with a bridge (the ends of
 * a fold stay attached), a closed one gets evenly spaced dashes all the way round.
 * Lengths are in the same units as the points.
 */
export function dashPolyline(points: Point[], closed: boolean, dash: number, gap: number): Point[][] {
  if (points.length < 2 || !(dash > 0) || !(gap > 0)) return points.length > 1 ? [points] : [];
  const path = closed && (points[0]?.x !== points[points.length - 1]?.x || points[0]?.y !== points[points.length - 1]?.y)
    ? [...points, points[0] as Point]
    : points;
  const lengths = [0];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1] as Point;
    const b = path[index] as Point;
    lengths.push((lengths[index - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1] ?? 0;
  if (total <= 0) return [];
  // Too short for a dash and its bridges: keep a single centred dash.
  if (!closed && total <= dash + gap) {
    const margin = Math.min(gap / 2, total / 4);
    return [sliceByDistance(path, lengths, margin, total - margin)];
  }
  const count = Math.max(1, Math.round(closed ? total / (dash + gap) : (total - gap) / (dash + gap)));
  // Keep the dash length, let the bridges take up the slack.
  const bridge = closed ? total / count - dash : (total - count * dash) / (count + 1);
  const dashLength = bridge > 0 ? dash : (total / count) * (dash / (dash + gap));
  const bridgeLength = bridge > 0 ? bridge : closed ? total / count - dashLength : (total - count * dashLength) / (count + 1);
  const result: Point[][] = [];
  for (let index = 0; index < count; index++) {
    const start = closed ? index * (dashLength + bridgeLength) : bridgeLength + index * (dashLength + bridgeLength);
    result.push(sliceByDistance(path, lengths, start, Math.min(total, start + dashLength)));
  }
  return result.filter((piece) => piece.length > 1);
}

function sliceByDistance(points: Point[], lengths: number[], from: number, to: number): Point[] {
  const start = pointAt(points, lengths, from, 0);
  const end = pointAt(points, lengths, to, start.segment);
  const piece: Point[] = [start.point];
  for (let index = start.segment + 1; index <= end.segment; index++) {
    piece.push(points[index] as Point);
  }
  piece.push(end.point);
  return piece;
}

// ── Outline around an object ────────────────────────────────────────────────

export type OutlineSettings = {
  enabled: boolean;
  /** How far the outline sits from the object, in millimetres. */
  distanceMm: number;
  /** The pen that draws the outline, or null to cut it. */
  penId: string | null;
  /** Keep the openings inside the outline (the inside of an "O") instead of one solid shape. */
  holes: boolean;
};

export const OUTLINE_LIMITS = { distanceMm: { min: 0.5, max: 15 } } as const;

export const DEFAULT_OUTLINE: OutlineSettings = { enabled: true, distanceMm: 3, penId: null, holes: false };

export function normalizeOutline(value: unknown): OutlineSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled !== false,
    distanceMm: clampNumber(record.distanceMm, OUTLINE_LIMITS.distanceMm.min, OUTLINE_LIMITS.distanceMm.max, DEFAULT_OUTLINE.distanceMm),
    penId: typeof record.penId === "string" && record.penId ? record.penId : null,
    holes: record.holes === true,
  };
}

export type ContourLoop = {
  points: Point[];
  /** Signed area: positive for an outer edge, negative for a hole. */
  area: number;
};

export function polygonSignedArea(points: Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index] as Point;
    const b = points[(index + 1) % points.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Traces the edges of a coverage image (one value 0-255 per pixel, row by row)
 * as closed loops, placing each edge between pixels by their coverage so the
 * result is smoother than the pixel grid. Coordinates are in pixels, with a
 * pixel's centre at +0.5. Outer edges have a positive area, holes a negative one.
 */
export function traceAlphaContours(alpha: ArrayLike<number>, width: number, height: number, threshold = 128): ContourLoop[] {
  if (width <= 0 || height <= 0) return [];
  // One empty pixel all round, so every edge closes.
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const grid = new Float32Array(paddedWidth * paddedHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[(y + 1) * paddedWidth + x + 1] = alpha[y * width + x] ?? 0;
    }
  }
  // Grid edges are numbered: 2·cell for the edge to the right neighbour, +1 for the one below.
  const horizontal = (x: number, y: number) => 2 * (y * paddedWidth + x);
  const vertical = (x: number, y: number) => 2 * (y * paddedWidth + x) + 1;
  const next = new Map<number, number>();
  for (let y = 0; y < paddedHeight - 1; y++) {
    for (let x = 0; x < paddedWidth - 1; x++) {
      const tl = (grid[y * paddedWidth + x] ?? 0) >= threshold;
      const tr = (grid[y * paddedWidth + x + 1] ?? 0) >= threshold;
      const br = (grid[(y + 1) * paddedWidth + x + 1] ?? 0) >= threshold;
      const bl = (grid[(y + 1) * paddedWidth + x] ?? 0) >= threshold;
      const kind = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (kind === 0 || kind === 15) continue;
      const top = horizontal(x, y);
      const bottom = horizontal(x, y + 1);
      const left = vertical(x, y);
      const right = vertical(x + 1, y);
      // Each piece runs with the inside on its right-hand side.
      switch (kind) {
        case 1: next.set(left, bottom); break;
        case 2: next.set(bottom, right); break;
        case 3: next.set(left, right); break;
        case 4: next.set(right, top); break;
        case 6: next.set(bottom, top); break;
        case 7: next.set(left, top); break;
        case 8: next.set(top, left); break;
        case 9: next.set(top, bottom); break;
        case 11: next.set(top, right); break;
        case 12: next.set(right, left); break;
        case 13: next.set(right, bottom); break;
        case 14: next.set(bottom, left); break;
        case 5:
        case 10: {
          // Two opposite corners: the middle decides whether they belong together.
          const middle = ((grid[y * paddedWidth + x] ?? 0) + (grid[y * paddedWidth + x + 1] ?? 0)
            + (grid[(y + 1) * paddedWidth + x + 1] ?? 0) + (grid[(y + 1) * paddedWidth + x] ?? 0)) / 4 >= threshold;
          if (kind === 5) {
            if (middle) { next.set(left, top); next.set(right, bottom); }
            else { next.set(right, top); next.set(left, bottom); }
          } else if (middle) { next.set(top, right); next.set(bottom, left); }
          else { next.set(top, left); next.set(bottom, right); }
          break;
        }
      }
    }
  }

  const edgePoint = (edge: number): Point => {
    const cell = edge >> 1;
    const x = cell % paddedWidth;
    const y = (cell - x) / paddedWidth;
    const a = grid[cell] ?? 0;
    if ((edge & 1) === 0) {
      const b = grid[cell + 1] ?? 0;
      const t = b === a ? 0.5 : (threshold - a) / (b - a);
      // Padded pixel (x, y) is image pixel (x - 1, y - 1), whose centre is at -0.5.
      return { x: x + t - 0.5, y: y - 0.5 };
    }
    const b = grid[cell + paddedWidth] ?? 0;
    const t = b === a ? 0.5 : (threshold - a) / (b - a);
    return { x: x - 0.5, y: y + t - 0.5 };
  };

  const loops: ContourLoop[] = [];
  const seen = new Set<number>();
  for (const startEdge of next.keys()) {
    if (seen.has(startEdge)) continue;
    const points: Point[] = [];
    let edge: number | undefined = startEdge;
    while (edge !== undefined && !seen.has(edge)) {
      seen.add(edge);
      points.push(edgePoint(edge));
      edge = next.get(edge);
    }
    if (edge === startEdge && points.length >= 3) {
      loops.push({ points, area: polygonSignedArea(points) });
    }
  }
  return loops;
}

/** Removes points that lie within `tolerance` of the line through their neighbours. */
export function simplifyClosedPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 4 || !(tolerance > 0)) return points;
  // Split the loop at its two most distant points (roughly) and simplify both halves.
  const first = points[0] as Point;
  let farIndex = 0;
  let farDistance = -1;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - first.x, point.y - first.y);
    if (distance > farDistance) { farDistance = distance; farIndex = index; }
  });
  if (farIndex === 0) return points;
  const keep = new Uint8Array(points.length + 1);
  const ring = [...points, first];
  keep[0] = 1;
  keep[farIndex] = 1;
  keep[points.length] = 1;
  const stack: Array<[number, number]> = [[0, farIndex], [farIndex, points.length]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    if (to - from < 2) continue;
    const a = ring[from] as Point;
    const b = ring[to] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = -1;
    let worstDistance = tolerance;
    for (let index = from + 1; index < to; index++) {
      const p = ring[index] as Point;
      const distance = length > 0
        ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length
        : Math.hypot(p.x - a.x, p.y - a.y);
      if (distance > worstDistance) { worstDistance = distance; worst = index; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  return points.filter((_point, index) => keep[index] === 1);
}
