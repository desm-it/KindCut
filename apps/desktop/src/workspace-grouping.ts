import type { WorkspaceObject, WorkspacePathData } from "./workspace-objects";
import type { WorkspaceBounds } from "./workspace-utils";
import { getWorkspaceSelectionBounds } from "./workspace-utils";

export function createWorkspaceGroup(input: {
  id: string;
  items: WorkspaceObject[];
  label: string;
  fileSize: string;
}): WorkspaceObject | null {
  if (input.items.length < 2) {
    return null;
  }
  const bounds = getWorkspaceSelectionBounds(input.items);
  if (!bounds) {
    return null;
  }
  const paths = input.items.flatMap((item) =>
    item.paths.map((path) => ({
      ...path,
      id: `${item.id}-${path.id}`,
      sourceLabel: item.fileName,
      pathTransform: getGroupedPathTransform(item, path.pathTransform, bounds),
    })),
  );
  return {
    id: input.id,
    type: "group",
    kind: "image",
    sourceKind: "image",
    fileName: input.label,
    fileSize: input.fileSize,
    sizeCopy: `${Math.round(bounds.width)} × ${Math.round(bounds.height)} px`,
    frame: { width: bounds.width, height: bounds.height },
    paths,
    transform: { x: bounds.left, y: bounds.top, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

export function ungroupWorkspaceObject(input: {
  group: WorkspaceObject;
  idPrefix: string;
  labelForIndex: (index: number) => string;
}): WorkspaceObject[] {
  if (input.group.type !== "group") {
    return [];
  }

  // Rebuild original objects by grouping consecutive paths that share a sourceLabel.
  type Segment = { label: string; paths: WorkspacePathData[] };
  const segments: Segment[] = [];
  for (const path of input.group.paths) {
    const label = path.sourceLabel ?? null;
    const last = segments[segments.length - 1];
    if (label !== null && last && last.label === label) {
      last.paths.push(path);
    } else {
      segments.push({ label: label ?? input.labelForIndex(segments.length), paths: [path] });
    }
  }

  return segments.map((segment, index) => {
    const id = `${input.idPrefix}-${index}`;
    const cleanedPaths = segment.paths.map((p, i) => ({ ...p, id: `path-${i + 1}` }));
    const base = {
      id,
      kind: input.group.kind,
      sourceKind: input.group.sourceKind,
      shapeKind: input.group.shapeKind,
      fileName: segment.label,
      fileSize: input.group.fileSize,
      sizeCopy: input.group.sizeCopy,
      frame: { ...input.group.frame },
      transform: { ...input.group.transform },
    };
    if (cleanedPaths.length === 1) {
      return { ...base, type: "path" as const, paths: [cleanedPaths[0]!] as [WorkspacePathData] };
    }
    return { ...base, type: "group" as const, paths: cleanedPaths };
  });
}

function getGroupedPathTransform(
  item: WorkspaceObject,
  pathTransform: string | undefined,
  bounds: WorkspaceBounds,
): string {
  return [
    `translate(${formatNumber(item.transform.x - bounds.left)} ${formatNumber(item.transform.y - bounds.top)})`,
    `rotate(${formatNumber(item.transform.rotation)})`,
    `scale(${formatNumber(item.transform.scaleX)} ${formatNumber(item.transform.scaleY)})`,
    pathTransform ?? "",
  ].filter(Boolean).join(" ");
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
