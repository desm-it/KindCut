import type { WorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspaceItemFrame, WorkspaceItemTransform } from "./workspace-utils";
import { traceCenterlinePathD } from "./centerline-trace";
import { buildShapePath } from "./workspace-shapes";

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
};

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

function buildItemInnerSvg(item: WorkspaceObject, tools?: CutTool[]): string {
  // Text items with no paths: emit <text> elements (or stroke paths for single-line text)
  if (item.textContent && item.paths.length === 0) {
    const tc = item.textContent;
    if (tc.singleLine) {
      const d = traceCenterlinePathD(tc, item.frame);
      // Open strokes, fill=none → slicebug reads the stroke colour and treats it as a pen draw.
      return `<path d="${escapeXml(d)}" fill="none" stroke="${escapeXml(tc.color)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const lineH = tc.fontSize * tc.lineHeight;
    const anchorX = tc.textAlign === "center" ? item.frame.width / 2 : tc.textAlign === "right" ? item.frame.width - 1 : 1;
    const anchor = tc.textAlign === "center" ? "middle" : tc.textAlign === "right" ? "end" : "start";
    return tc.text.split("\n").map((line, i) =>
      `<text x="${anchorX}" y="${tc.fontSize + i * lineH}" text-anchor="${anchor}" font-family="${escapeXml(tc.fontFamily)}" font-size="${tc.fontSize}" font-weight="${tc.fontWeight}" font-style="${tc.fontStyle}" text-decoration="${tc.textDecoration}" fill="${escapeXml(tc.color)}" stroke="none" letter-spacing="${tc.letterSpacing}">${escapeXml(line || " ")}</text>`,
    ).join("");
  }
  // SVG path items. Shapes regenerate their geometry from kind + size + corner radius
  // (scale-aware, matching the on-screen render) so the cut matches what you see.
  const shapeD = item.shapeKind
    ? buildShapePath(item.shapeKind, item.frame.width, item.frame.height, item.cornerRadius ?? 0, item.transform.scaleX, item.transform.scaleY)
    : null;
  return item.paths.map((path) => {
    const pathTransform = !shapeD && path.pathTransform ? ` transform="${escapeXml(path.pathTransform)}"` : "";
    const strokeLinecap = path.strokeLinecap ? ` stroke-linecap="${escapeXml(path.strokeLinecap)}"` : "";
    const strokeLinejoin = path.strokeLinejoin ? ` stroke-linejoin="${escapeXml(path.strokeLinejoin)}"` : "";
    const fillRule = path.fillRule ? ` fill-rule="${escapeXml(path.fillRule)}"` : "";

    // Determine cut vs pen using the tools list (same logic as WorkspaceObjectArtwork).
    const matchedTool = tools?.find((t) => t.color.toLowerCase() === (path.stroke ?? "").toLowerCase());
    const isPen = matchedTool?.type === "pen";
    const toolColor = path.stroke && path.stroke !== "none" ? path.stroke : path.fill;

    // Pen paths: outline only — fill=none, stroke=tool colour (slicebug reads stroke for tool detection)
    // Cut paths: filled shape  — fill=tool colour AND stroke=tool colour so slicebug can detect the colour
    const displayFill = isPen ? "none" : toolColor;
    const displayStroke = toolColor;   // always keep stroke so slicebug can read the tool colour
    const displayStrokeWidth = isPen ? path.strokeWidth : "0.5"; // thin stroke for cut paths (visual only)

    return `<path d="${escapeXml(shapeD ?? path.d)}" fill="${escapeXml(displayFill)}"${fillRule} stroke="${escapeXml(displayStroke)}" stroke-width="${escapeXml(displayStrokeWidth)}"${strokeLinecap}${strokeLinejoin}${pathTransform}/>`;
  }).join("");
}

export function buildWorkspaceCutSvg(
  items: WorkspaceObject[],
  matWidthPx: number,
  matHeightPx: number,
  tools?: CutTool[],
  pixelsPerInch = 80,
  extraInnerSvg = "", // generated geometry (e.g. insert-card slots) cut alongside the objects
): string {
  const vbW = formatNumber(Math.max(1, matWidthPx));
  const vbH = formatNumber(Math.max(1, matHeightPx));
  // Express width/height in physical inches so cutters never misinterpret the DPI.
  // viewBox keeps the internal coordinate system in workspace pixels.
  const physW = formatNumber(matWidthPx / pixelsPerInch);
  const physH = formatNumber(matHeightPx / pixelsPerInch);
  const paths = items
    .map((item) => {
      const mx = item.transform.mirrorX ? -1 : 1;
      const my = item.transform.mirrorY ? -1 : 1;
      const W = item.frame.width * item.transform.scaleX;
      const H = item.frame.height * item.transform.scaleY;
      // mirror is applied last (innermost) — compensate position so content cuts at correct location
      const mirrorOffset = mx !== 1 || my !== 1
        ? ` translate(${mx !== 1 ? formatNumber(W) : 0} ${my !== 1 ? formatNumber(H) : 0}) scale(${mx} ${my})`
        : "";
      const transform = `translate(${formatNumber(item.transform.x)} ${formatNumber(item.transform.y)}) rotate(${formatNumber(item.transform.rotation)}) scale(${formatNumber(item.transform.scaleX)} ${formatNumber(item.transform.scaleY)})${mirrorOffset}`;
      return `<g transform="${transform}">${buildItemInnerSvg(item, tools)}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${physW}in" height="${physH}in" viewBox="0 0 ${vbW} ${vbH}">${paths}${extraInnerSvg}</svg>`;
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
