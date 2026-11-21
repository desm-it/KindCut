// Turns an object's saved "dashed line" setting into real dashes. Cut as dashes,
// a line becomes a fold line: the cardstock bends along it but stays in one piece.
// Only the setting is stored; the dashes are regenerated from the object's
// current outline and size, so the pattern keeps its real length when resized.

import {
  type DashSettings,
  type Matrix,
  applyMatrix,
  dashPolyline,
  flattenSvgPath,
  formatPolylinePath,
  multiplyMatrices,
  parseSvgTransform,
} from '@cricut-companion/craft-core';
import type { WorkspaceObject } from './workspace-objects';
import { WORKSPACE_PX_PER_MM, itemScale } from './pen-fill-render';

const FLATTEN_TOLERANCE_PX = 0.1;

/** Text and dot photos have no single outline to dash. */
export function canDash(item: WorkspaceObject): boolean {
  return !item.textContent && !item.dotPrint && item.paths.length > 0;
}

export function activeDash(item: WorkspaceObject): DashSettings | null {
  return item.dashed?.enabled && canDash(item) ? item.dashed : null;
}

function dashPath(d: string, matrix: Matrix, dash: DashSettings, sx: number, sy: number): string {
  const [a, b, c, dd] = matrix;
  const matrixScale = Math.sqrt(Math.abs(a * dd - b * c)) || 1;
  const pieces = flattenSvgPath(d, FLATTEN_TOLERANCE_PX / matrixScale).flatMap((subpath) =>
    dashPolyline(
      subpath.points.map((point) => applyMatrix(matrix, point)),
      subpath.closed,
      dash.dashMm * WORKSPACE_PX_PER_MM,
      dash.gapMm * WORKSPACE_PX_PER_MM,
    ),
  );
  return formatPolylinePath(
    pieces.map((points) => ({
      points: points.map((point) => ({ x: point.x / sx, y: point.y / sy })),
    })),
  );
}

/**
 * Dashes for one of the object's paths, as path data in the object's frame
 * space with the path's own transform already applied.
 */
export function dashedFramePath(
  item: WorkspaceObject,
  d: string,
  pathTransform: string | undefined,
  dash: DashSettings,
): string {
  const { sx, sy } = itemScale(item);
  return dashPath(
    d,
    multiplyMatrices([sx, 0, 0, sy, 0, 0], parseSvgTransform(pathTransform)),
    dash,
    sx,
    sy,
  );
}

/** Dashes for geometry that is already at its real size on the mat (shapes on the canvas). */
export function dashedRealSizePath(d: string, dash: DashSettings): string {
  return dashPath(d, [1, 0, 0, 1, 0, 0], dash, 1, 1);
}
