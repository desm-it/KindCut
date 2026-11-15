import { describe, expect, it } from "vitest";

import {
  WORKSPACE_SHAPE_KINDS,
  buildShapePath,
  buildWorkspaceShapePathObject,
  defaultShapeFrame,
  getWorkspaceShapePath,
  isWorkspaceShapeKind,
  shapeHasCorners,
} from "./workspace-shapes";

// Count "A" arc commands in a path.
function arcs(d: string): number {
  return (d.match(/A/g) ?? []).length;
}

describe("workspace shapes", () => {
  it("builds path objects for every built-in shape", () => {
    for (const shapeKind of WORKSPACE_SHAPE_KINDS) {
      const shape = buildWorkspaceShapePathObject(shapeKind);

      expect(shape.frame).toEqual({ width: 200, height: 200 });
      expect(shape.path.fill).toBe("none");
      expect(shape.path.stroke).toBe("#000000");
      expect(getWorkspaceShapePath(shapeKind)).toMatch(/^M /);
    }
  });

  it("recognizes only supported shape kinds", () => {
    expect(isWorkspaceShapeKind("circle")).toBe(true);
    expect(isWorkspaceShapeKind("rounded-square")).toBe(true);
    expect(isWorkspaceShapeKind("heart")).toBe(true);
    expect(isWorkspaceShapeKind("blob")).toBe(false);
    expect(isWorkspaceShapeKind(null)).toBe(false);
  });

  it("treats every shape except the circle as having corners", () => {
    expect(shapeHasCorners("circle")).toBe(false);
    expect(shapeHasCorners("square")).toBe(true);
    expect(shapeHasCorners("triangle")).toBe(true);
    expect(shapeHasCorners("star")).toBe(true);
  });

  it("line: runs through the middle of its box and has no corners to round", () => {
    expect(buildShapePath("line", 120, 14)).toBe("M 0 7 H 120");
    expect(shapeHasCorners("line")).toBe(false);
    expect(defaultShapeFrame("line")).toEqual({ width: 170, height: 14 });
    expect(defaultShapeFrame("star")).toEqual({ width: 170, height: 170 });
  });

  it("heart: fills its box exactly and is symmetric", () => {
    const d = buildShapePath("heart", 100, 80);
    const points = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 2);
    expect(Math.max(...xs)).toBeCloseTo(100, 2);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(80, 2);
    // The tip is at the bottom, in the middle.
    const tip = points.reduce((lowest, point) => (point.y > lowest.y ? point : lowest));
    expect(tip.x).toBeCloseTo(50, 1);
    expect(d.endsWith("Z")).toBe(true);
    expect(shapeHasCorners("heart")).toBe(false);
  });

  it("rectangle: radius 0 has sharp corners, radius > 0 adds corner arcs", () => {
    expect(arcs(buildShapePath("square", 100, 100, 0))).toBe(0);
    expect(arcs(buildShapePath("square", 100, 100, 20))).toBe(4); // four rounded corners
  });

  it("rectangle: corner radius is clamped so corners never overlap", () => {
    // Huge radius on a 100×60 box clamps to 30 (half the short side) → no NaN/overflow.
    const d = buildShapePath("square", 100, 60, 999);
    expect(d).toMatch(/^M /);
    expect(d).not.toMatch(/NaN/);
    expect(arcs(d)).toBe(4);
  });

  it("rectangle: corner arcs counter the scale so they render circular", () => {
    // Stretching x by 2 should make the frame-space corner wider than it is tall
    // (rx > ry) so that the <g> scale turns it back into a circle.
    const d = buildShapePath("square", 100, 100, 20, 2, 1);
    const firstArc = d.match(/A ([\d.]+) ([\d.]+)/);
    expect(firstArc).not.toBeNull();
    const rx = Number(firstArc![1]);
    const ry = Number(firstArc![2]);
    expect(rx).toBeLessThan(ry);
  });

  it("polygon: radius rounds vertices with quadratic corners", () => {
    expect(buildShapePath("triangle", 100, 100, 0)).not.toMatch(/Q/);
    expect(buildShapePath("triangle", 100, 100, 15)).toMatch(/Q/);
  });
});
