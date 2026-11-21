import { describe, expect, it } from 'vitest';
import { clipJoyPath, type JoyPathStep } from './joy-path-clip';
import { compileNativeJoyPlan, type NativeJoyPlanInput } from './native-joy-plan';
const rect = { minX: 0, minY: 0, maxX: 72, maxY: 72 };
const m = (x: number, y: number): JoyPathStep => ({ op: 'M', points: [{ x, y }] });
const l = (x: number, y: number): JoyPathStep => ({ op: 'L', points: [{ x, y }] });
const z = (): JoyPathStep => ({ op: 'Z', points: [] });
const c = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): JoyPathStep => ({
  op: 'C',
  points: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
    { x: x3, y: y3 },
  ],
});
function pointAt(ps: { x: number; y: number }[], t: number) {
  const q = ps.map((p) => ({ ...p }));
  for (let n = q.length - 1; n > 0; n--)
    for (let i = 0; i < n; i++)
      q[i] = { x: q[i]!.x * (1 - t) + q[i + 1]!.x * t, y: q[i]!.y * (1 - t) + q[i + 1]!.y * t };
  return q[0]!;
}
function samples(steps: JoyPathStep[]) {
  let p = { x: 0, y: 0 },
    start = p;
  const out = [];
  for (const s of steps) {
    if (s.op === 'M') {
      p = s.points[0]!;
      start = p;
    } else if (s.op === 'C') {
      for (let n = 0; n <= 100; n++) out.push(pointAt([p, ...s.points], n / 100));
      p = s.points[2]!;
    } else if (s.op === 'L') {
      out.push(p, s.points[0]!);
      p = s.points[0]!;
    } else {
      out.push(p, start);
      p = start;
    }
  }
  return out;
}
function assertInside(steps: JoyPathStep[]) {
  for (const p of samples(steps)) {
    expect(p.x).toBeGreaterThanOrEqual(-1e-8);
    expect(p.x).toBeLessThanOrEqual(72 + 1e-8);
    expect(p.y).toBeGreaterThanOrEqual(-1e-8);
    expect(p.y).toBeLessThanOrEqual(72 + 1e-8);
  }
}
function input(d: string): NativeJoyPlanInput {
  return {
    widthPx: 96,
    heightPx: 96,
    viewBox: { minX: 0, minY: 0, width: 96, height: 96 },
    mat: { widthIn: 4.5, heightIn: 12 },
    materialId: 218,
    paths: [{ id: 'art', tool: 'pen', operation: 'draw', color: '#112233', d }],
  };
}

describe('Joy rectangular centerline clipping', () => {
  it('clips a crossing line at its intersections, not by clamping the endpoints independently', () => {
    const r = clipJoyPath([m(-36, 0), l(108, 72)], rect);
    expect(r.steps).toEqual([m(0, 18), l(72, 54)]);
    expect(r.clipped).toBe(true);
    expect(r.bounds).toEqual({ minX: 0, minY: 18, maxX: 72, maxY: 54 });
  });
  it('keeps an inside open path and intact closure unchanged', () => {
    for (const steps of [
      [m(2, 2), l(20, 20)],
      [m(2, 2), l(20, 2), l(20, 20), z()],
    ]) {
      const before = JSON.stringify(steps);
      const r = clipJoyPath(steps, rect);
      expect(r.steps).toEqual(steps);
      expect(r.clipped).toBe(false);
      expect(JSON.stringify(steps)).toBe(before);
    }
  });
  it('drops fully exterior segments without creating border lines', () => {
    const r = clipJoyPath([m(-20, 10), l(-10, 20)], rect);
    expect(r.steps).toEqual([]);
    expect(r.bounds).toBe(null);
    expect(r.clipped).toBe(true);
  });
  it('lifts on reentry instead of bridging discarded portions', () => {
    const r = clipJoyPath([m(10, 10), l(100, 10), l(100, 60), l(10, 60)], rect);
    expect(r.steps).toEqual([m(10, 10), l(72, 10), m(72, 60), l(10, 60)]);
    assertInside(r.steps);
  });
  it('clips the original closing segment but never adds a synthetic clipping-border closure', () => {
    const r = clipJoyPath([m(-10, 10), l(10, 10), l(10, 30), z()], rect);
    expect(r.steps).toEqual([m(0, 10), l(10, 10), l(10, 30), l(0, 20)]);
    expect(r.steps.some((s) => s.op === 'Z')).toBe(false);
  });
  it('retains an inside cubic exactly', () => {
    const steps = [m(0, 0), c(24, 0, 48, 72, 72, 72)];
    const r = clipJoyPath(steps, rect);
    expect(r.steps).toEqual(steps);
    expect(r.clipped).toBe(false);
    assertInside(r.steps);
  });
  it('does not clip an inside curve just because its control polygon extends outside', () => {
    const steps = [m(10, 36), c(-10, 36, 82, 36, 62, 36)];
    const r = clipJoyPath(steps, rect);
    expect(r.steps).toEqual(steps);
    expect(r.clipped).toBe(false);
    assertInside(r.steps);
  });
  it('splits a crossing cubic at the rectangle and preserves cubic segments', () => {
    const steps = [m(-36, 36), c(12, 36, 60, 36, 108, 36)];
    const r = clipJoyPath(steps, rect);
    expect(r.steps[0]!.points[0]!.x).toBeCloseTo(0, 8);
    expect(r.steps.at(-1)!.points.at(-1)!.x).toBeCloseTo(72, 8);
    expect(r.steps.filter((s) => s.op === 'C')).toHaveLength(1);
    expect(r.clipped).toBe(true);
    assertInside(r.steps);
    const segment = r.steps[1]!.points;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const expected = pointAt([steps[0]!.points[0]!, ...steps[1]!.points], 0.25 + 0.5 * t),
        actual = pointAt([r.steps[0]!.points[0]!, ...segment], t);
      expect(actual.x).toBeCloseTo(expected.x, 7);
      expect(actual.y).toBeCloseTo(expected.y, 7);
    }
  });
  it('finds multiple cubic exit/reentry intervals without joining the gap', () => {
    const r = clipJoyPath([m(10, 36), c(300, 36, -200, 36, 62, 36)], rect);
    assertInside(r.steps);
    expect(r.clipped).toBe(true);
    expect(r.steps.filter((s) => s.op === 'M').length).toBeGreaterThan(1);
  });
  it('keeps separate subpaths separate', () => {
    expect(
      clipJoyPath([m(1, 1), l(2, 2), m(2, 2), l(3, 3)], rect).steps.filter((s) => s.op === 'M'),
    ).toHaveLength(2);
  });
  it('handles a boundary line and drops a point-only corner contact', () => {
    expect(clipJoyPath([m(0, -10), l(0, 80)], rect).steps).toEqual([m(0, 0), l(0, 72)]);
    expect(clipJoyPath([m(-10, 10), l(10, -10)], rect).steps).toEqual([]);
  });
  it('keeps an exact interior tangent cubic intact', () => {
    const steps = [m(0, 3), c(24, -1, 48, -1, 72, 3)];
    const r = clipJoyPath(steps, rect);
    expect(r.steps).toEqual(steps);
    expect(r.clipped).toBe(false);
    expect(r.bounds!.minY).toBeCloseTo(0, 10);
    assertInside(r.steps);
  });
  it('does not turn a single exterior tangency into a drawable dot', () => {
    const r = clipJoyPath([m(0, -3), c(24, 1, 48, 1, 72, -3)], rect);
    expect(r.steps).toEqual([]);
    expect(r.bounds).toBe(null);
    expect(r.clipped).toBe(true);
  });
  it('preserves separate fragments around a narrow near-tangent excursion', () => {
    const delta = 2e-10,
      steps = [m(0, 3 - delta), c(24, -1 - delta, 48, -1 - delta, 72, 3 - delta)];
    const r = clipJoyPath(steps, rect);
    const moves = r.steps.filter((s) => s.op === 'M');
    const curves = r.steps.filter((s) => s.op === 'C');
    expect(moves).toHaveLength(2);
    expect(curves).toHaveLength(2);
    expect(r.clipped).toBe(true);
    assertInside(r.steps);
    const dt = Math.sqrt(delta / 12);
    expect(curves[0]!.points[2]!.x).toBeCloseTo(72 * (0.5 - dt), 5);
    expect(moves[1]!.points[0]!.x).toBeCloseTo(72 * (0.5 + dt), 5);
    expect(moves[1]!.points[0]!.x).toBeGreaterThan(curves[0]!.points[2]!.x);
  });
  it('retains a narrow inside fragment of a nearly exterior tangent', () => {
    const delta = 2e-10,
      r = clipJoyPath([m(0, -3 + delta), c(24, 1 + delta, 48, 1 + delta, 72, -3 + delta)], rect);
    expect(r.steps.map((s) => s.op)).toEqual(['M', 'C']);
    expect(r.clipped).toBe(true);
    assertInside(r.steps);
    expect(r.steps[1]!.points[2]!.x).toBeGreaterThan(r.steps[0]!.points[0]!.x);
    const middle = pointAt([r.steps[0]!.points[0]!, ...r.steps[1]!.points], 0.5);
    expect(middle.y).toBeGreaterThan(0);
    expect(middle.y).toBeCloseTo(delta, 10);
  });
  it('rejects nonfinite coordinates and invalid rectangles', () => {
    expect(() => clipJoyPath([m(0, 0), l(Infinity, 0)], rect)).toThrow();
    expect(() => clipJoyPath([m(0, 0), l(1, 1)], { ...rect, maxX: NaN })).toThrow();
  });
});
describe('Joy planner clipping policy', () => {
  it('clips geometry by default after transforms and calibration', () => {
    const i = input('M -48 0 L 144 96');
    const p = compileNativeJoyPlan(i);
    expect(p.groups[0]!.paths[0]!.steps).toEqual([m(0, 18), l(72, 54)]);
    expect((p as any).clipping).toMatchObject({
      policy: 'clip',
      clippedPathIds: ['art'],
      omittedPathIds: [],
    });
    const j = input('M 0 10 L 96 10');
    j.calibration = { pen: { xPt: 1, yPt: 0 } };
    const q = compileNativeJoyPlan(j);
    expect(q.bounds.maxX).toBe(72);
    expect(q.execution).toBe('unsupported');
  });
  it('keeps explicit reject mode for callers requiring original conservative bounds', () => {
    expect(() =>
      compileNativeJoyPlan({ ...input('M -1 0 L 10 10'), boundsPolicy: 'reject' } as any),
    ).toThrow(/bounds/i);
    expect(() =>
      compileNativeJoyPlan({ ...input('M 1 1 L 10 10'), boundsPolicy: 'anything' } as any),
    ).toThrow();
  });
  it('reports omitted paths and refuses a job with no surviving drawing geometry', () => {
    const i = input('M 0 0 L 10 10');
    i.paths = [...i.paths, { ...i.paths[0]!, id: 'outside', d: 'M -20 0 L -10 10' }];
    const p = compileNativeJoyPlan(i);
    expect((p as any).clipping.omittedPathIds).toEqual(['outside']);
    expect(p.groups[0]!.paths).toHaveLength(1);
    expect(() => compileNativeJoyPlan(input('M -20 0 L -10 10'))).toThrow(
      /no.*geometry|nothing.*inside/i,
    );
  });
});
