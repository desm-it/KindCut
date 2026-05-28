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
  <path d="${getWorkspaceShapePath(kind)}" fill="none" stroke="#8f4f2b" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
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
      stroke: "#8f4f2b",
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
