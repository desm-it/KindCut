import { describe, expect, it } from "vitest";
import { compileNativeJoyPlan } from "./native-joy-plan.js";

const base = {
  widthPx: 96, heightPx: 96, viewBox: { minX: 0, minY: 0, width: 96, height: 96 },
  mat: { widthIn: 4.5, heightIn: 6 }, materialId: 1,
  paths: [{ id: "p", d: "M3 6 C10 12 20 30 30 40 Z", tool: "fine_point_blade" as const, operation: "cut" as const }],
};

describe("compileNativeJoyPlan", () => {
  it("preserves normalized line/cubic commands in 72 pt units with source origin", () => {
    const plan = compileNativeJoyPlan(base);
    expect(plan.execution).toBe("unsupported");
    expect(plan.groups[0]?.paths[0]?.steps).toEqual([
      { op: "M", points: [{ x: 2.25, y: 4.5 }] },
      { op: "C", points: [{ x: 7.5, y: 9 }, { x: 15, y: 22.5 }, { x: 22.5, y: 30 }] },
      { op: "Z", points: [] },
    ]);
    expect(plan.bounds).toEqual({ minX: 2.25, minY: 4.5, maxX: 22.5, maxY: 30 });
  });
  it("applies ancestor transforms and calibration, groups in explicit order", () => {
    const input = { ...base, paths: [
      { id: "cut", d: "M0 0 L1 1", transforms: [[1,0,0,1,1,0] as [number,number,number,number,number,number]], tool: "fine_point_blade" as const, operation: "cut" as const },
      { id: "pen", d: "M0 0 L1 1", tool: "pen" as const, operation: "draw" as const, color: "#AABBCC" },
    ], calibration: { pen: { xPt: 2, yPt: 3 } }, toolOrder: ["pen", "fine_point_blade"] as const };
    const plan = compileNativeJoyPlan(input);
    expect(plan.groups.map(g => g.tool)).toEqual(["pen", "fine_point_blade"]);
    expect(plan.groups[0]?.paths[0]?.color).toBe("#aabbcc");
    expect(plan.groups[0]?.paths[0]?.steps[0]?.points[0]).toEqual({ x: 2, y: 3 });
  });
  it("rejects malformed or unsupported path syntax instead of truncating", () => {
    for (const d of ["M0 0 L1", "M0 0 Q1 2 3 4", "M0 0 L1 1 junk", "M0 0 L1e999 1", "M0 0 Z L1 1"]) {
      expect(() => compileNativeJoyPlan({ ...base, paths: [{ ...base.paths[0]!, d }] })).toThrow();
    }
  });
  it("rejects points beyond printable/material bounds including curve controls", () => {
    expect(() => compileNativeJoyPlan({ ...base, boundsPolicy: "reject", paths: [{ ...base.paths[0]!, d: "M0 0 C0 0 0 0 500 0" }] })).toThrow(/bounds/i);
  });
  it("rejects invalid mappings and empty geometry", () => {
    expect(() => compileNativeJoyPlan({ ...base, preserveAspectRatio: "xMidYMid meet" })).toThrow();
    expect(() => compileNativeJoyPlan({ ...base, paths: [{ ...base.paths[0]!, d: "M0 0" }] })).toThrow();
  });
});
