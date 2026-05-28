import { describe, expect, it } from "vitest";

import {
  WORKSPACE_SHAPE_KINDS,
  buildWorkspaceShapeSvg,
  getWorkspaceShapePath,
  isWorkspaceShapeKind,
} from "./workspace-shapes";

describe("workspace shapes", () => {
  it("builds Cricut-friendly path SVGs for every built-in shape", () => {
    for (const shapeKind of WORKSPACE_SHAPE_KINDS) {
      const svg = buildWorkspaceShapeSvg(shapeKind);

      expect(svg).toContain('width="2in"');
      expect(svg).toContain('height="2in"');
      expect(svg).toContain("<path");
      expect(svg).toContain('fill="none"');
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
