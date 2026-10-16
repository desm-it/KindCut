// Turns an object's saved pen-fill settings into geometry: the shapes to fill
// (for the cutter) and the repeating tile (for the canvas). The fill itself is
// never stored; it is regenerated from the object's current outline, size and
// tool every time, so it can always be changed or switched off again.

import {
  type FillRegion,
  type Matrix,
  type PenFillSettings,
  type PenFillTile,
  applyMatrix,
  flattenSvgPath,
  formatPolylinePath,
  generatePenFill,
  multiplyMatrices,
  parseSvgTransform,
  penFillPatternTile,
} from "@cricut-companion/craft-core";
import type { WorkspaceObject, WorkspacePathData } from "./workspace-objects";
import { buildShapePath } from "./workspace-shapes";

type ToolLike = { color: string; type: "pen" | "cut" };

/** Pen line width in workspace pixels: about 0.4 mm at 80 px per inch, same as the on-screen pen outline. */
export const PEN_LINE_WIDTH_PX = 1.25;

/** Curves are flattened to within this distance (real-size workspace pixels) before filling. */
const FLATTEN_TOLERANCE_PX = 0.1;

function isPenColor(color: string | undefined, tools: ToolLike[] | undefined): boolean {
  const key = (color ?? "").toLowerCase();
  return Boolean(key) && tools?.some((tool) => tool.type === "pen" && tool.color.toLowerCase() === key) === true;
}

export function itemScale(item: WorkspaceObject): { sx: number; sy: number } {
  return { sx: Math.abs(item.transform.scaleX) || 1, sy: Math.abs(item.transform.scaleY) || 1 };
}

/** True when the object is drawn with a pen and can therefore take a fill (single-line text has no inside). */
export function canPenFill(item: WorkspaceObject, tools: ToolLike[] | undefined): boolean {
  if (item.textContent) {
    return !item.textContent.singleLine && isPenColor(item.textContent.color, tools);
  }
  return item.paths.some((path) => isPenColor(path.stroke, tools));
}

/** The fill to draw right now, or null when it is off or the object isn't on a pen. */
export function activePenFill(item: WorkspaceObject, tools: ToolLike[] | undefined): PenFillSettings | null {
  return item.penFill?.enabled && canPenFill(item, tools) ? item.penFill : null;
}

/** An object's pen-coloured paths, grouped per pen so each colour gets its own fill. */
export function penPathsByColor(item: WorkspaceObject, tools: ToolLike[] | undefined): Array<{ color: string; paths: WorkspacePathData[] }> {
  const groups = new Map<string, { color: string; paths: WorkspacePathData[] }>();
  for (const path of item.paths) {
    if (!isPenColor(path.stroke, tools)) continue;
    const key = path.stroke.toLowerCase();
    const group = groups.get(key);
    if (group) group.paths.push(path);
    else groups.set(key, { color: path.stroke, paths: [path] });
  }
  return [...groups.values()];
}

function regionFromPath(d: string, matrix: Matrix, fillRule: string | undefined): FillRegion {
  const [a, b, c, dd] = matrix;
  const matrixScale = Math.sqrt(Math.abs(a * dd - b * c)) || 1;
  return {
    rings: flattenSvgPath(d, FLATTEN_TOLERANCE_PX / matrixScale).map((subpath) => subpath.points.map((point) => applyMatrix(matrix, point))),
    fillRule: fillRule === "evenodd" ? "evenodd" : "nonzero",
  };
}

/**
 * The areas to fill per pen colour, in the object's real-size space (frame
 * units × scale, before rotation and position), where the pattern spacing is a
 * true distance on the mat.
 */
export function penFillRegions(item: WorkspaceObject, tools: ToolLike[] | undefined): Array<{ color: string; regions: FillRegion[] }> {
  const { sx, sy } = itemScale(item);
  if (item.shapeKind) {
    const path = item.paths[0];
    if (!path || !isPenColor(path.stroke, tools)) return [];
    // Same geometry the canvas draws for shapes at their actual size.
    const width = Math.max(1, item.frame.width * sx);
    const height = Math.max(1, item.frame.height * sy);
    const radius = Math.min((item.cornerRadius ?? 0) * Math.min(sx, sy), Math.min(width, height) / 2);
    return [{ color: path.stroke, regions: [regionFromPath(buildShapePath(item.shapeKind, width, height, radius), [1, 0, 0, 1, 0, 0], "nonzero")] }];
  }
  const scale: Matrix = [sx, 0, 0, sy, 0, 0];
  return penPathsByColor(item, tools).map(({ color, paths }) => ({
    color,
    regions: paths.map((path) => regionFromPath(path.d, multiplyMatrices(scale, parseSvgTransform(path.pathTransform)), path.fillRule)),
  }));
}

/**
 * The real pen strokes for an object's fill, as path data in the object's
 * frame space (so they sit inside the same transform as its outline).
 */
export function buildPenFillStrokes(item: WorkspaceObject, tools: ToolLike[] | undefined): Array<{ color: string; d: string }> {
  const fill = activePenFill(item, tools);
  if (!fill) return [];
  const { sx, sy } = itemScale(item);
  return penFillRegions(item, tools)
    .map(({ color, regions }) => {
      const polylines = generatePenFill(regions, fill, { penWidth: PEN_LINE_WIDTH_PX }).map((polyline) => ({
        ...polyline,
        points: polyline.points.map((point) => ({ x: point.x / sx, y: point.y / sy })),
      }));
      return { color, d: formatPolylinePath(polylines) };
    })
    .filter((stroke) => stroke.d);
}

export function penFillTileFor(item: WorkspaceObject): PenFillTile | null {
  return item.penFill ? penFillPatternTile(item.penFill, PEN_LINE_WIDTH_PX) : null;
}
