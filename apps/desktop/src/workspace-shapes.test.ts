import { describe, expect, it } from "vitest";

import {
  WORKSPACE_SHAPE_KINDS,
  buildWorkspaceShapePathObject,
  getWorkspaceShapePath,
  isWorkspaceShapeKind,
} from "./workspace-shapes";

describe("workspace shapes", () => {
  it("builds path objects for every built-in shape", () => {
    for (const shapeKind of WORKSPACE_SHAPE_KINDS) {
      const shape = buildWorkspaceShapePathObject(shapeKind);

      expect(shape.frame).toEqual({ width: 200, height: 200 });
      expect(shape.path.fill).toBe("none");
      expect(shape.path.stroke).toBe("#8f4f2b");
      expect(getWorkspaceShapePath(shapeKind)).toMatch(/^M /);
    }
  });

  it("recognizes only supported shape kinds", () => {
    expect(isWorkspaceShapeKind("circle")).toBe(true);
    expect(isWorkspaceShapeKind("rounded-square")).toBe(true);
    expect(isWorkspaceShapeKind("heart")).toBe(false);
    expect(isWorkspaceShapeKind(null)).toBe(false);
  });
});
