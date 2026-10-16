// Pen fill ("infill"): hatches the inside of a shape with a repeating pattern,
// like a 3D-printer slicer, so a pen can shade an area instead of only drawing
// its outline.
//
// Fills are stored on objects as settings only (pattern, density, angle) and
// regenerated whenever they are drawn, previewed or sent to the cutter, so a
// fill can always be changed or removed again.

import type { Point } from "./svg-path-geometry";

export const PEN_FILL_PATTERNS = ["lines", "cross", "grid", "triangles", "cubic", "honeycomb", "dots"] as const;
export type PenFillPattern = (typeof PEN_FILL_PATTERNS)[number];

export type PenFillSettings = {
  enabled: boolean;
  pattern: PenFillPattern;
  /** Ink coverage in percent (1–100): 100 means lines touch and the area turns solid. */
  density: number;
  /** Pattern rotation in degrees. */
  angle: number;
};

export const DEFAULT_PEN_FILL: PenFillSettings = { enabled: true, pattern: "lines", density: 25, angle: 45 };

export const PEN_FILL_DENSITY_MIN = 5;
export const PEN_FILL_DENSITY_MAX = 100;

/** Cricut fine point pens draw a line about 0.4 mm wide. */
export const PEN_LINE_WIDTH_MM = 0.4;

export type FillRule = "nonzero" | "evenodd";

/** One painted region: closed rings plus the rule deciding which parts are inside. */
export type FillRegion = { rings: Point[][]; fillRule: FillRule };

export type PenFillPolyline = { points: Point[]; closed: boolean };

export type PenFillOptions = {
  /** Pen line width, in the same units as the region coordinates. */
  penWidth: number;
  /** Safety cap on generated pattern pieces, so a huge, dense fill can't freeze the app. */
  maxElements?: number;
};

const DEFAULT_MAX_ELEMENTS = 60_000;
const EPSILON = 1e-9;

/** Accepts anything (e.g. from a project file) and returns valid settings, or null. */
export function normalizePenFill(value: unknown): PenFillSettings | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pattern = PEN_FILL_PATTERNS.includes(record.pattern as PenFillPattern)
    ? (record.pattern as PenFillPattern)
    : DEFAULT_PEN_FILL.pattern;
  const density = Number(record.density);
  const angle = Number(record.angle);
  return {
    enabled: record.enabled !== false,
    pattern,
    density: Number.isFinite(density)
      ? Math.min(PEN_FILL_DENSITY_MAX, Math.max(PEN_FILL_DENSITY_MIN, Math.round(density)))
      : DEFAULT_PEN_FILL.density,
    angle: Number.isFinite(angle) ? ((Math.round(angle) % 180) + 180) % 180 : DEFAULT_PEN_FILL.angle,
  };
}

// ── Region queries in a rotated "pattern frame" ──────────────────────────────

type Edge = { ax: number; ay: number; bx: number; by: number; minY: number; maxY: number; region: number; dir: number };

function rotatePoint(point: Point, cos: number, sin: number): Point {
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/**
 * The fill regions rotated so the pattern's rows run horizontally, with their
 * edges bucketed by height for fast row queries.
 */
class PatternFrame {
  readonly edges: Edge[] = [];
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  private readonly buckets = new Map<number, Edge[]>();
  private readonly bucketSize: number;
  private readonly rules: FillRule[];
  private readonly cos: number;
  private readonly sin: number;

  constructor(regions: FillRegion[], angleDeg: number, bucketSize: number) {
    const radians = (-angleDeg * Math.PI) / 180;
    this.cos = Math.cos(radians);
    this.sin = Math.sin(radians);
    this.bucketSize = Math.max(bucketSize, EPSILON);
    this.rules = regions.map((region) => region.fillRule);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    regions.forEach((region, regionIndex) => {
      for (const ring of region.rings) {
        if (ring.length < 3) continue;
        const rotated = ring.map((point) => rotatePoint(point, this.cos, this.sin));
        for (let index = 0; index < rotated.length; index += 1) {
          const a = rotated[index] as Point;
          const b = rotated[(index + 1) % rotated.length] as Point;
          minX = Math.min(minX, a.x);
          maxX = Math.max(maxX, a.x);
          minY = Math.min(minY, a.y);
          maxY = Math.max(maxY, a.y);
          if (Math.abs(a.y - b.y) < EPSILON && Math.abs(a.x - b.x) < EPSILON) continue;
          const edge: Edge = {
            ax: a.x, ay: a.y, bx: b.x, by: b.y,
            minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
            region: regionIndex, dir: b.y > a.y ? 1 : -1,
          };
          this.edges.push(edge);
          const first = Math.floor(edge.minY / this.bucketSize);
          const last = Math.floor(edge.maxY / this.bucketSize);
          for (let bucket = first; bucket <= last; bucket += 1) {
            const list = this.buckets.get(bucket);
            if (list) list.push(edge);
            else this.buckets.set(bucket, [edge]);
          }
        }
      }
    });
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
  }

  /** Converts a region point into this frame. */
  fromRegion(point: Point): Point {
    return rotatePoint(point, this.cos, this.sin);
  }

  get isEmpty(): boolean {
    return this.edges.length === 0 || !(this.maxX > this.minX) || !(this.maxY > this.minY);
  }

  /** Converts a pattern-frame point back to region coordinates. */
  toRegion(point: Point): Point {
    return rotatePoint(point, this.cos, -this.sin);
  }

  edgesInBand(y0: number, y1: number): Edge[] {
    const first = Math.floor(Math.min(y0, y1) / this.bucketSize);
    const last = Math.floor(Math.max(y0, y1) / this.bucketSize);
    if (first === last) return this.buckets.get(first) ?? [];
    const seen = new Set<Edge>();
    for (let bucket = first; bucket <= last; bucket += 1) {
      for (const edge of this.buckets.get(bucket) ?? []) seen.add(edge);
    }
    return [...seen];
  }

  private isInsideRegions(windings: number[]): boolean {
    return windings.some((winding, region) => (this.rules[region] === "evenodd" ? winding % 2 !== 0 : winding !== 0));
  }

  /** Union of each region's inside intervals along the horizontal line at `y`. */
  insideIntervals(y: number): Array<[number, number]> {
    const crossings: Array<{ x: number; region: number; dir: number }> = [];
    for (const edge of this.edgesInBand(y, y)) {
      // Half-open in y so a vertex shared by two edges is counted once.
      if (y < edge.minY || y >= edge.maxY) continue;
      const t = (y - edge.ay) / (edge.by - edge.ay);
      crossings.push({ x: edge.ax + t * (edge.bx - edge.ax), region: edge.region, dir: edge.dir });
    }
    crossings.sort((a, b) => a.x - b.x);

    const windings = this.rules.map(() => 0);
    const intervals: Array<[number, number]> = [];
    let openAt: number | null = null;
    for (const crossing of crossings) {
      windings[crossing.region] = (windings[crossing.region] ?? 0) + crossing.dir;
      const inside = this.isInsideRegions(windings);
      if (inside && openAt === null) {
        openAt = crossing.x;
      } else if (!inside && openAt !== null) {
        if (crossing.x - openAt > EPSILON) intervals.push([openAt, crossing.x]);
        openAt = null;
      }
    }
    return intervals;
  }

  containsPoint(point: Point): boolean {
    const windings = this.rules.map(() => 0);
    for (const edge of this.edgesInBand(point.y, point.y)) {
      if (point.y < edge.minY || point.y >= edge.maxY) continue;
      const t = (point.y - edge.ay) / (edge.by - edge.ay);
      if (edge.ax + t * (edge.bx - edge.ax) > point.x) {
        windings[edge.region] = (windings[edge.region] ?? 0) + edge.dir;
      }
    }
    return this.isInsideRegions(windings);
  }

  /** Splits segment a→b at the outline and returns the parts that lie inside. */
  clipSegment(a: Point, b: Point): Array<[Point, Point]> {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cuts = [0, 1];
    for (const edge of this.edgesInBand(a.y, b.y)) {
      const ex = edge.bx - edge.ax;
      const ey = edge.by - edge.ay;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < EPSILON) continue;
      const t = ((edge.ax - a.x) * ey - (edge.ay - a.y) * ex) / denominator;
      const u = ((edge.ax - a.x) * dy - (edge.ay - a.y) * dx) / denominator;
      if (t > EPSILON && t < 1 - EPSILON && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((left, right) => left - right);

    const pieces: Array<[Point, Point]> = [];
    let pieceStart: number | null = null;
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const t0 = cuts[index] as number;
      const t1 = cuts[index + 1] as number;
      if (t1 - t0 < EPSILON) continue;
      const mid = (t0 + t1) / 2;
      const inside = this.containsPoint({ x: a.x + dx * mid, y: a.y + dy * mid });
      if (inside && pieceStart === null) pieceStart = t0;
      if (!inside && pieceStart !== null) {
        pieces.push([{ x: a.x + dx * pieceStart, y: a.y + dy * pieceStart }, { x: a.x + dx * t0, y: a.y + dy * t0 }]);
        pieceStart = null;
      }
    }
    if (pieceStart !== null) {
      pieces.push([{ x: a.x + dx * pieceStart, y: a.y + dy * pieceStart }, b]);
    }
    return pieces;
  }

  /**
   * True when the straight move a→b between two outline points never leaves
   * the shape, so two hatch lines can be joined without lifting the pen. A
   * move running exactly along the outline counts as inside.
   */
  segmentStaysInside(a: Point, b: Point, tolerance: number): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const band = this.edgesInBand(Math.min(a.y, b.y) - tolerance, Math.max(a.y, b.y) + tolerance);
    for (const edge of band) {
      const ex = edge.bx - edge.ax;
      const ey = edge.by - edge.ay;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < EPSILON) continue;
      const t = ((edge.ax - a.x) * ey - (edge.ay - a.y) * ex) / denominator;
      const u = ((edge.ax - a.x) * dy - (edge.ay - a.y) * dx) / denominator;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-9 && u < 1 - 1e-9) return false;
    }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return this.containsPoint(mid) || band.some((edge) => distanceToEdge(mid, edge) <= tolerance);
  }
}

function distanceToEdge(point: Point, edge: Edge): number {
  const ex = edge.bx - edge.ax;
  const ey = edge.by - edge.ay;
  const lengthSquared = ex * ex + ey * ey;
  const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((point.x - edge.ax) * ex + (point.y - edge.ay) * ey) / lengthSquared)) : 0;
  return Math.hypot(point.x - (edge.ax + t * ex), point.y - (edge.ay + t * ey));
}

// ── Pattern generators ───────────────────────────────────────────────────────

type Polyline = Point[];

/** Parallel hatch lines in the frame, alternating direction and joined along the outline where possible. */
function hatchLines(frame: PatternFrame, spacing: number, offset: number): Polyline[] {
  const polylines: Polyline[] = [];
  const firstRow = Math.ceil((frame.minY - offset) / spacing);
  const lastRow = Math.floor((frame.maxY - offset) / spacing);
  const maxJoin = spacing * 3;
  let current: Polyline | null = null;
  let forward = true;

  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = offset + row * spacing;
    const intervals = frame.insideIntervals(y);
    if (intervals.length === 0) continue;
    const ordered = forward ? intervals : [...intervals].reverse();
    for (const [x0, x1] of ordered) {
      const start = { x: forward ? x0 : x1, y };
      const end = { x: forward ? x1 : x0, y };
      const previous = current?.[current.length - 1];
      if (
        current &&
        previous &&
        Math.hypot(start.x - previous.x, start.y - previous.y) <= maxJoin &&
        frame.segmentStaysInside(previous, start, spacing * 1e-3)
      ) {
        current.push(start, end);
      } else {
        current = [start, end];
        polylines.push(current);
      }
    }
    forward = !forward;
  }
  return polylines;
}

/** Clips a lattice polyline to the shape, keeping runs that stay inside as single polylines. */
function clipPolyline(frame: PatternFrame, points: Point[], out: Polyline[]): void {
  let run: Polyline | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index] as Point;
    const b = points[index + 1] as Point;
    for (const [start, end] of frame.clipSegment(a, b)) {
      const last = run?.[run.length - 1];
      if (run && last && Math.hypot(last.x - start.x, last.y - start.y) < 1e-6) {
        run.push(end);
      } else {
        run = [start, end];
        out.push(run);
      }
    }
  }
}


// ── Lattices ─────────────────────────────────────────────────────────────────
//
// Every pattern is a lattice in "pattern space": region coordinates rotated by
// the lattice rotation. The same lattice drives both the cutter strokes
// (clipped to the shape) and the canvas preview tile, so they always line up.

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

type LineLattice = {
  kind: "lines";
  rotation: number;
  spacing: number;
  /** Line directions in degrees, relative to the lattice rotation. */
  families: number[];
  tileWidth: number;
  tileHeight: number;
};
type HexLattice = { kind: "hex"; rotation: number; side: number; cubes: boolean; tileWidth: number; tileHeight: number };
type DotLattice = { kind: "dots"; rotation: number; spacing: number; tileWidth: number; tileHeight: number };
type Lattice = LineLattice | HexLattice | DotLattice;

/** Pattern geometry for a coverage ratio (0–1): the feature size that gives that much ink. */
function patternScale(pattern: PenFillPattern, penWidth: number, coverage: number): number {
  switch (pattern) {
    case "lines":
      return penWidth / coverage;
    case "cross":
    case "grid":
      return (2 * penWidth) / coverage;
    case "triangles":
      return (3 * penWidth) / coverage;
    case "honeycomb":
      // Hexagon side a: line length per area is 2/(√3·a).
      return (2 * penWidth) / (Math.sqrt(3) * coverage);
    case "cubic":
      // Honeycomb plus an inner "Y" per hexagon doubles the line length.
      return (4 * penWidth) / (Math.sqrt(3) * coverage);
    case "dots":
      // A dot covers about π·w² and each sits in a √3/2·s² cell.
      return penWidth * Math.sqrt((2 * Math.PI) / (Math.sqrt(3) * coverage));
  }
}

function buildLattice(pattern: PenFillPattern, angle: number, scale: number): Lattice {
  switch (pattern) {
    case "lines":
      return { kind: "lines", rotation: angle, spacing: scale, families: [0], tileWidth: scale, tileHeight: scale };
    case "cross":
      return { kind: "lines", rotation: angle, spacing: scale, families: [0, 90], tileWidth: scale, tileHeight: scale };
    case "grid":
      // A cross turned 45°, so the default angle gives a straight grid.
      return { kind: "lines", rotation: angle + 45, spacing: scale, families: [0, -90], tileWidth: scale, tileHeight: scale };
    case "triangles":
      return {
        kind: "lines",
        rotation: angle,
        spacing: scale,
        families: [0, 60, 120],
        tileWidth: (2 * scale) / Math.sqrt(3),
        tileHeight: 2 * scale,
      };
    case "honeycomb":
    case "cubic":
      return {
        kind: "hex",
        rotation: angle,
        side: scale,
        cubes: pattern === "cubic",
        tileWidth: Math.sqrt(3) * scale,
        tileHeight: 3 * scale,
      };
    case "dots":
      return { kind: "dots", rotation: angle, spacing: scale, tileWidth: scale, tileHeight: Math.sqrt(3) * scale };
  }
}

/**
 * All line families pass through this point (in pattern space), so triangle
 * lines meet at shared points. Sitting half a row off the origin also keeps
 * lines off the outline of shapes drawn on round numbers.
 */
function lineAnchor(lattice: LineLattice): Point {
  return { x: lattice.spacing / 2, y: lattice.spacing / 2 };
}

function rotateDegrees(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return rotatePoint(point, Math.cos(radians), Math.sin(radians));
}

/** Pointy-top hexagon edges with side `side` covering `bounds`, plus each hexagon's inner "Y" to draw isometric cubes. */
function hexLatticePolylines(side: number, cubes: boolean, bounds: Bounds): Polyline[] {
  const width = Math.sqrt(3) * side;
  const rowHeight = 1.5 * side;
  const out: Polyline[] = [];
  const firstRow = Math.floor(bounds.minY / rowHeight) - 1;
  const lastRow = Math.ceil(bounds.maxY / rowHeight) + 1;
  const firstColumn = Math.floor(bounds.minX / width) - 1;
  const lastColumn = Math.ceil(bounds.maxX / width) + 1;

  for (let row = firstRow; row <= lastRow; row += 1) {
    const cy = row * rowHeight;
    const shift = Math.abs(row % 2) === 1 ? width / 2 : 0;
    // The zigzag along the top edges of this row of hexagons.
    const zigzag: Point[] = [];
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cx = column * width + shift;
      zigzag.push({ x: cx - width / 2, y: cy - side / 2 }, { x: cx, y: cy - side });
    }
    out.push(zigzag);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cx = column * width + shift;
      out.push([{ x: cx - width / 2, y: cy - side / 2 }, { x: cx - width / 2, y: cy + side / 2 }]);
      if (cubes) {
        const centre = { x: cx, y: cy };
        out.push([{ x: cx - width / 2, y: cy - side / 2 }, centre, { x: cx + width / 2, y: cy - side / 2 }]);
        out.push([centre, { x: cx, y: cy + side }]);
      }
    }
  }
  return out;
}

/** Staggered dot centres covering `bounds`, row by row in alternating direction. */
function dotCentres(spacing: number, bounds: Bounds): Point[] {
  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const centres: Point[] = [];
  for (let row = Math.ceil(bounds.minY / rowHeight); row <= Math.floor(bounds.maxY / rowHeight); row += 1) {
    const y = row * rowHeight;
    const shift = Math.abs(row % 2) === 1 ? spacing / 2 : 0;
    const columns: number[] = [];
    for (let x = Math.ceil((bounds.minX - shift) / spacing) * spacing + shift; x <= bounds.maxX; x += spacing) {
      columns.push(x);
    }
    if (Math.abs(row % 2) === 1) columns.reverse();
    for (const x of columns) centres.push({ x, y });
  }
  return centres;
}

/** A dot drawn as a tiny closed circle; with the pen's own width it inks a disc about two pen widths across. */
function dotPolyline(centre: Point, radius: number): Point[] {
  const sides = 8;
  return Array.from({ length: sides + 1 }, (_, side) => {
    const angle = (side / sides) * Math.PI * 2;
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  });
}

// ── Generation ───────────────────────────────────────────────────────────────

function regionBounds(regions: FillRegion[]): { width: number; height: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    for (const ring of region.rings) {
      if (ring.length < 3) continue;
      for (const point of ring) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  return maxX > minX && maxY > minY ? { width: maxX - minX, height: maxY - minY } : null;
}

function estimateElements(lattice: Lattice, bounds: { width: number; height: number }, scale: number): number {
  if (lattice.kind === "lines") {
    return (lattice.families.length * Math.hypot(bounds.width, bounds.height)) / scale;
  }
  const perCell = lattice.kind === "dots" ? 1.15 : lattice.cubes ? 5 : 3;
  return (bounds.width * bounds.height * perCell) / (scale * scale);
}

/**
 * Generates the pen strokes that fill `regions` with the given pattern. The
 * pattern is anchored to the regions' coordinate origin, so it moves with the
 * object rather than staying fixed on the mat.
 */
export function generatePenFill(regions: FillRegion[], settings: PenFillSettings, options: PenFillOptions): PenFillPolyline[] {
  const normalized = normalizePenFill(settings);
  const bounds = regionBounds(regions);
  if (!normalized?.enabled || !(options.penWidth > 0) || !bounds) {
    return [];
  }
  let scale = patternScale(normalized.pattern, options.penWidth, normalized.density / 100);

  // Spread a huge, dense fill out rather than generating an unusable number of strokes.
  const estimate = estimateElements(buildLattice(normalized.pattern, normalized.angle, scale), bounds, scale);
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  if (estimate > maxElements) {
    scale *= LINE_PATTERNS.has(normalized.pattern) ? estimate / maxElements : Math.sqrt(estimate / maxElements);
  }
  const lattice = buildLattice(normalized.pattern, normalized.angle, scale);

  if (lattice.kind === "lines") {
    const anchor = rotateDegrees(lineAnchor(lattice), lattice.rotation);
    const results: PenFillPolyline[] = [];
    for (const family of lattice.families) {
      const frame = new PatternFrame(regions, lattice.rotation + family, scale);
      if (frame.isEmpty) continue;
      for (const polyline of hatchLines(frame, lattice.spacing, frame.fromRegion(anchor).y)) {
        results.push({ points: polyline.map((point) => frame.toRegion(point)), closed: false });
      }
    }
    return results;
  }

  const frame = new PatternFrame(regions, lattice.rotation, scale);
  if (frame.isEmpty) {
    return [];
  }
  if (lattice.kind === "dots") {
    return dotCentres(lattice.spacing, frame)
      .filter((centre) => frame.containsPoint(centre))
      .map((centre) => ({
        points: dotPolyline(centre, options.penWidth / 2).map((point) => frame.toRegion(point)),
        closed: true,
      }));
  }
  const clipped: Polyline[] = [];
  for (const polyline of hexLatticePolylines(lattice.side, lattice.cubes, frame)) {
    clipPolyline(frame, polyline, clipped);
  }
  return clipped.map((polyline) => ({ points: polyline.map((point) => frame.toRegion(point)), closed: false }));
}

const LINE_PATTERNS = new Set<PenFillPattern>(["lines", "cross", "grid", "triangles"]);

// ── Canvas preview tile ──────────────────────────────────────────────────────

export type PenFillTile = {
  width: number;
  height: number;
  /** Degrees; apply as the SVG pattern's `rotate()` so tile space lines up with the generated strokes. */
  rotation: number;
  /** Line work in tile coordinates, including the parts that spill in from neighbouring tiles. */
  d: string;
  /** Dot centres in tile coordinates (dots pattern only). */
  dots: Point[];
  dotRadius: number;
};

function formatTileNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * One repeating tile of the pattern, for drawing fills on screen with an SVG
 * <pattern> instead of generating every stroke. Tile coordinates use the same
 * units as the regions passed to generatePenFill.
 */
export function penFillPatternTile(settings: PenFillSettings, penWidth: number): PenFillTile | null {
  const normalized = normalizePenFill(settings);
  if (!normalized || !(penWidth > 0)) {
    return null;
  }
  const scale = patternScale(normalized.pattern, penWidth, normalized.density / 100);
  const lattice = buildLattice(normalized.pattern, normalized.angle, scale);
  const { tileWidth: width, tileHeight: height } = lattice;
  // Neighbouring tiles' strokes spill a little into this one; cover one tile around it.
  const spill: Bounds = { minX: -width, maxX: 2 * width, minY: -height, maxY: 2 * height };
  const segments: Point[][] = [];

  if (lattice.kind === "lines") {
    const anchor = lineAnchor(lattice);
    const reach = 3 * (width + height);
    for (const family of lattice.families) {
      const radians = (family * Math.PI) / 180;
      const direction = { x: Math.cos(radians), y: Math.sin(radians) };
      const normal = { x: -direction.y, y: direction.x };
      const lines = Math.ceil(reach / lattice.spacing);
      for (let k = -lines; k <= lines; k += 1) {
        const through = { x: anchor.x + normal.x * k * lattice.spacing, y: anchor.y + normal.y * k * lattice.spacing };
        segments.push([
          { x: through.x - direction.x * reach, y: through.y - direction.y * reach },
          { x: through.x + direction.x * reach, y: through.y + direction.y * reach },
        ]);
      }
    }
  } else if (lattice.kind === "hex") {
    segments.push(...hexLatticePolylines(lattice.side, lattice.cubes, spill));
  }

  return {
    width,
    height,
    rotation: lattice.rotation,
    d: segments
      .map((points) => points.map((point, index) => `${index === 0 ? "M" : "L"}${formatTileNumber(point.x)} ${formatTileNumber(point.y)}`).join(""))
      .join(""),
    dots: lattice.kind === "dots" ? dotCentres(lattice.spacing, spill) : [],
    dotRadius: penWidth / 2,
  };
}
