import { describe, expect, it } from "vitest";
import { extractWorkspacePathsFromSvg } from "./workspace-svg-import";

describe("workspace SVG path extraction", () => {
  it("extracts one path", () => {
    const extracted = extractWorkspacePathsFromSvg('<svg viewBox="0 0 20 10"><path d="M0 0L10 10" stroke="#000"/></svg>');

    expect(extracted.frame).toEqual({ width: 20, height: 10 });
    expect(extracted.paths).toHaveLength(1);
    expect(extracted.paths[0]).toMatchObject({ d: "M0 0L10 10", stroke: "#000000" });
  });

  it("extracts multiple paths for grouped import", () => {
    const extracted = extractWorkspacePathsFromSvg('<svg viewBox="0 0 20 20"><path d="M0 0H10"/><path d="M0 10H10"/></svg>');

    expect(extracted.paths.map((path) => path.d)).toEqual(["M0 0H10", "M0 10H10"]);
  });

  it("converts basic shapes to path data", () => {
    const extracted = extractWorkspacePathsFromSvg(`
      <svg viewBox="0 0 100 100">
        <rect x="10" y="10" width="20" height="30"/>
        <circle cx="50" cy="50" r="10"/>
        <polygon points="70,10 90,30 70,30"/>
      </svg>
    `);

    expect(extracted.paths).toHaveLength(3);
    expect(extracted.paths[0]?.d).toBe("M 10 10 H 30 V 40 H 10 Z");
    expect(extracted.paths[1]?.d).toContain("A 10 10");
    expect(extracted.paths[2]?.d).toBe("M 70 10 L 90 30 L 70 30 Z");
  });

  it("drops obvious white background rectangles", () => {
    const extracted = extractWorkspacePathsFromSvg(`
      <svg viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#fff"/>
        <path d="M10 10H90"/>
      </svg>
    `);

    expect(extracted.paths).toHaveLength(1);
    expect(extracted.paths[0]?.d).toBe("M10 10H90");
  });

  it("preserves inherited group transforms", () => {
    const extracted = extractWorkspacePathsFromSvg('<svg viewBox="0 0 20 20"><g transform="translate(5 6)"><path d="M0 0H10"/></g></svg>');

    expect(extracted.paths[0]?.pathTransform).toBe("translate(5 6)");
  });
});
