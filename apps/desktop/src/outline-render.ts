// Builds the outline that sits at a distance around an object (a border to cut
// a sticker or label out, or a shadow layer behind text).
//
// The outline is stored as settings only. To generate it, the object is painted
// as a solid silhouette with a thick round brush (which is exactly "everything
// within this distance of the object"), and the edge of that picture is traced.
// That works the same for shapes, traced art, pen lines and live text, and
// overlapping parts melt into one outline.

import {
  type OutlineSettings,
  type Point,
  applyMatrix,
  flattenSvgPath,
  formatPolylinePath,
  multiplyMatrices,
  parseSvgTransform,
  simplifyClosedPolyline,
  traceAlphaContours,
} from '@cricut-companion/craft-core';
import type { WorkspaceObject, WorkspaceTextContent } from './workspace-objects';
import { WORKSPACE_PX_PER_MM, itemScale } from './pen-fill-render';
import { buildShapePath } from './workspace-shapes';
import { traceCenterlinePathD } from './centerline-trace';

type ToolLike = { id?: string; color: string; type: 'pen' | 'cut' };

/** Picture pixels per workspace pixel: about 0.1 mm per pixel, placed finer still by the edge tracing. */
const MAX_RESOLUTION = 3;
const MAX_PIXELS = 2_400_000;
const SIMPLIFY_TOLERANCE_PIXELS = 0.3;

export function canOutline(item: WorkspaceObject): boolean {
  return !item.dotPrint && (item.paths.length > 0 || Boolean(item.textContent));
}

export function activeOutline(item: WorkspaceObject): OutlineSettings | null {
  return item.outline?.enabled && canOutline(item) ? item.outline : null;
}

/** The tool an outline uses: its pen when that pen still exists, otherwise the blade. */
export function outlineTool(
  outline: OutlineSettings,
  tools: ToolLike[] | undefined,
): { color: string; isPen: boolean } {
  const pen = outline.penId
    ? tools?.find((tool) => tool.type === 'pen' && tool.id === outline.penId)
    : undefined;
  if (pen) return { color: pen.color, isPen: true };
  return { color: tools?.find((tool) => tool.type === 'cut')?.color ?? '#000000', isPen: false };
}

// Geometry only changes when the art, its size or the outline settings change, not when
// the object is moved, so results are remembered per piece of art.
const cache = new WeakMap<object, Map<string, Point[][]>>();

/**
 * The outline loops in the object's real-size space (frame units × scale, before
 * rotation and position). Empty when there is nothing to outline or no canvas.
 */
export function outlineLoops(item: WorkspaceObject): Point[][] {
  const outline = activeOutline(item);
  if (!outline || typeof document === 'undefined') return [];
  const { sx, sy } = itemScale(item);
  const liveText = item.textContent && item.paths.length === 0 ? item.textContent : null;
  const owner: object = liveText ?? item.paths;
  const key = [
    item.shapeKind ?? '',
    item.frame.width,
    item.frame.height,
    sx,
    sy,
    item.cornerRadius ?? 0,
    outline.distanceMm,
    outline.holes,
  ].join('|');
  let entries = cache.get(owner);
  if (!entries) {
    entries = new Map();
    cache.set(owner, entries);
  }
  const known = entries.get(key);
  if (known) return known;
  const loops = computeOutlineLoops(item, outline, liveText, sx, sy);
  if (entries.size > 8) entries.clear();
  entries.set(key, loops);
  return loops;
}

function computeOutlineLoops(
  item: WorkspaceObject,
  outline: OutlineSettings,
  liveText: WorkspaceTextContent | null,
  sx: number,
  sy: number,
): Point[][] {
  const distance = outline.distanceMm * WORKSPACE_PX_PER_MM;
  const width = Math.max(1, item.frame.width * sx);
  const height = Math.max(1, item.frame.height * sy);
  const pad = distance + 2;
  const resolution = Math.min(
    MAX_RESOLUTION,
    Math.sqrt(MAX_PIXELS / ((width + pad * 2) * (height + pad * 2))),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((width + pad * 2) * resolution);
  canvas.height = Math.ceil((height + pad * 2) * resolution);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (liveText && !liveText.singleLine) {
    // Same layout as the text on the canvas: alphabetic baseline at fontSize + line·lineHeight.
    ctx.setTransform(resolution * sx, 0, 0, resolution * sy, pad * resolution, pad * resolution);
    ctx.lineWidth = (distance * 2) / Math.min(sx, sy);
    paintText(ctx, liveText, item.frame.width);
  } else {
    ctx.lineWidth = distance * 2 * resolution;
    const toPicture = (x: number, y: number): Point => ({
      x: (x + pad) * resolution,
      y: (y + pad) * resolution,
    });
    const shapeD = item.shapeKind
      ? buildShapePath(
          item.shapeKind,
          width,
          height,
          Math.min((item.cornerRadius ?? 0) * Math.min(sx, sy), Math.min(width, height) / 2),
        )
      : null;
    const sources = shapeD
      ? [{ d: shapeD, matrix: [1, 0, 0, 1, 0, 0] as const, evenOdd: false }]
      : liveText
        ? // Single-line text is a set of open pen strokes, so the outline hugs the writing itself.
          [
            {
              d: traceCenterlinePathD(liveText, item.frame),
              matrix: [sx, 0, 0, sy, 0, 0] as const,
              evenOdd: false,
            },
          ]
        : item.paths.map((path) => ({
            d: path.d,
            matrix: multiplyMatrices([sx, 0, 0, sy, 0, 0], parseSvgTransform(path.pathTransform)),
            evenOdd: path.fillRule === 'evenodd',
          }));
    for (const source of sources) {
      const [a, b, c, d] = source.matrix;
      const matrixScale = Math.sqrt(Math.abs(a * d - b * c)) || 1;
      const filled = new Path2D();
      const stroked = new Path2D();
      for (const subpath of flattenSvgPath(source.d, 0.1 / matrixScale)) {
        subpath.points.forEach((point, index) => {
          const real = applyMatrix([...source.matrix], point);
          const p = toPicture(real.x, real.y);
          if (index === 0) {
            stroked.moveTo(p.x, p.y);
            if (subpath.closed) filled.moveTo(p.x, p.y);
          } else {
            stroked.lineTo(p.x, p.y);
            if (subpath.closed) filled.lineTo(p.x, p.y);
          }
        });
        if (subpath.closed) {
          stroked.closePath();
          filled.closePath();
        }
      }
      // Closed outlines are solid; open pen lines only get the band around the line.
      ctx.fill(filled, source.evenOdd ? 'evenodd' : 'nonzero');
      ctx.stroke(stroked);
    }
  }

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < alpha.length; index++) alpha[index] = pixels[index * 4 + 3] ?? 0;
  const minArea = 4 * resolution * resolution;
  return traceAlphaContours(alpha, canvas.width, canvas.height)
    .filter((loop) => (outline.holes ? Math.abs(loop.area) >= minArea : loop.area >= minArea))
    .map((loop) =>
      simplifyClosedPolyline(loop.points, SIMPLIFY_TOLERANCE_PIXELS).map((point) => ({
        x: point.x / resolution - pad,
        y: point.y / resolution - pad,
      })),
    );
}

function paintText(
  ctx: CanvasRenderingContext2D,
  tc: WorkspaceTextContent,
  frameWidth: number,
): void {
  ctx.font = `${tc.fontStyle === 'italic' ? 'italic ' : ''}${tc.fontWeight === 'bold' ? 'bold ' : ''}${tc.fontSize}px ${tc.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  const lineHeight = tc.fontSize * tc.lineHeight;
  tc.text.split('\n').forEach((line, lineIndex) => {
    const chars = [...line];
    const lineWidth =
      chars.length === 0
        ? 0
        : chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) +
          Math.max(0, chars.length - 1) * tc.letterSpacing;
    const startX =
      tc.textAlign === 'center'
        ? (frameWidth - lineWidth) / 2
        : tc.textAlign === 'right'
          ? frameWidth - 1 - lineWidth
          : 1;
    const baseline = tc.fontSize + lineIndex * lineHeight;
    let x = startX;
    for (const char of chars) {
      ctx.fillText(char, x, baseline);
      ctx.strokeText(char, x, baseline);
      x += ctx.measureText(char).width + tc.letterSpacing;
    }
    if (tc.textDecoration === 'underline' && lineWidth > 0) {
      const thickness = Math.max(2 / 3, tc.fontSize * 0.06);
      ctx.fillRect(startX, baseline + 2, lineWidth, thickness);
      ctx.strokeRect(startX, baseline + 2, lineWidth, thickness);
    }
  });
}

/** The outline as path data in the object's real-size space (shapes are drawn at that size). */
export function outlineRealSizePath(item: WorkspaceObject): string {
  return formatPolylinePath(outlineLoops(item).map((points) => ({ points, closed: true })));
}

/** The outline as path data in the object's frame space, so it sits inside the same transform as the object. */
export function outlineFramePath(item: WorkspaceObject): string {
  const { sx, sy } = itemScale(item);
  return formatPolylinePath(
    outlineLoops(item).map((points) => ({
      points: points.map((point) => ({ x: point.x / sx, y: point.y / sy })),
      closed: true,
    })),
  );
}
