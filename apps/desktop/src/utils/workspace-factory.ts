import type { Language } from "../i18n";
import type { WorkspaceItemTransform } from "../workspace-utils";
import type { WorkspaceObject, WorkspacePathData, WorkspaceSvgItem } from "../workspace-objects";
import { cloneWorkspaceObjects } from "../workspace-objects";
import { extractWorkspacePathsFromSvg } from "../workspace-svg-import";
import { getSvgSizeCopy, getSvgSizeInfo } from "../svg-import";
import type { WorkspaceShapeKind } from "../workspace-shapes";
import {
  DEFAULT_SHAPE_SIZE,
  ROUNDED_SQUARE_DEFAULT_RADIUS,
  buildShapePath,
  getWorkspaceShapeDefinition,
} from "../workspace-shapes";
import { computeSnugFrame } from "./workspace-geometry";

export function createWorkspaceSvgItem({
  id,
  kind = "image",
  shapeKind,
  fileName,
  fileSize,
  svg,
  language,
  index,
  transform,
}: {
  id: string;
  kind?: "image" | "shape";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  svg: string;
  language: Language;
  index: number;
  transform?: WorkspaceItemTransform;
}): WorkspaceSvgItem {
  const extracted = extractWorkspacePathsFromSvg(svg);
  const sizeInfo = getSvgSizeInfo(svg);
  const base = {
    id,
    kind,
    sourceKind: kind,
    shapeKind,
    fileName,
    fileSize,
    sizeCopy: getSvgSizeCopy(sizeInfo, language),
    frame: extracted.frame,
    transform: transform ?? { x: 32 + index * 24, y: 32 + index * 24, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const item: WorkspaceSvgItem = extracted.paths.length === 1
    ? { ...base, type: "path", paths: [extracted.paths[0]!] }
    : { ...base, type: "group", paths: extracted.paths };
  return computeSnugFrame(item);
}

export function createWorkspaceObjectItem({
  id,
  type,
  kind = "image",
  sourceKind,
  shapeKind,
  fileName,
  fileSize,
  frame,
  paths,
  language: _language,
  index,
  transform,
  textContent,
  cornerRadius,
}: {
  id: string;
  type: "path" | "group";
  kind?: "image" | "shape" | "text";
  sourceKind?: "image" | "shape" | "text";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  frame: { width: number; height: number };
  paths: WorkspaceObject["paths"];
  language: Language;
  index: number;
  transform?: WorkspaceItemTransform;
  textContent?: WorkspaceObject["textContent"];
  cornerRadius?: number;
}): WorkspaceSvgItem {
  return {
    id,
    type,
    kind,
    sourceKind: sourceKind ?? kind,
    shapeKind,
    fileName,
    fileSize,
    sizeCopy: `${Math.round(frame.width)} × ${Math.round(frame.height)} px`,
    frame,
    paths: paths.map((path) => ({ ...path })) as WorkspaceObject["paths"],
    transform: transform ?? { x: 32 + index * 24, y: 32 + index * 24, scaleX: 1, scaleY: 1, rotation: 0 },
    textContent: textContent ? { ...textContent } : undefined,
    cornerRadius,
  } as WorkspaceSvgItem;
}

export function createWorkspaceShapeItem({
  shapeKind,
  language,
  index,
  timestamp,
}: {
  shapeKind: WorkspaceShapeKind;
  language: Language;
  index: number;
  timestamp: number;
}): WorkspaceSvgItem {
  const definition = getWorkspaceShapeDefinition(shapeKind);
  const label = language === "nl" ? definition.labelNl : definition.labelEn;
  // Shapes are generated bounds-tight in their frame, so no snug pass is needed.
  // "Rounded square" is just a square with a preset corner radius.
  const cornerRadius = shapeKind === "rounded-square" ? ROUNDED_SQUARE_DEFAULT_RADIUS : 0;
  const size = DEFAULT_SHAPE_SIZE;
  const path: WorkspacePathData = {
    id: "path-1",
    d: buildShapePath(shapeKind, size, size, cornerRadius),
    fill: "none",
    stroke: "#000000",
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return createWorkspaceObjectItem({
    id: `shape-${timestamp}-${index}`,
    type: "path",
    kind: "shape",
    sourceKind: "shape",
    shapeKind,
    fileName: label,
    fileSize: language === "nl" ? "KindCut-vorm" : "KindCut shape",
    frame: { width: size, height: size },
    paths: [path],
    language,
    index,
    cornerRadius,
  });
}

export function cloneWorkspaceSvgItems(items: WorkspaceSvgItem[]): WorkspaceSvgItem[] {
  return cloneWorkspaceObjects(items) as WorkspaceSvgItem[];
}

export function workspaceTransformsEqual(a: WorkspaceItemTransform, b: WorkspaceItemTransform): boolean {
  return a.x === b.x && a.y === b.y && a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotation === b.rotation;
}
