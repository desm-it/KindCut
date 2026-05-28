import type { WorkspaceItemTransform } from "./workspace-utils";
import type { WorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspaceObject, WorkspacePathData } from "./workspace-objects";

export type WorkspaceClipboardSvgItem = {
  type: "path" | "group";
  kind?: "image" | "shape";
  sourceKind?: "image" | "shape";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  frame: { width: number; height: number };
  paths: WorkspacePathData[];
  transform: WorkspaceItemTransform;
};

export type PastedWorkspaceSvgItemInput = WorkspaceClipboardSvgItem & {
  id: string;
  index: number;
};

export function getSelectedWorkspaceClipboardItems(
  items: WorkspaceObject[],
  selectedIds: string[],
  fallbackSelectedId: string | null,
): WorkspaceClipboardSvgItem[] {
  const ids = selectedIds.length > 0 ? selectedIds : fallbackSelectedId ? [fallbackSelectedId] : [];
  const selectedIdSet = new Set(ids);
  return items
    .filter((item) => selectedIdSet.has(item.id))
    .map((item) => ({
      type: item.type,
      kind: item.kind,
      sourceKind: item.sourceKind,
      shapeKind: item.shapeKind,
      fileName: item.fileName,
      fileSize: item.fileSize,
      frame: { ...item.frame },
      paths: item.paths.map((path) => ({ ...path })),
      transform: { ...item.transform },
    }));
}

export function createPastedWorkspaceSvgInputs(input: {
  items: WorkspaceClipboardSvgItem[];
  startIndex: number;
  timestamp: number;
  offset?: number;
}): PastedWorkspaceSvgItemInput[] {
  const offset = input.offset ?? 24;
  return input.items.map((item, itemIndex) => ({
    ...item,
    kind: item.kind ?? "image",
    sourceKind: item.sourceKind ?? item.kind ?? "image",
    shapeKind: item.shapeKind,
    id: `object-${input.timestamp}-paste-${input.startIndex + itemIndex}`,
    index: input.startIndex + itemIndex,
    frame: { ...item.frame },
    paths: item.paths.map((path, pathIndex) => ({ ...path, id: `${path.id}-copy-${input.timestamp}-${pathIndex}` })),
    transform: {
      ...item.transform,
      x: item.transform.x + offset,
      y: item.transform.y + offset,
    },
  }));
}
