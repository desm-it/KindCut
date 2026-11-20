import { applyMatrix, multiplyMatrices, type Matrix, type Point } from "./svg-path-geometry";
import { clipJoyPath } from "./joy-path-clip";

export type JoyPlanTool = "pen" | "fine_point_blade";
export interface NativeJoyPlanPathInput {
  id: string;
  d: string;
  transforms?: readonly Matrix[];
  tool: JoyPlanTool;
  operation: "draw" | "cut";
  color?: string;
}
export interface NativeJoyPlanInput {
  widthPx: number;
  heightPx: number;
  viewBox: { minX: number; minY: number; width: number; height: number };
  preserveAspectRatio?: string;
  mat: { widthIn: number; heightIn: number; mode?: "card" };
  materialId: number;
  paths: readonly NativeJoyPlanPathInput[];
  calibration?: Partial<Record<JoyPlanTool, { xPt: number; yPt: number }>>;
  toolOrder?: readonly JoyPlanTool[];
  boundsPolicy?: "clip" | "reject";
}
type Step = { op: "M" | "L" | "C" | "Z"; points: Point[] };
type PlannedPath = { id: string; color?: string; steps: Step[] };
export interface NativeJoyPlan {
  schemaVersion: 2;
  /** App-owned logical canvas, not a calibrated physical machine origin. */
  coordinateFrame: "kindcut_canvas_pt72_v1";
  machine: "cricut_joy";
  unit: "pt72";
  execution: "unsupported";
  material: { widthIn: number; heightIn: number; id: number };
  mat: { widthIn: number; heightIn: number; mode?: "card" };
  groups: Array<{ tool: JoyPlanTool; operation: "draw" | "cut"; paths: PlannedPath[] }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  clipping: { policy: "clip" | "reject"; clippedPathIds: string[]; omittedPathIds: string[] };
}

const TOOLS: readonly JoyPlanTool[] = ["pen", "fine_point_blade"];
const NUMBER = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
function invalid(message: string): never {
  throw new Error(`Invalid native Joy plan: ${message}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} must be finite`);
  return value;
}
function positive(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result <= 0) invalid(`${name} must be positive`);
  return result;
}
function isTool(value: unknown): value is JoyPlanTool {
  return value === "pen" || value === "fine_point_blade";
}
function checkedMatrix(value: unknown): Matrix {
  if (!Array.isArray(value) || value.length !== 6) invalid("matrix must contain six numbers");
  const matrix = value.map(n => finite(n, "matrix coefficient")) as Matrix;
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || determinant === 0) invalid("singular or overflowing matrix");
  return matrix;
}
function calibrations(value: unknown): Record<JoyPlanTool, Point> {
  const result = { pen: { x: 0, y: 0 }, fine_point_blade: { x: 0, y: 0 } };
  if (value === undefined) return result;
  if (!record(value)) invalid("calibration must be an object");
  for (const [tool, offset] of Object.entries(value)) {
    if (!isTool(tool) || !record(offset) || Object.keys(offset).some(k => k !== "xPt" && k !== "yPt")) {
      invalid("unsupported calibration entry");
    }
    result[tool] = { x: finite(offset.xPt, "calibration.xPt"), y: finite(offset.yPt, "calibration.yPt") };
  }
  return result;
}

/** Complete consumption of the supported absolute-command subset; no flattening. */
function pathSteps(data: string): Step[] {
  if (data.length === 0 || data.length > 100_000) invalid("path character budget exceeded or empty path");
  const number = new RegExp(NUMBER, "y");
  let cursor = 0;
  let activeSubpath = false;
  let drawing = false;
  const result: Step[] = [];
  const whitespace = (): void => {
    while (cursor < data.length && /\s/.test(data[cursor]!)) cursor += 1;
  };
  const coordinate = (allowComma: boolean): number => {
    whitespace();
    if (allowComma && data[cursor] === ",") { cursor += 1; whitespace(); }
    number.lastIndex = cursor;
    const match = number.exec(data);
    if (!match) invalid("incomplete or malformed path coordinate");
    cursor = number.lastIndex;
    return finite(Number(match[0]), "path coordinate");
  };
  while (cursor < data.length) {
    whitespace();
    if (cursor === data.length) break;
    const command = data[cursor++];
    if (command !== "M" && command !== "L" && command !== "C" && command !== "Z") {
      invalid("unsupported path command or trailing data");
    }
    if (command === "Z") {
      if (!activeSubpath) invalid("Z requires an active subpath");
      result.push({ op: command, points: [] });
      activeSubpath = false;
      continue;
    }
    if (command !== "M" && !activeSubpath) invalid("drawing command requires M");
    const points: Point[] = [];
    for (let n = 0; n < (command === "C" ? 3 : 1); n += 1) {
      points.push({ x: coordinate(n > 0), y: coordinate(true) });
    }
    result.push({ op: command, points });
    if (command === "M") activeSubpath = true;
    else drawing = true;
  }
  if (!drawing) invalid("empty drawing geometry");
  return result;
}

/**
 * Pure geometry planning only. pt72 is NOT a Joy wire coordinate convention.
 * Default clipping preserves curve segments; reject mode uses the conservative
 * control-point envelope. Neither policy certifies physical motion.
 */
export function compileNativeJoyPlan(input: NativeJoyPlanInput): NativeJoyPlan {
  if (!record(input)) invalid("input must be an object");
  const widthPx = positive(input.widthPx, "widthPx");
  const heightPx = positive(input.heightPx, "heightPx");
  if (!record(input.viewBox) || !record(input.mat)) invalid("viewBox and mat are required");
  const originX = finite(input.viewBox.minX, "viewBox.minX");
  const originY = finite(input.viewBox.minY, "viewBox.minY");
  const viewWidth = positive(input.viewBox.width, "viewBox.width");
  const viewHeight = positive(input.viewBox.height, "viewBox.height");
  const matWidth = positive(input.mat.widthIn, "mat.widthIn");
  const matHeight = positive(input.mat.heightIn, "mat.heightIn");
  if(input.mat.mode!==undefined&&(input.mat.mode!=='card'||matWidth!==4.5||matHeight!==6.25))invalid('unsupported mode or inconsistent CardMat dimensions');
  if (matWidth > 4.5 || matHeight > 12) invalid("original Joy mat exceeds 4.5 by 12 inches");
  const widthIn = positive(widthPx / 96, "material width");
  const heightIn = positive(heightPx / 96, "material height");
  if (widthIn > matWidth || heightIn > matHeight) invalid("material exceeds mat bounds");
  if (!Number.isSafeInteger(input.materialId) || input.materialId <= 0) invalid("materialId must be a positive safe integer");
  const boundsPolicy = input.boundsPolicy === undefined ? "clip" : input.boundsPolicy;
  if (boundsPolicy !== "clip" && boundsPolicy !== "reject") invalid("unsupported boundsPolicy");
  if (input.preserveAspectRatio !== undefined && input.preserveAspectRatio !== "none") invalid("unsupported preserveAspectRatio");
  if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > 1000) invalid("path count must be 1 through 1000");
  const order = input.toolOrder === undefined ? TOOLS : input.toolOrder;
  if (!Array.isArray(order) || order.length !== 2 || new Set(order).size !== 2 || !order.every(isTool)) {
    invalid("toolOrder must be a permutation of the supported tools");
  }
  const calibration = calibrations(input.calibration);
  const widthPt = widthIn * 72;
  const heightPt = heightIn * 72;
  const scaleX = widthPt / viewWidth;
  const scaleY = heightPt / viewHeight;
  const root = checkedMatrix([scaleX, 0, 0, scaleY, -originX * scaleX, -originY * scaleY]);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const groups = new Map<JoyPlanTool, NativeJoyPlan["groups"][number]>();
  const ids = new Set<string>();
  let characters = 0;
  let points = 0;
  let outputPoints = 0;
  const clippedPathIds: string[] = [];
  const omittedPathIds: string[] = [];

  // Validate every path BEFORE grouping: unsupported entries must never disappear.
  for (const path of input.paths) {
    if (!record(path) || typeof path.id !== "string" || !path.id.trim() || ids.has(path.id)) invalid("path IDs must be nonempty and unique");
    ids.add(path.id);
    if (!isTool(path.tool) || path.operation !== (path.tool === "pen" ? "draw" : "cut")) invalid("unsupported tool/operation pair");
    if (typeof path.d !== "string") invalid("path data must be a string");
    characters += path.d.length;
    if (characters > 1_000_000) invalid("total path character budget exceeded");
    if (path.tool === "pen" && path.color === undefined) invalid("pen requires a color");
    if (path.color !== undefined && (typeof path.color !== "string" || !/^#[a-f0-9]{6}$/i.test(path.color))) invalid("color must be six-digit hex");
    const transforms = path.transforms === undefined ? [] : path.transforms;
    if (!Array.isArray(transforms) || transforms.length > 64) invalid("transform count must not exceed 64");
    let matrix = root;
    for (const transform of transforms) matrix = checkedMatrix(multiplyMatrices(matrix, checkedMatrix(transform)));
    const offset = calibration[path.tool];
    let steps = pathSteps(path.d).map(step => ({
      op: step.op,
      points: step.points.map(point => {
        points += 1;
        if (points > 100_000) invalid("total point budget exceeded");
        const transformed = applyMatrix(matrix, point);
        const x = finite(transformed.x + offset.x, "transformed x");
        const y = finite(transformed.y + offset.y, "transformed y");
        if (boundsPolicy === "reject") {
          if (x < 0 || y < 0 || x > widthPt || y > heightPt) invalid("transformed geometry exceeds material bounds");
          bounds.minX = Math.min(bounds.minX, x);
          bounds.minY = Math.min(bounds.minY, y);
          bounds.maxX = Math.max(bounds.maxX, x);
          bounds.maxY = Math.max(bounds.maxY, y);
        }
        return { x, y };
      }),
    }));
    if (boundsPolicy === "clip") {
      const result = clipJoyPath(steps, { minX: 0, minY: 0, maxX: widthPt, maxY: heightPt });
      if (result.clipped) clippedPathIds.push(path.id);
      if (!result.bounds) { omittedPathIds.push(path.id); continue; }
      steps = result.steps;
      bounds.minX = Math.min(bounds.minX, result.bounds.minX);
      bounds.minY = Math.min(bounds.minY, result.bounds.minY);
      bounds.maxX = Math.max(bounds.maxX, result.bounds.maxX);
      bounds.maxY = Math.max(bounds.maxY, result.bounds.maxY);
    }
    outputPoints += steps.reduce((sum, step) => sum + step.points.length, 0);
    if (outputPoints > 100_000) invalid("total clipped point budget exceeded");
    let group = groups.get(path.tool);
    if (!group) {
      group = { tool: path.tool, operation: path.tool === "pen" ? "draw" : "cut", paths: [] };
      groups.set(path.tool, group);
    }
    group.paths.push({ id: path.id, ...(path.color === undefined ? {} : { color: path.color.toLowerCase() }), steps });
  }
  if (groups.size === 0) invalid("no drawing geometry remains inside material bounds");
  return {
    schemaVersion: 2, coordinateFrame: "kindcut_canvas_pt72_v1",
    machine: "cricut_joy", unit: "pt72", execution: "unsupported",
    material: { widthIn, heightIn, id: input.materialId },
    mat: { widthIn: matWidth, heightIn: matHeight, ...(input.mat.mode==='card'?{mode:'card' as const}:{}) },
    groups: order.flatMap(tool => { const group = groups.get(tool); return group ? [group] : []; }),
    bounds,
    clipping: { policy: boundsPolicy, clippedPathIds, omittedPathIds },
  };
}
