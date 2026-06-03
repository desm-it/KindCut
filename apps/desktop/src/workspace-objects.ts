import type { WorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspaceItemFrame, WorkspaceItemTransform } from "./workspace-utils";

export type WorkspaceObjectSourceKind = "image" | "shape" | "text";

export type WorkspaceTextContent = {
  text: string;
  fontFamily: string;
  fontSize: number;       // workspace pixels
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textDecoration: "none" | "underline";
  letterSpacing: number;  // extra pixels between characters
  lineHeight: number;     // multiplier (1.2 = 120%)
  color: string;          // hex — drives the tool color match
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
  const lineH = tc.fontSize * tc.lineHeight;
  const lines = tc.text.split("\n");
  const textEls = lines.map((line, i) =>
    `<text x="4" y="${4 + tc.fontSize + i * lineH}" font-family="${escapeXml(tc.fontFamily)}" font-size="${tc.fontSize}" font-weight="${tc.fontWeight}" font-style="${tc.fontStyle}" text-decoration="${tc.textDecoration}" fill="${escapeXml(tc.color)}" letter-spacing="${tc.letterSpacing}">${escapeXml(line || " ")}</text>`,
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

export function buildWorkspaceCutSvg(items: WorkspaceObject[], matWidthPx: number, matHeightPx: number): string {
  const w = formatNumber(Math.max(1, matWidthPx));
  const h = formatNumber(Math.max(1, matHeightPx));
  const paths = items
    .map((item) => {
      const transform = `translate(${formatNumber(item.transform.x)} ${formatNumber(item.transform.y)}) rotate(${formatNumber(item.transform.rotation)}) scale(${formatNumber(item.transform.scaleX)} ${formatNumber(item.transform.scaleY)})`;
      return `<g transform="${transform}">${item.paths
        .map((path) => {
          const pathTransform = path.pathTransform ? ` transform="${escapeXml(path.pathTransform)}"` : "";
          const strokeLinecap = path.strokeLinecap ? ` stroke-linecap="${escapeXml(path.strokeLinecap)}"` : "";
          const strokeLinejoin = path.strokeLinejoin ? ` stroke-linejoin="${escapeXml(path.strokeLinejoin)}"` : "";
          const fillRule = path.fillRule ? ` fill-rule="${escapeXml(path.fillRule)}"` : "";
          return `<path d="${escapeXml(path.d)}" fill="${escapeXml(path.fill)}"${fillRule} stroke="${escapeXml(path.stroke)}" stroke-width="${escapeXml(path.strokeWidth)}"${strokeLinecap}${strokeLinejoin}${pathTransform}/>`;
        })
        .join("")}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}</svg>`;
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
      return `<g transform="${transform}">${item.paths
        .map((path) => {
          const pathTransform = path.pathTransform ? ` transform="${escapeXml(path.pathTransform)}"` : "";
          return `<path d="${escapeXml(path.d)}" fill="${escapeXml(path.fill)}" stroke="${escapeXml(path.stroke)}" stroke-width="${escapeXml(path.strokeWidth)}"${pathTransform}/>`;
        })
        .join("")}</g>`;
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
