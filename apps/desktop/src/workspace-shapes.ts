export const WORKSPACE_SHAPE_KINDS = [
  "square",
  "triangle",
  "circle",
  "star",
  "hexagon",
  "octagon",
  "rounded-square",
] as const;

export type WorkspaceShapeKind = (typeof WORKSPACE_SHAPE_KINDS)[number];

export type WorkspaceShapeDefinition = {
  kind: WorkspaceShapeKind;
  labelNl: string;
  labelEn: string;
  icon: string;
};

export const WORKSPACE_SHAPES: WorkspaceShapeDefinition[] = [
  { kind: "square", labelNl: "Vierkant", labelEn: "Square", icon: "□" },
  { kind: "triangle", labelNl: "Driehoek", labelEn: "Triangle", icon: "△" },
  { kind: "circle", labelNl: "Cirkel", labelEn: "Circle", icon: "○" },
  { kind: "star", labelNl: "Ster", labelEn: "Star", icon: "☆" },
  { kind: "hexagon", labelNl: "Zeshoek", labelEn: "Hexagon", icon: "⬡" },
  { kind: "octagon", labelNl: "Achthoek", labelEn: "Octagon", icon: "⬣" },
  { kind: "rounded-square", labelNl: "Afgerond vierkant", labelEn: "Rounded square", icon: "▢" },
];

const SHAPE_VIEWBOX_SIZE = 200;
const SHAPE_MARGIN = 20;
const SHAPE_CENTER = SHAPE_VIEWBOX_SIZE / 2;
const SHAPE_RADIUS = SHAPE_CENTER - SHAPE_MARGIN;

export function getWorkspaceShapeDefinition(kind: WorkspaceShapeKind): WorkspaceShapeDefinition {
  return WORKSPACE_SHAPES.find((shape) => shape.kind === kind) ?? WORKSPACE_SHAPES[0]!;
}

export function isWorkspaceShapeKind(value: unknown): value is WorkspaceShapeKind {
  return typeof value === "string" && WORKSPACE_SHAPE_KINDS.includes(value as WorkspaceShapeKind);
}

export function buildWorkspaceShapeSvg(kind: WorkspaceShapeKind): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="2in" viewBox="0 0 ${SHAPE_VIEWBOX_SIZE} ${SHAPE_VIEWBOX_SIZE}">
  <path d="${getWorkspaceShapePath(kind)}" fill="none" stroke="#000000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
</svg>`;
}

export function buildWorkspaceShapePathObject(kind: WorkspaceShapeKind): {
  frame: { width: number; height: number };
  path: WorkspacePathData;
} {
  return {
    frame: { width: SHAPE_VIEWBOX_SIZE, height: SHAPE_VIEWBOX_SIZE },
    path: {
      id: "path-1",
      d: getWorkspaceShapePath(kind),
      fill: "none",
      stroke: "#000000",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
  };
}

export function getWorkspaceShapePath(kind: WorkspaceShapeKind): string {
  switch (kind) {
    case "square":
      return "M 20 20 H 180 V 180 H 20 Z";
    case "triangle":
      return polygonPath(pointsOnCircle(3, -90));
    case "circle":
      return "M 180 100 A 80 80 0 1 1 20 100 A 80 80 0 1 1 180 100 Z";
    case "star":
      return polygonPath(starPoints(5, SHAPE_RADIUS, SHAPE_RADIUS * 0.44, -90));
    case "hexagon":
      return polygonPath(pointsOnCircle(6, -90));
    case "octagon":
      return polygonPath(pointsOnCircle(8, -90 + 22.5));
    case "rounded-square":
      return "M 56 20 H 144 Q 180 20 180 56 V 144 Q 180 180 144 180 H 56 Q 20 180 20 144 V 56 Q 20 20 56 20 Z";
  }
}

// Default size (workspace px) for a freshly placed shape, and the rounded-square preset.
export const DEFAULT_SHAPE_SIZE = 170;
export const ROUNDED_SQUARE_DEFAULT_RADIUS = 40;

// Every shape except the circle has corners that can take a radius.
export function shapeHasCorners(kind: WorkspaceShapeKind): boolean {
  return kind !== "circle";
}

// Build a shape path filling the box [0,0,w,h] (bounds-tight — no margin/offset).
// cornerRadius is in frame units (the radius at scale 1). For rectangles the corner
// arcs are pre-divided by the scale so they stay circular under non-uniform scaling;
// the effective radius scales with min(scaleX, scaleY) and is clamped so corners never
// overlap. Polygons/stars round their vertices in frame space (they scale with the box).
export function buildShapePath(
  kind: WorkspaceShapeKind,
  w: number,
  h: number,
  cornerRadius = 0,
  scaleX = 1,
  scaleY = 1,
): string {
  switch (kind) {
    case "circle":
      return ellipsePath(w, h);
    case "square":
    case "rounded-square":
      return roundedRectPath(w, h, cornerRadius, scaleX, scaleY);
    case "triangle":
      return roundedPolygonPath(fitToBox(unitPolygon(3, -90), w, h), cornerRadius);
    case "hexagon":
      return roundedPolygonPath(fitToBox(unitPolygon(6, -90), w, h), cornerRadius);
    case "octagon":
      return roundedPolygonPath(fitToBox(unitPolygon(8, -90 + 22.5), w, h), cornerRadius);
    case "star":
      return roundedPolygonPath(fitToBox(unitStar(5, 0.44, -90), w, h), cornerRadius);
  }
}

function ellipsePath(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M 0 ${formatNumber(ry)} A ${formatNumber(rx)} ${formatNumber(ry)} 0 1 0 ${formatNumber(w)} ${formatNumber(ry)} A ${formatNumber(rx)} ${formatNumber(ry)} 0 1 0 0 ${formatNumber(ry)} Z`;
}

function roundedRectPath(w: number, h: number, cornerRadius: number, scaleX: number, scaleY: number): string {
  const sx = Math.abs(scaleX) || 1;
  const sy = Math.abs(scaleY) || 1;
  const worldW = w * sx;
  const worldH = h * sy;
  // Effective world radius: scales with the smaller axis, clamped so corners never overlap.
  const R = Math.max(0, Math.min(cornerRadius * Math.min(sx, sy), Math.min(worldW, worldH) / 2));
  if (R <= 0.01) {
    return `M 0 0 H ${formatNumber(w)} V ${formatNumber(h)} H 0 Z`;
  }
  // Express the (circular, in world space) corner as an ellipse in frame units so the
  // <g> scale turns it back into a circle.
  const rx = R / sx;
  const ry = R / sy;
  const n = formatNumber;
  return `M ${n(rx)} 0 H ${n(w - rx)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)} V ${n(h - ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(w - rx)} ${n(h)} H ${n(rx)} A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(h - ry)} V ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(rx)} 0 Z`;
}

// Round each vertex of a polygon with quadratic corners (radius in frame units).
function roundedPolygonPath(points: Point[], cornerRadius: number): string {
  if (cornerRadius <= 0.01) return polygonPath(points);
  const n = points.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const cur = points[i]!;
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const before = trimmedPoint(cur, prev, cornerRadius);
    const after = trimmedPoint(cur, next, cornerRadius);
    d += i === 0 ? `M ${formatPoint(before)}` : ` L ${formatPoint(before)}`;
    d += ` Q ${formatPoint(cur)} ${formatPoint(after)}`;
  }
  return `${d} Z`;
}

// A point trimmed from `from` toward `to` by min(radius, half the edge length).
function trimmedPoint(from: Point, to: Point, radius: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(radius, len / 2);
  return { x: from.x + (dx / len) * t, y: from.y + (dy / len) * t };
}

function unitPolygon(count: number, startAngleDegrees: number): Point[] {
  return Array.from({ length: count }, (_v, index) => {
    const angle = toRadians(startAngleDegrees + (360 / count) * index);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
}

function unitStar(count: number, innerRatio: number, startAngleDegrees: number): Point[] {
  return Array.from({ length: count * 2 }, (_v, index) => {
    const angle = toRadians(startAngleDegrees + (360 / (count * 2)) * index);
    const radius = index % 2 === 0 ? 1 : innerRatio;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

// Map points (any range) to fill the box [0,0,w,h] exactly (bounds-tight).
function fitToBox(points: Point[], w: number, h: number): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return points.map((p) => ({
    x: ((p.x - minX) / spanX) * w,
    y: ((p.y - minY) / spanY) * h,
  }));
}

function pointsOnCircle(count: number, startAngleDegrees: number): Point[] {
  return Array.from({ length: count }, (_value, index) => {
    const angle = toRadians(startAngleDegrees + (360 / count) * index);
    return {
      x: SHAPE_CENTER + Math.cos(angle) * SHAPE_RADIUS,
      y: SHAPE_CENTER + Math.sin(angle) * SHAPE_RADIUS,
    };
  });
}

function starPoints(count: number, outerRadius: number, innerRadius: number, startAngleDegrees: number): Point[] {
  return Array.from({ length: count * 2 }, (_value, index) => {
    const angle = toRadians(startAngleDegrees + (360 / (count * 2)) * index);
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return {
      x: SHAPE_CENTER + Math.cos(angle) * radius,
      y: SHAPE_CENTER + Math.sin(angle) * radius,
    };
  });
}

function polygonPath(points: Point[]): string {
  const [first, ...rest] = points.map(formatPoint);
  return `M ${first} ${rest.map((point) => `L ${point}`).join(" ")} Z`;
}

function formatPoint(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

type Point = {
  x: number;
  y: number;
};
import type { WorkspacePathData } from "./workspace-objects";
