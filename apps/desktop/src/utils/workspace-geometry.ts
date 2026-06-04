import type { WorkspaceItemTransform } from "../workspace-utils";
import { formatN, rotatePoint } from "../workspace-utils";
import type { WorkspacePathData, WorkspaceSvgItem } from "../workspace-objects";

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
    const pathEl = document.createElementNS(ns, "path");
    pathEl.setAttribute("d", d);
    if (transform) pathEl.setAttribute("transform", transform);
    svg.appendChild(pathEl);
    document.body.appendChild(svg);
    const bbox = pathEl.getBBox();
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
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", path.d);
      if (path.pathTransform) el.setAttribute("transform", path.pathTransform);
      svg.appendChild(el);
      const bb = el.getBBox();
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
