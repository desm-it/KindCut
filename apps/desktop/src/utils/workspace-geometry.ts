import type { WorkspaceItemTransform } from "../workspace-utils";
import { formatN, rotatePoint } from "../workspace-utils";
import type { WorkspacePathData, WorkspaceSvgItem } from "../workspace-objects";
import { splitPathData } from "../workspace-grouping";

export function parseGroupedPathTransform(pathTransform: string | undefined): {
  dx: number; dy: number; rotation: number; scaleX: number; scaleY: number; original: string;
} {
  if (!pathTransform) return { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1, original: "" };
  let rem = pathTransform;
  const tMatch = rem.match(/^translate\(([-\d.e]+)\s+([-\d.e]+)\)\s*/);
  const dx = tMatch ? parseFloat(tMatch[1]!) : 0;
  const dy = tMatch ? parseFloat(tMatch[2]!) : 0;
  if (tMatch) rem = rem.slice(tMatch[0].length);
  const rMatch = rem.match(/^rotate\(([-\d.e]+)\)\s*/);
  const rotation = rMatch ? parseFloat(rMatch[1]!) : 0;
  if (rMatch) rem = rem.slice(rMatch[0].length);
  const sMatch = rem.match(/^scale\(([-\d.e]+)\s+([-\d.e]+)\)\s*/);
  const scaleX = sMatch ? parseFloat(sMatch[1]!) : 1;
  const scaleY = sMatch ? parseFloat(sMatch[2]!) : 1;
  if (sMatch) rem = rem.slice(sMatch[0].length);
  return { dx, dy, rotation, scaleX, scaleY, original: rem.trim() };
}

export function computePathBBoxInDOM(d: string, transform?: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.style.cssText = "position:fixed;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none";
    // getBBox() ignores the element's OWN transform, so wrap the path in a <g> and
    // measure the group — its bbox DOES include the child's transform.
    const group = document.createElementNS(ns, "g");
    const pathEl = document.createElementNS(ns, "path");
    pathEl.setAttribute("d", d);
    if (transform) pathEl.setAttribute("transform", transform);
    group.appendChild(pathEl);
    svg.appendChild(group);
    document.body.appendChild(svg);
    const bbox = group.getBBox();
    document.body.removeChild(svg);
    return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  } catch {
    return null;
  }
}

/**
 * Computes the tight bounding box of all paths in a workspace item using DOM getBBox().
 * Shifts paths so content starts at (0,0) and adjusts the item's frame and position
 * so no visual change occurs — the bounding box just snugly wraps the actual content.
 */
export function computeSnugFrame(item: WorkspaceSvgItem): WorkspaceSvgItem {
  if (item.textContent) return item;
  const validPaths = item.paths.filter((p) => p.d);
  if (validPaths.length === 0) return item;

  // Batch all paths into a single off-screen SVG for efficiency
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;overflow:visible";
  svg.setAttribute("viewBox", "0 0 100000 100000");
  document.body.appendChild(svg);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  try {
    for (const path of validPaths) {
      // Wrap in a <g> so getBBox accounts for the path's own transform.
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", path.d);
      if (path.pathTransform) el.setAttribute("transform", path.pathTransform);
      g.appendChild(el);
      svg.appendChild(g);
      const bb = g.getBBox();
      if (bb.width > 0 || bb.height > 0) {
        minX = Math.min(minX, bb.x);
        minY = Math.min(minY, bb.y);
        maxX = Math.max(maxX, bb.x + bb.width);
        maxY = Math.max(maxY, bb.y + bb.height);
      }
    }
  } finally {
    document.body.removeChild(svg);
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return item;

  const newWidth = Math.max(1, maxX - minX);
  const newHeight = Math.max(1, maxY - minY);

  // Already snug — skip
  if (Math.abs(minX) < 0.5 && Math.abs(minY) < 0.5 &&
      Math.abs(newWidth - item.frame.width) < 0.5 &&
      Math.abs(newHeight - item.frame.height) < 0.5) {
    return item;
  }

  // Shift all paths so content begins at (0,0) in SVG coordinate space
  const needsShift = Math.abs(minX) >= 0.5 || Math.abs(minY) >= 0.5;
  const updatedPaths = validPaths.map((p) => ({
    ...p,
    pathTransform: needsShift
      ? (p.pathTransform
          ? `translate(${-minX} ${-minY}) ${p.pathTransform}`
          : `translate(${-minX} ${-minY})`)
      : p.pathTransform,
  }));

  // Adjust world-position so the object doesn't appear to move (handles rotation)
  const cropOffset = rotatePoint(
    { x: minX * item.transform.scaleX, y: minY * item.transform.scaleY },
    item.transform.rotation,
  );

  return {
    ...item,
    frame: { width: newWidth, height: newHeight },
    transform: { ...item.transform, x: item.transform.x + cropOffset.x, y: item.transform.y + cropOffset.y },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    paths: updatedPaths as any,
  } as WorkspaceSvgItem;
}

/**
 * Break a compound single-path object (traced/AI art) into separate objects by spatial
 * containment: a subpath that sits inside another is kept WITH its container (so holes /
 * inner detail and the fill rule are preserved). Top-level (uncontained) subpaths each
 * start a new object — e.g. three traced flowers become three flower objects, not dozens
 * of silhouette pieces. Each result is snug-framed so its box hugs its own art.
 */
export function splitCompoundPathByContainment(input: {
  item: WorkspaceSvgItem;
  idPrefix: string;
  labelForIndex: (index: number) => string;
}): WorkspaceSvgItem[] {
  const { item } = input;
  const path = item.paths[0];
  if (item.type !== "path" || !path) {
    return [];
  }
  const subpaths = splitPathData(path.d);
  if (subpaths.length < 2) {
    return [];
  }
  // Measure each subpath's bbox WITH the path transform applied. getBBox() on a path
  // ignores the element's own transform, so we wrap it in a <g> (whose getBBox DOES
  // include the child transform) to get the true position in the item's frame space.
  const boxes = measureSubpathBoxes(subpaths, path.pathTransform);
  const groups = groupSubpathsByContainment(boxes);

  let index = 0;
  const result: WorkspaceSvgItem[] = [];
  for (const members of groups) {
    // Combined bbox of the group (already in frame-space, transform applied).
    let gx = Infinity, gy = Infinity, gx2 = -Infinity, gy2 = -Infinity;
    for (const m of members) {
      const b = boxes[m]!;
      gx = Math.min(gx, b.x);
      gy = Math.min(gy, b.y);
      gx2 = Math.max(gx2, b.x + b.width);
      gy2 = Math.max(gy2, b.y + b.height);
    }
    const gw = Math.max(1, gx2 - gx);
    const gh = Math.max(1, gy2 - gy);
    const d = members.map((m) => subpaths[m]).join(" ");
    // Shift the group to the local origin (translate applied AFTER the source transform),
    // and move the item so the art stays put — mirrors computeSnugFrame, but with a
    // correctly-measured offset.
    const shift = `translate(${round(-gx)} ${round(-gy)})`;
    const newPathTransform = path.pathTransform ? `${shift} ${path.pathTransform}` : shift;
    const cropOffset = rotatePoint(
      { x: gx * item.transform.scaleX, y: gy * item.transform.scaleY },
      item.transform.rotation,
    );
    result.push({
      ...item,
      id: `${input.idPrefix}-${index}`,
      type: "path",
      shapeKind: undefined,
      fileName: input.labelForIndex(index),
      frame: { width: gw, height: gh },
      transform: { ...item.transform, x: item.transform.x + cropOffset.x, y: item.transform.y + cropOffset.y },
      // Keep the source path's fill rule / colours; only the geometry & shift change.
      paths: [{ ...path, id: "path-1", d, pathTransform: newPathTransform }] as [WorkspacePathData],
    } as WorkspaceSvgItem);
    index++;
  }
  return result;
}

// A traced/compound path can be ungrouped only if it has 2+ TOP-LEVEL shapes — a single
// flower (one outline + holes contained inside it) is one shape, not many.
export function isUngroupablePath(item: WorkspaceSvgItem): boolean {
  const path = item.paths[0];
  if (item.type !== "path" || !path) return false;
  const subpaths = splitPathData(path.d);
  if (subpaths.length < 2) return false;
  return groupSubpathsByContainment(measureSubpathBoxes(subpaths, path.pathTransform)).length >= 2;
}

type BBox = { x: number; y: number; width: number; height: number };

// Group subpath indices so a subpath contained inside another stays with its outermost
// container (its holes/detail). Returns one index list per top-level shape, order kept.
function groupSubpathsByContainment(boxes: BBox[]): number[][] {
  const EPS = 0.5;
  const contains = (a: BBox, b: BBox): boolean => {
    if (a === b) return false;
    const sameBox = Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.width - b.width) < EPS && Math.abs(a.height - b.height) < EPS;
    if (sameBox) return false;
    return a.x <= b.x + EPS && a.y <= b.y + EPS && a.x + a.width >= b.x + b.width - EPS && a.y + a.height >= b.y + b.height - EPS;
  };
  const isRoot = boxes.map((b, i) => !boxes.some((o, j) => j !== i && contains(o, b)));
  const rootIndices = boxes.map((_, i) => i).filter((i) => isRoot[i]);
  const rootFor = (i: number): number => {
    if (isRoot[i]) return i;
    let best = -1;
    let bestArea = Infinity;
    for (const r of rootIndices) {
      if (contains(boxes[r]!, boxes[i]!)) {
        const area = boxes[r]!.width * boxes[r]!.height;
        if (area < bestArea) {
          bestArea = area;
          best = r;
        }
      }
    }
    return best === -1 ? i : best;
  };
  const groups = new Map<number, number[]>();
  for (let i = 0; i < boxes.length; i++) {
    const root = rootFor(i);
    const existing = groups.get(root);
    if (existing) existing.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

// Measure subpath bounding boxes with `pathTransform` applied (via a <g> wrapper).
function measureSubpathBoxes(subpaths: string[], pathTransform: string | undefined): BBox[] {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;overflow:visible";
  svg.setAttribute("viewBox", "0 0 100000 100000");
  document.body.appendChild(svg);
  const boxes: BBox[] = [];
  try {
    for (const d of subpaths) {
      const g = document.createElementNS(ns, "g");
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      if (pathTransform) p.setAttribute("transform", pathTransform);
      g.appendChild(p);
      svg.appendChild(g);
      const bb = g.getBBox();
      boxes.push({ x: bb.x, y: bb.y, width: bb.width, height: bb.height });
    }
  } finally {
    document.body.removeChild(svg);
  }
  return boxes;
}

function round(n: number): number {
  return Number(n.toFixed(3));
}

export function reframeUngroupedChild(child: WorkspaceSvgItem, groupTransform: WorkspaceItemTransform): WorkspaceSvgItem {
  const firstPath = child.paths[0];
  if (!firstPath) return child;

  // All paths in a segment share the same item-level transform prefix from createWorkspaceGroup.
  const { dx, dy, rotation: pathRot, scaleX: pathSx, scaleY: pathSy } = parseGroupedPathTransform(firstPath.pathTransform);

  // Compute bounding box of each path in the item's local space (using original path transform, before group was added).
  const bboxes = child.paths.map((p) => {
    const { original } = parseGroupedPathTransform(p.pathTransform);
    return computePathBBoxInDOM(p.d, original || undefined);
  });
  const validBboxes = bboxes.filter((b): b is { x: number; y: number; width: number; height: number } => b !== null && b.width >= 0);
  if (validBboxes.length === 0) return child;

  const minX = Math.min(...validBboxes.map((b) => b.x));
  const minY = Math.min(...validBboxes.map((b) => b.y));
  const maxX = Math.max(...validBboxes.map((b) => b.x + b.width));
  const maxY = Math.max(...validBboxes.map((b) => b.y + b.height));
  const naturalWidth = maxX - minX;
  const naturalHeight = maxY - minY;
  if (naturalWidth <= 0 || naturalHeight <= 0) return child;

  // Rebuild paths: strip the group-added translate/rotate/scale, keep original, offset to 0,0.
  const newPaths = child.paths.map((p) => {
    const { original } = parseGroupedPathTransform(p.pathTransform);
    const offset = minX !== 0 || minY !== 0 ? `translate(${formatN(-minX)} ${formatN(-minY)})` : "";
    const newTransform = [offset, original].filter(Boolean).join(" ") || undefined;
    return { ...p, pathTransform: newTransform };
  });

  // Reconstruct world transform: combine group world transform with path's local translate(dx, dy) + natural offset.
  const offsetX = (dx + minX) * groupTransform.scaleX;
  const offsetY = (dy + minY) * groupTransform.scaleY;
  const rotated = rotatePoint({ x: offsetX, y: offsetY }, groupTransform.rotation);

  const paths = child.type === "path"
    ? [newPaths[0]!] as [WorkspacePathData]
    : newPaths as WorkspacePathData[];

  return {
    ...child,
    frame: { width: naturalWidth, height: naturalHeight },
    sizeCopy: `${Math.round(naturalWidth)} × ${Math.round(naturalHeight)} px`,
    transform: {
      x: groupTransform.x + rotated.x,
      y: groupTransform.y + rotated.y,
      rotation: groupTransform.rotation + pathRot,
      scaleX: groupTransform.scaleX * pathSx,
      scaleY: groupTransform.scaleY * pathSy,
    },
    paths,
  } as WorkspaceSvgItem;
}
