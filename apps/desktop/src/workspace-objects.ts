import type { WorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspaceItemFrame, WorkspaceItemTransform } from "./workspace-utils";
import { traceCenterlinePathD } from "./centerline-trace";
import { buildShapePath } from "./workspace-shapes";
import type { PenFillSettings } from "@cricut-companion/craft-core";
import { buildPenFillStrokes } from "./pen-fill-render";
import {
  type Point,
  type Rect,
  applyMatrix,
  clipPolylineToRect,
  flattenSvgPath,
  formatPolylinePath,
  multiplyMatrices,
  parseSvgTransform,
} from "@cricut-companion/craft-core";

export type WorkspaceObjectSourceKind = "image" | "shape" | "text";

export type WorkspaceTextContent = {
  text: string;
  fontFamily: string;
  fontSize: number;       // workspace pixels
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textDecoration: "none" | "underline";
  textAlign: "left" | "center" | "right";
  letterSpacing: number;  // extra pixels between characters
  lineHeight: number;     // multiplier (1.2 = 120%)
  color: string;          // hex — drives the tool color match
  singleLine?: boolean;   // draw/cut as single-line centerline strokes, not filled glyphs
};

export type WorkspacePathVisual = {
  fill: string;
  stroke: string;
  strokeWidth: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
};

export type WorkspacePathData = WorkspacePathVisual & {
  id: string;
  d: string;
  fillRule?: string; // "evenodd" | "nonzero" — preserved for compound paths with holes
  pathTransform?: string;
  sourceLabel?: string;
};

export type WorkspaceObjectBase = {
  id: string;
  kind: WorkspaceObjectSourceKind;
  sourceKind: WorkspaceObjectSourceKind;
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  sizeCopy: string;
  transform: WorkspaceItemTransform;
  frame: WorkspaceItemFrame;
  textContent?: WorkspaceTextContent; // present only for text items
  cornerRadius?: number; // corner-rounding for shapes (frame units, radius at scale 1)
  penFill?: PenFillSettings; // infill pattern for pen-drawn objects; strokes are generated, never stored
  spotify?: WorkspaceSpotifyRef; // set on Spotify codes, so the song can be swapped in place
};

export type WorkspaceSpotifyRef = { uri: string; name: string };

export type WorkspacePathObject = WorkspaceObjectBase & {
  type: "path";
  paths: [WorkspacePathData];
};

export type WorkspaceGroupObject = WorkspaceObjectBase & {
  type: "group";
  paths: WorkspacePathData[];
};

export type WorkspaceObject = WorkspacePathObject | WorkspaceGroupObject;

export type WorkspaceSvgItem = WorkspaceObject;

export function cloneWorkspaceObjects(items: WorkspaceObject[]): WorkspaceObject[] {
  return items.map((item) => ({
    ...item,
    frame: { ...item.frame },
    transform: { ...item.transform },
    paths: item.paths.map((path) => ({ ...path })) as WorkspaceObject["paths"],
  })) as WorkspaceObject[];
}

export function getWorkspaceObjectPartCount(item: WorkspaceObject): number {
  return item.paths.length;
}

export function buildTextContentSvg(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): string {
  if (tc.singleLine) {
    const d = traceCenterlinePathD(tc, frame);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(frame.width)}" height="${formatNumber(frame.height)}" viewBox="0 0 ${formatNumber(frame.width)} ${formatNumber(frame.height)}"><path d="${escapeXml(d)}" fill="none" stroke="${escapeXml(tc.color)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const lineH = tc.fontSize * tc.lineHeight;
  const lines = tc.text.split("\n");
  const anchorX = tc.textAlign === "center" ? frame.width / 2 : tc.textAlign === "right" ? frame.width - 1 : 1;
  const anchor = tc.textAlign === "center" ? "middle" : tc.textAlign === "right" ? "end" : "start";
  const textEls = lines.map((line, i) =>
    `<text x="${anchorX}" y="${tc.fontSize + i * lineH}" text-anchor="${anchor}" font-family="${escapeXml(tc.fontFamily)}" font-size="${tc.fontSize}" font-weight="${tc.fontWeight}" font-style="${tc.fontStyle}" text-decoration="${tc.textDecoration}" fill="${escapeXml(tc.color)}" letter-spacing="${tc.letterSpacing}">${escapeXml(line || " ")}</text>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(frame.width)}" height="${formatNumber(frame.height)}" viewBox="0 0 ${formatNumber(frame.width)} ${formatNumber(frame.height)}">${textEls}</svg>`;
}

export function buildWorkspaceObjectSvg(item: WorkspaceObject): string {
  if (item.textContent && item.paths.length === 0) {
    return buildTextContentSvg(item.textContent, item.frame);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(item.frame.width)}" height="${formatNumber(item.frame.height)}" viewBox="0 0 ${formatNumber(item.frame.width)} ${formatNumber(item.frame.height)}">${item.paths
    .map((path) => {
      const transform = path.pathTransform ? ` transform="${escapeXml(path.pathTransform)}"` : "";
      const strokeLinecap = path.strokeLinecap ? ` stroke-linecap="${escapeXml(path.strokeLinecap)}"` : "";
      const strokeLinejoin = path.strokeLinejoin ? ` stroke-linejoin="${escapeXml(path.strokeLinejoin)}"` : "";
      const fillRule = path.fillRule ? ` fill-rule="${escapeXml(path.fillRule)}"` : "";
      return `<path d="${escapeXml(path.d)}" fill="${escapeXml(path.fill)}"${fillRule} stroke="${escapeXml(path.stroke)}" stroke-width="${escapeXml(path.strokeWidth)}"${strokeLinecap}${strokeLinejoin}${transform}/>`;
    })
    .join("")}</svg>`;
}

type CutTool = { color: string; type: "pen" | "cut" };

/** One path headed for the cutter, kept as data so it can be cropped before it is written out. */
type CutPathElement = {
  d: string;
  fill: string;
  fillRule?: string;
  stroke: string;
  strokeWidth: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  transform?: string;
};

/** A cut element is a path, or raw SVG (live <text> that couldn't be traced) that is passed through as-is. */
type CutElement = CutPathElement | string;

function renderCutElement(element: CutElement): string {
  if (typeof element === "string") return element;
  const fillRule = element.fillRule ? ` fill-rule="${escapeXml(element.fillRule)}"` : "";
  const strokeLinecap = element.strokeLinecap ? ` stroke-linecap="${escapeXml(element.strokeLinecap)}"` : "";
  const strokeLinejoin = element.strokeLinejoin ? ` stroke-linejoin="${escapeXml(element.strokeLinejoin)}"` : "";
  const transform = element.transform ? ` transform="${escapeXml(element.transform)}"` : "";
  return `<path d="${escapeXml(element.d)}" fill="${escapeXml(element.fill)}"${fillRule} stroke="${escapeXml(element.stroke)}" stroke-width="${escapeXml(element.strokeWidth)}"${strokeLinecap}${strokeLinejoin}${transform}/>`;
}

function buildItemCutElements(item: WorkspaceObject, tools?: CutTool[]): CutElement[] {
  // Text items with no paths: emit <text> elements (or stroke paths for single-line text)
  if (item.textContent && item.paths.length === 0) {
    const tc = item.textContent;
    if (tc.singleLine) {
      // Open strokes, fill=none → slicebug reads the stroke colour and treats it as a pen draw.
      return [{
        d: traceCenterlinePathD(tc, item.frame),
        fill: "none",
        stroke: tc.color,
        strokeWidth: "1.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }];
    }
    const lineH = tc.fontSize * tc.lineHeight;
    const anchorX = tc.textAlign === "center" ? item.frame.width / 2 : tc.textAlign === "right" ? item.frame.width - 1 : 1;
    const anchor = tc.textAlign === "center" ? "middle" : tc.textAlign === "right" ? "end" : "start";
    return tc.text.split("\n").map((line, i) =>
      `<text x="${anchorX}" y="${tc.fontSize + i * lineH}" text-anchor="${anchor}" font-family="${escapeXml(tc.fontFamily)}" font-size="${tc.fontSize}" font-weight="${tc.fontWeight}" font-style="${tc.fontStyle}" text-decoration="${tc.textDecoration}" fill="${escapeXml(tc.color)}" stroke="none" letter-spacing="${tc.letterSpacing}">${escapeXml(line || " ")}</text>`,
    );
  }
  // SVG path items. Shapes regenerate their geometry from kind + size + corner radius
  // (scale-aware, matching the on-screen render) so the cut matches what you see.
  const shapeD = item.shapeKind
    ? buildShapePath(item.shapeKind, item.frame.width, item.frame.height, item.cornerRadius ?? 0, item.transform.scaleX, item.transform.scaleY)
    : null;
  // Pen fills go out as real open strokes in the pen colour: slicebug only draws stroked
  // outlines, so a fill="url(#pattern)" or clip-path would be ignored.
  const fillStrokes: CutElement[] = buildPenFillStrokes(item, tools).map(({ color, d }) => ({
    d,
    fill: "none",
    stroke: color,
    strokeWidth: "1.25",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  }));
  return fillStrokes.concat(item.paths.map((path) => {
    // Determine cut vs pen using the tools list (same logic as WorkspaceObjectArtwork).
    const matchedTool = tools?.find((t) => t.color.toLowerCase() === (path.stroke ?? "").toLowerCase());
    const isPen = matchedTool?.type === "pen";
    const toolColor = path.stroke && path.stroke !== "none" ? path.stroke : path.fill;

    // Pen paths: outline only — fill=none, stroke=tool colour (slicebug reads stroke for tool detection)
    // Cut paths: filled shape  — fill=tool colour AND stroke=tool colour so slicebug can detect the colour
    return {
      d: shapeD ?? path.d,
      fill: isPen ? "none" : toolColor,
      fillRule: path.fillRule,
      stroke: toolColor, // always keep stroke so slicebug can read the tool colour
      strokeWidth: isPen ? path.strokeWidth : "0.5", // thin stroke for cut paths (visual only)
      strokeLinecap: path.strokeLinecap,
      strokeLinejoin: path.strokeLinejoin,
      transform: !shapeD && path.pathTransform ? path.pathTransform : undefined,
    };
  }));
}

function buildItemInnerSvg(item: WorkspaceObject, tools?: CutTool[]): string {
  return buildItemCutElements(item, tools).map(renderCutElement).join("");
}

function itemCutTransform(item: WorkspaceObject): string {
  const mx = item.transform.mirrorX ? -1 : 1;
  const my = item.transform.mirrorY ? -1 : 1;
  const W = item.frame.width * item.transform.scaleX;
  const H = item.frame.height * item.transform.scaleY;
  // mirror is applied last (innermost) — compensate position so content cuts at correct location
  const mirrorOffset = mx !== 1 || my !== 1
    ? ` translate(${mx !== 1 ? formatNumber(W) : 0} ${my !== 1 ? formatNumber(H) : 0}) scale(${mx} ${my})`
    : "";
  return `translate(${formatNumber(item.transform.x)} ${formatNumber(item.transform.y)}) rotate(${formatNumber(item.transform.rotation)}) scale(${formatNumber(item.transform.scaleX)} ${formatNumber(item.transform.scaleY)})${mirrorOffset}`;
}

/** Curves are flattened to within this distance (mat pixels, ~0.016 mm) where a path has to be cut at the paper edge. */
const CROP_FLATTEN_TOLERANCE_PX = 0.05;
const CROP_EDGE_EPSILON_PX = 1e-6;

/**
 * Crops one item to the paper. Paths fully on the paper keep their exact curves
 * inside the item's transform; paths fully off it are dropped; paths crossing an
 * edge are flattened in mat coordinates and cut at the edge, so only what lies
 * on the paper is drawn or cut. Cutting a shape's outline up to the paper edge
 * frees the same piece the uncropped shape would have.
 */
function cropItemForPaper(item: WorkspaceObject, tools: CutTool[] | undefined, paper: Rect): string {
  const transform = itemCutTransform(item);
  const itemMatrix = parseSvgTransform(transform);
  const inside: string[] = [];
  const crossing: string[] = [];
  for (const element of buildItemCutElements(item, tools)) {
    if (typeof element === "string") {
      inside.push(element);
      continue;
    }
    const matrix = multiplyMatrices(itemMatrix, parseSvgTransform(element.transform));
    const [a, b, c, d] = matrix;
    const scale = Math.sqrt(Math.abs(a * d - b * c)) || 1;
    const subpaths = flattenSvgPath(element.d, CROP_FLATTEN_TOLERANCE_PX / scale).map((subpath) =>
      subpath.points.map((point) => applyMatrix(matrix, point)),
    );
    const points = subpaths.flat();
    if (points.length === 0) continue;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const paperRight = paper.x + paper.width;
    const paperBottom = paper.y + paper.height;
    if (minX >= paper.x - CROP_EDGE_EPSILON_PX && maxX <= paperRight + CROP_EDGE_EPSILON_PX && minY >= paper.y - CROP_EDGE_EPSILON_PX && maxY <= paperBottom + CROP_EDGE_EPSILON_PX) {
      inside.push(renderCutElement(element));
      continue;
    }
    if (maxX <= paper.x || minX >= paperRight || maxY <= paper.y || minY >= paperBottom) {
      continue;
    }
    const runs = subpaths.flatMap((subpath) => joinWrappedRuns(subpath, clipPolylineToRect(subpath, paper)));
    if (runs.length === 0) continue;
    // Open runs in mat coordinates: no fill, no transform.
    crossing.push(renderCutElement({
      ...element,
      d: formatPolylinePath(runs.map((run) => ({ points: run }))),
      fill: "none",
      fillRule: undefined,
      transform: undefined,
    }));
  }
  const group = inside.length > 0 ? `<g transform="${transform}">${inside.join("")}</g>` : "";
  return group + crossing.join("");
}

/**
 * A closed outline that starts on the paper is cut into a first and a last run that
 * actually meet at its start point; join them so the tool doesn't lift there.
 */
function joinWrappedRuns(subpath: Point[], runs: Point[][]): Point[][] {
  const start = subpath[0];
  const end = subpath[subpath.length - 1];
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (runs.length < 2 || !start || !end || !first || !last || start.x !== end.x || start.y !== end.y) return runs;
  const lastPoint = last[last.length - 1];
  if (!lastPoint || lastPoint.x !== first[0]?.x || lastPoint.y !== first[0]?.y) return runs;
  return [[...last, ...first.slice(1)], ...runs.slice(1, -1)];
}

function svgShell(matWidthPx: number, matHeightPx: number, pixelsPerInch: number, content: string): string {
  const vbW = formatNumber(Math.max(1, matWidthPx));
  const vbH = formatNumber(Math.max(1, matHeightPx));
  // Express width/height in physical inches so cutters never misinterpret the DPI.
  // viewBox keeps the internal coordinate system in workspace pixels.
  const physW = formatNumber(matWidthPx / pixelsPerInch);
  const physH = formatNumber(matHeightPx / pixelsPerInch);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${physW}in" height="${physH}in" viewBox="0 0 ${vbW} ${vbH}">${content}</svg>`;
}

/**
 * The SVG sent to the cutter. With `paper`, everything is cropped to that
 * rectangle so objects parked beside the mat, or hanging off the paper, are
 * not drawn or cut (the cutter would otherwise squash them onto the mat edge).
 */
export function buildWorkspaceCutSvg(
  items: WorkspaceObject[],
  matWidthPx: number,
  matHeightPx: number,
  tools?: CutTool[],
  pixelsPerInch = 80,
  extraInnerSvg = "", // generated geometry (e.g. insert-card slots) cut alongside the objects
  paper?: Rect,
): string {
  const content = items
    .map((item) => (paper ? cropItemForPaper(item, tools, paper) : `<g transform="${itemCutTransform(item)}">${buildItemInnerSvg(item, tools)}</g>`))
    .join("");
  return svgShell(matWidthPx, matHeightPx, pixelsPerInch, `${content}${extraInnerSvg}`);
}

/**
 * What the cut preview shows: the full design (filled shapes stay filled) clipped
 * to the paper, which is exactly what the cropped cutter SVG produces.
 */
export function buildWorkspaceCutPreviewSvg(
  items: WorkspaceObject[],
  matWidthPx: number,
  matHeightPx: number,
  tools?: CutTool[],
  pixelsPerInch = 80,
  extraInnerSvg = "",
  paper?: Rect,
): string {
  const content = items.map((item) => `<g transform="${itemCutTransform(item)}">${buildItemInnerSvg(item, tools)}</g>`).join("") + extraInnerSvg;
  if (!paper) {
    return svgShell(matWidthPx, matHeightPx, pixelsPerInch, content);
  }
  const clip = `<defs><clipPath id="kindcut-paper"><rect x="${formatNumber(paper.x)}" y="${formatNumber(paper.y)}" width="${formatNumber(paper.width)}" height="${formatNumber(paper.height)}"/></clipPath></defs>`;
  return svgShell(matWidthPx, matHeightPx, pixelsPerInch, `${clip}<g clip-path="url(#kindcut-paper)">${content}</g>`);
}

/** True when the cropped cutter SVG has nothing left to draw or cut. */
export function isCutSvgEmpty(svg: string): boolean {
  return !/<path\b|<text\b/.test(svg);
}

export function buildWorkspaceObjectsSvg(items: WorkspaceObject[]): string {
  if (items.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
  }
  const right = Math.max(...items.map((item) => item.transform.x + item.frame.width * item.transform.scaleX));
  const bottom = Math.max(...items.map((item) => item.transform.y + item.frame.height * item.transform.scaleY));
  const width = Math.max(1, right);
  const height = Math.max(1, bottom);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width)}" height="${formatNumber(height)}" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}">${items
    .map((item) => {
      const transform = `translate(${formatNumber(item.transform.x)} ${formatNumber(item.transform.y)}) rotate(${formatNumber(item.transform.rotation)}) scale(${formatNumber(item.transform.scaleX)} ${formatNumber(item.transform.scaleY)})`;
      return `<g transform="${transform}">${buildItemInnerSvg(item)}</g>`;
    })
    .join("")}</svg>`;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
