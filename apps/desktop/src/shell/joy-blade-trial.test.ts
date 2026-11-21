import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLADE_TRIAL_ID, requireBladeTrial } from './joy-blade-trial';
import policy from './joy-blade-trial-policy.json';

const runtimePolicy = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/joy-runtime/runtime/profiles/first-cut-trial.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const pt = (20 * 72) / 25.4;
const square = (x = 40, y = 50, reverse = false, explicitClose = false) => {
  const corners = [
    [x, y],
    [x + pt, y],
    [x + pt, y + pt],
    [x, y + pt],
  ];
  if (reverse) corners.reverse();
  const points = corners.slice(1);
  const steps = [
    { op: 'M', points: [{ x: corners[0]![0], y: corners[0]![1] }] },
    ...points.map(([a, b]) => ({ op: 'L', points: [{ x: a!, y: b! }] })),
  ];
  if (explicitClose) steps.push({ op: 'L', points: [{ x: corners[0]![0], y: corners[0]![1] }] });
  else steps.push({ op: 'Z', points: [] });
  return {
    schemaVersion: 2,
    machine: 'cricut_joy',
    coordinateFrame: 'kindcut_canvas_pt72_v1',
    unit: 'pt72',
    execution: 'unsupported',
    material: { widthIn: 4.5, heightIn: 12, id: 211 },
    mat: { widthIn: 4.5, heightIn: 12 },
    groups: [{ tool: 'fine_point_blade', operation: 'cut', paths: [{ id: 'square', steps }] }],
    bounds: { minX: x, minY: y, maxX: x + pt, maxY: y + pt },
    clipping: { policy: 'reject', clippedPathIds: [], omittedPathIds: [] },
  };
};
const settings = structuredClone(policy.settings);

describe('restricted blade trial admission', () => {
  it('exports the policy id and keeps the host policy byte-identical to runtime policy', () => {
    expect(BLADE_TRIAL_ID).toBe('joy-20mm-square-v1');
    expect(JSON.stringify(policy)).toBe(JSON.stringify(runtimePolicy));
  });
  it('accepts a clockwise or counterclockwise square starting at any corner and explicit closing L', () => {
    for (const p of [square(), square(40, 50, true), square(40, 50, false, true)])
      expect(() => requireBladeTrial(p, settings, [223, 223, 223])).not.toThrow();
  });
  it('preserves source settings and rejects altered policy, geometry and bounds before admission', () => {
    expect(() =>
      requireBladeTrial(square(), { ...settings, pressureRequest: 222 }, [223, 223, 223]),
    ).toThrow();
    expect(() =>
      requireBladeTrial(
        { ...square(), bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 } },
        settings,
        [223, 223, 223],
      ),
    ).toThrow();
    expect(() =>
      requireBladeTrial(
        {
          ...square(),
          clipping: { policy: 'clip', clippedPathIds: ['square'], omittedPathIds: [] },
        },
        settings,
        [223, 223, 223],
      ),
    ).toThrow();
    expect(() => requireBladeTrial(square(10, 10), settings, [223, 223, 223])).toThrow();
    expect(() => requireBladeTrial(square(), settings, [223, 223])).toThrow();
  });
  it('rejects malformed, multiple, cubic, subpath, boolean, and non-finite geometry', () => {
    const base = square();
    const alter = (f: (p: any) => void) => {
      const p = structuredClone(base);
      f(p);
      expect(() => requireBladeTrial(p, settings, [223, 223, 223])).toThrow();
    };
    alter((p) => p.groups[0].paths[0].steps.push({ op: 'M', points: [{ x: 0, y: 0 }] }));
    alter((p) => (p.groups[0].paths[0].steps[1].op = 'C'));
    alter((p) => p.groups.push({ tool: 'pen', operation: 'draw', paths: [] }));
    alter((p) => (p.groups[0].paths[0].steps[1].points[0].x = NaN));
    alter((p) => (p.groups[0].paths[0].steps[1].points[0].x = true));
  });
});

it('rejects crossed corner order and coerced numeric fields, accepts reordered preset keys', () => {
  const p = square();
  [p.groups[0]!.paths[0]!.steps[1], p.groups[0]!.paths[0]!.steps[2]] = [
    p.groups[0]!.paths[0]!.steps[2]!,
    p.groups[0]!.paths[0]!.steps[1]!,
  ];
  expect(() => requireBladeTrial(p, settings, [223, 223, 223])).toThrow();
  const bad = square();
  (bad.mat as any).widthIn = '4.5';
  expect(() => requireBladeTrial(bad, settings, [223, 223, 223])).toThrow();
  const reorder = Object.fromEntries(Object.entries(settings).reverse());
  expect(() => requireBladeTrial(square(), reorder, [223, 223, 223])).not.toThrow();
});

it('rejects unknown keys at every canonical plan level before admission', () => {
  for (const pick of [
    (p: any) => p,
    (p: any) => p.material,
    (p: any) => p.mat,
    (p: any) => p.bounds,
    (p: any) => p.clipping,
    (p: any) => p.groups[0],
    (p: any) => p.groups[0].paths[0],
    (p: any) => p.groups[0].paths[0].steps[0],
    (p: any) => p.groups[0].paths[0].steps[0].points[0],
  ]) {
    const p = square();
    pick(p).unreviewed = true;
    expect(() => requireBladeTrial(p, settings, [223, 223, 223])).toThrow();
  }
});
