import type { WorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspaceItemFrame, WorkspaceItemTransform } from "./workspace-utils";

export type WorkspaceObjectSourceKind = "image" | "shape";

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
  pathTransform?: string;
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

export function buildWorkspaceObjectSvg(item: WorkspaceObject): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(item.frame.width)}" height="${formatNumber(item.frame.height)}" viewBox="0 0 ${formatNumber(item.frame.width)} ${formatNumber(item.frame.height)}">${item.paths
    .map((path) => {
      const transform = path.pathTransform ? ` transform="${escapeXml(path.pathTransform)}"` : "";
      const strokeLinecap = path.strokeLinecap ? ` stroke-linecap="${escapeXml(path.strokeLinecap)}"` : "";
      const strokeLinejoin = path.strokeLinejoin ? ` stroke-linejoin="${escapeXml(path.strokeLinejoin)}"` : "";
      return `<path d="${escapeXml(path.d)}" fill="${escapeXml(path.fill)}" stroke="${escapeXml(path.stroke)}" stroke-width="${escapeXml(path.strokeWidth)}"${strokeLinecap}${strokeLinejoin}${transform}/>`;
    })
    .join("")}</svg>`;
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
