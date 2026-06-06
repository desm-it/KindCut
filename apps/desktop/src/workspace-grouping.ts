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

// Split a path "d" into its absolute-moveto subpaths. Traced/Potrace output uses
// absolute coordinates, so each "M …" run is a standalone shape. (Relative "m"
// subpaths are left attached, since detaching them would misposition the piece.)
export function splitPathData(d: string): string[] {
  const matches = d.match(/M[^M]*/g);
  return matches ? matches.map((piece) => piece.trim()).filter(Boolean) : [];
}

// A single path object that contains 2+ subpaths can be broken into separate objects.
export function isCompoundPathItem(item: WorkspaceObject): boolean {
  return item.type === "path" && splitPathData(item.paths[0]?.d ?? "").length > 1;
}

// Break a compound single-path object (e.g. an AI-traced design) into one object per
// subpath. Each piece keeps the source colours/transform; the caller should snug-frame
// them afterwards. NOTE: subpaths that were holes (evenodd) become solid shapes.
export function splitCompoundPathItem(input: {
  item: WorkspaceObject;
  idPrefix: string;
  labelForIndex: (index: number) => string;
}): WorkspaceObject[] {
  const { item } = input;
  const path = item.paths[0];
  if (item.type !== "path" || !path) {
    return [];
  }
  const subpaths = splitPathData(path.d);
  if (subpaths.length < 2) {
    return [];
  }
  return subpaths.map((d, index) => ({
    id: `${input.idPrefix}-${index}`,
    type: "path" as const,
    kind: item.kind,
    sourceKind: item.sourceKind,
    // The split pieces are no longer the named shape (if any).
    shapeKind: undefined,
    fileName: input.labelForIndex(index),
    fileSize: item.fileSize,
    sizeCopy: item.sizeCopy,
    frame: { ...item.frame },
    transform: { ...item.transform },
    paths: [{ ...path, id: "path-1", d }] as [WorkspacePathData],
  }));
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
