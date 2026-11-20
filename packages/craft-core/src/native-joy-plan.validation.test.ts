import { describe, expect, it } from "vitest";
import { compileNativeJoyPlan, type NativeJoyPlanInput } from "./native-joy-plan";

function input(): NativeJoyPlanInput {
  return { widthPx: 96, heightPx: 96, viewBox: { minX: 0, minY: 0, width: 96, height: 96 },
    mat: { widthIn: 4.5, heightIn: 12 }, materialId: 218,
    paths: [{ id: "a", d: "M 10 10 L 20 20", tool: "pen", operation: "draw", color: "#112233" }] };
}

describe("native Joy planning boundary", () => {
  it("compiles the exact unit-square geometry and retains a planning-only marker", () => {
    const i = input(); i.paths = [{ ...i.paths[0]!, d: "M 0 0 L 96 0 C 96 0 96 96 0 96 Z" }];
    const plan = compileNativeJoyPlan(i);
    expect(plan.material).toEqual({ widthIn: 1, heightIn: 1, id: 218 });
    expect(plan.bounds).toEqual({ minX: 0, minY: 0, maxX: 72, maxY: 72 });
    expect(plan.execution).toBe("unsupported");
    expect(plan.groups[0]!.paths[0]!.steps[2]!.points).toEqual([{ x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }]);
  });
  it("applies noncommuting ancestor matrices before local matrices", () => {
    const i = input(); i.paths = [{ ...i.paths[0]!, transforms: [[2,0,0,2,0,0],[1,0,0,1,4,8]] }];
    expect(compileNativeJoyPlan(i).groups[0]!.paths[0]!.steps[0]!.points[0]).toEqual({ x: 21, y: 27 });
  });
  it("keeps stable path order and supports explicit reverse tool order", () => {
    const i = input(); i.paths = [i.paths[0]!, { ...i.paths[0]!, id: "blade", tool: "fine_point_blade", operation: "cut" }, { ...i.paths[0]!, id: "pen2" }];
    i.toolOrder = ["fine_point_blade", "pen"];
    const plan = compileNativeJoyPlan(i);
    expect(plan.groups.map(g => g.tool)).toEqual(["fine_point_blade", "pen"]);
    expect(plan.groups[1]!.paths.map(p => p.id)).toEqual(["a", "pen2"]);
  });
  it("does not retain input references or mutate frozen inputs", () => {
    const i = input(); Object.freeze(i.mat); Object.freeze(i.viewBox); Object.freeze(i.paths[0]); Object.freeze(i.paths); Object.freeze(i);
    const before = JSON.stringify(i); const plan = compileNativeJoyPlan(i); plan.mat.widthIn = 1; plan.groups[0]!.paths[0]!.steps[0]!.points[0]!.x = 1;
    expect(JSON.stringify(i)).toBe(before);
  });
  it.each([
    { widthPx: NaN }, { widthPx: Infinity }, { widthPx: 0 }, { heightPx: -1 },
    { materialId: 0 }, { materialId: 1.5 }, { materialId: Number.MAX_SAFE_INTEGER + 1 },
    { mat: { widthIn: 4.6, heightIn: 12 } }, { mat: { widthIn: 4.5, heightIn: 13 } },
    { viewBox: { minX: 0, minY: 0, width: 0, height: 96 } },
    { paths: [] }, { toolOrder: ["pen", "pen"] }, { toolOrder: null },
    { calibration: null }, { calibration: { pen: null } }, { calibration: { pen: false } },
    { calibration: { pen: { xPt: NaN, yPt: 0 } } },
    { calibration: { fine_point_blade: { xPt: Infinity, yPt: 0 } } },
    { calibration: { unknown: { xPt: 0, yPt: 0 } } },
  ])("rejects malformed runtime options: %j", partial => {
    expect(() => compileNativeJoyPlan({ ...input(), ...partial } as NativeJoyPlanInput)).toThrow();
  });
  it.each([
    { transforms: null }, { transforms: [[1,0,0,0,0,0]] }, { transforms: [[1,0,0,1,Infinity,0]] },
    { transforms: [[1,0,0,1,0]] }, { transforms: "not-a-matrix" },
    { tool: "scoring_stylus" }, { operation: "cut" }, { color: "red" }, { id: " " },
  ])("rejects malformed path metadata: %j", partial => {
    const i = input(); i.paths = [{ ...i.paths[0]!, ...partial } as any]; expect(() => compileNativeJoyPlan(i)).toThrow();
  });
  it.each(["M 0 0 L 1", "M 0 0 C 1 1 2 2", "L 1 1", "M 0 0", "M 0 0 Z", "M 0 0 L NaN 1", "M 0 0 L 1e999 1", "M 0 0 L 1 1 trailing", "M 0 0 Q 1 1 2 2", "m 0 0 l 1 1", "M 0 0 L 1 1 Z L 2 2"])("rejects malformed/unsupported path data: %s", d => {
    const i = input(); i.paths = [{ ...i.paths[0]!, d }]; expect(() => compileNativeJoyPlan(i)).toThrow();
  });
  it("checks all cubic control points and all post-calibration points", () => {
    const i = input(); i.boundsPolicy = "reject"; i.paths = [{ ...i.paths[0]!, d: "M 10 10 C -1 10 20 20 30 30" }]; expect(() => compileNativeJoyPlan(i)).toThrow(/bounds/i);
    const j = input(); j.boundsPolicy = "reject"; j.calibration = { pen: { xPt: -8, yPt: 0 } }; expect(() => compileNativeJoyPlan(j)).toThrow(/bounds/i);
  });
  it("rejects duplicate IDs and excessive path/point/transform budgets", () => {
    const i = input(); expect(() => compileNativeJoyPlan({ ...i, paths: [i.paths[0]!, i.paths[0]!] })).toThrow();
    expect(() => compileNativeJoyPlan({ ...i, paths: Array.from({length: 1001}, (_, n) => ({...i.paths[0]!,id:String(n)})) })).toThrow();
    expect(() => compileNativeJoyPlan({ ...i, paths: [{ ...i.paths[0]!, transforms: Array.from({length: 65}, () => [1,0,0,1,0,0] as [number,number,number,number,number,number]) }] })).toThrow();
    const d = "M 1 1 " + "L 2 2 ".repeat(20000); expect(() => compileNativeJoyPlan({ ...i, paths: [{...i.paths[0]!,d}] })).toThrow();
  });
});
