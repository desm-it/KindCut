import type { WorkspaceItemTransform } from "./workspace-utils";
import type { WorkspaceShapeKind } from "./workspace-shapes";

export type WorkspaceClipboardSvgItem = {
  kind?: "image" | "shape";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  svg: string;
  transform: WorkspaceItemTransform;
};

export type PastedWorkspaceSvgItemInput = WorkspaceClipboardSvgItem & {
  id: string;
  index: number;
};

export function getSelectedWorkspaceClipboardItems<T extends { id: string; fileName: string; fileSize: string; svg: string; transform: WorkspaceItemTransform }>(
  items: T[],
  selectedIds: string[],
  fallbackSelectedId: string | null,
): WorkspaceClipboardSvgItem[] {
  const ids = selectedIds.length > 0 ? selectedIds : fallbackSelectedId ? [fallbackSelectedId] : [];
  const selectedIdSet = new Set(ids);
  return items
    .filter((item) => selectedIdSet.has(item.id))
    .map((item) => ({
      kind: "kind" in item && item.kind === "shape" ? "shape" : "image",
      shapeKind: "shapeKind" in item ? item.shapeKind as WorkspaceShapeKind | undefined : undefined,
      fileName: item.fileName,
      fileSize: item.fileSize,
      svg: item.svg,
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
    shapeKind: item.shapeKind,
    id: `svg-${input.timestamp}-paste-${input.startIndex + itemIndex}`,
    index: input.startIndex + itemIndex,
    transform: {
      ...item.transform,
      x: item.transform.x + offset,
      y: item.transform.y + offset,
    },
  }));
}
