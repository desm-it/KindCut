import { describe, expect, it } from "vitest";
import type { WorkspaceObject } from "./workspace-objects";
import { buildWorkspaceCutSvg } from "./workspace-objects";

const PIXELS_PER_INCH = 80;
const MAT_W = 4.5 * PIXELS_PER_INCH; // 360
const MAT_H = 12 * PIXELS_PER_INCH;  // 960

const obj: WorkspaceObject = {
  id: "a",
  type: "path",
  kind: "image",
  sourceKind: "image",
  fileName: "star",
  fileSize: "1 KB",
  sizeCopy: "40 × 40 px",
  frame: { width: 40, height: 40 },
  paths: [{ id: "p1", d: "M0 0H40V40Z", fill: "none", stroke: "#ff0000", strokeWidth: "1.5" }],
  transform: { x: 20, y: 30, scaleX: 1, scaleY: 1, rotation: 0 },
};

describe("buildWorkspaceCutSvg", () => {
  it("uses mat dimensions as the SVG canvas", () => {
    const svg = buildWorkspaceCutSvg([obj], MAT_W, MAT_H);
    expect(svg).toContain(`width="${MAT_W}"`);
    expect(svg).toContain(`height="${MAT_H}"`);
    expect(svg).toContain(`viewBox="0 0 ${MAT_W} ${MAT_H}"`);
  });

  it("places object at its workspace transform position", () => {
    const svg = buildWorkspaceCutSvg([obj], MAT_W, MAT_H);
    expect(svg).toContain("translate(20 30)");
  });

  it("includes the path data and stroke color", () => {
    const svg = buildWorkspaceCutSvg([obj], MAT_W, MAT_H);
    expect(svg).toContain(`d="M0 0H40V40Z"`);
    expect(svg).toContain(`stroke="#ff0000"`);
  });

  it("applies scale and rotation in the transform", () => {
    const scaled: WorkspaceObject = {
      ...obj,
      transform: { x: 10, y: 10, scaleX: 2, scaleY: 0.5, rotation: 45 },
    };
    const svg = buildWorkspaceCutSvg([scaled], MAT_W, MAT_H);
    expect(svg).toContain("translate(10 10) rotate(45) scale(2 0.5)");
  });

  it("includes all objects when multiple are provided", () => {
    const obj2: WorkspaceObject = {
      ...obj,
      id: "b",
      transform: { x: 100, y: 200, scaleX: 1, scaleY: 1, rotation: 0 },
      paths: [{ id: "p2", d: "M0 0H20", fill: "none", stroke: "#0000ff", strokeWidth: "2" }],
    };
    const svg = buildWorkspaceCutSvg([obj, obj2], MAT_W, MAT_H);
    expect(svg).toContain("translate(20 30)");
    expect(svg).toContain("translate(100 200)");
    expect(svg).toContain(`stroke="#ff0000"`);
    expect(svg).toContain(`stroke="#0000ff"`);
  });

  it("produces a valid SVG root element for empty input", () => {
    const svg = buildWorkspaceCutSvg([], MAT_W, MAT_H);
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg"`);
    expect(svg).toContain(`width="${MAT_W}"`);
  });

  it("includes pathTransform when present", () => {
    const grouped: WorkspaceObject = {
      ...obj,
      type: "group",
      paths: [
        { id: "p1", d: "M0 0H40", fill: "none", stroke: "#000", strokeWidth: "1", pathTransform: "translate(5 10)" },
      ] as WorkspaceObject["paths"],
    };
    const svg = buildWorkspaceCutSvg([grouped], MAT_W, MAT_H);
    expect(svg).toContain(`transform="translate(5 10)"`);
  });
});
