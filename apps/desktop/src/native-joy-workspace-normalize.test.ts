import { buildShapePath, getWorkspaceShapePath, WORKSPACE_SHAPE_KINDS } from './workspace-shapes';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceCutSvg, type WorkspaceObject } from './workspace-objects';
import {
  normalizeWorkspaceSvgForJoy,
  normalizeWorkspaceSvgForJoyPreview,
} from './native-joy-workspace-normalize';
import { compileNormalizedSvgForJoy } from '@cricut-companion/svg-preflight';

const mat = { widthIn: 4.5, heightIn: 12 };
const options = {
  mat,
  materialId: 1,
  strokeTools: {
    '#ff0000': { tool: 'pen' as const, operation: 'draw' as const },
    '#000000': { tool: 'fine_point_blade' as const, operation: 'cut' as const },
  },
};
const object: WorkspaceObject = {
  id: 'test',
  type: 'path',
  kind: 'shape',
  sourceKind: 'shape',
  fileName: 'test',
  fileSize: '1KB',
  sizeCopy: '40px',
  frame: { width: 40, height: 40 },
  paths: [{ id: 'p', d: 'M0 0 H40 V40 Z', fill: 'none', stroke: '#ff0000', strokeWidth: '1.5' }],
  transform: { x: 80, y: 80, scaleX: 1, scaleY: 1, rotation: 0 },
};
const svg = (body: string, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="4.5in" height="12in" viewBox="0 0 360 960" ${attrs}>${body}</svg>`;
const path = (d: string, fill = 'none') => `<path fill="${fill}" stroke="#ff0000" d="${d}"/>`;
const plan = (s: string) =>
  compileNormalizedSvgForJoy(normalizeWorkspaceSvgForJoy(s, mat), options);
describe('workspace SVG adapter', () => {
  it('compiles a NONEMPTY real workspace builder and preserves 80dpi to pt72 geometry', () => {
    const input = buildWorkspaceCutSvg(
      [object],
      360,
      960,
      [{ color: '#ff0000', type: 'pen' }],
      80,
      '',
      { x: 0, y: 0, width: 360, height: 960 },
    );
    expect(() => compileNormalizedSvgForJoy(input, options)).toThrow();
    const result = plan(input);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.paths[0]!.steps[0]!.points).toEqual([{ x: 72, y: 72 }]);
    expect(result.groups[0]!.paths[0]!.steps[1]!.points).toEqual([{ x: 108, y: 72 }]);
  });
  it('composes nested transform lists in SVG order, including centered rotations', () => {
    const p = plan(
      svg(
        `<g transform="translate(80 80) rotate(90) scale(2 1)"><g transform="translate(5 0)">${path('M0 0 L10 0')}</g></g>`,
      ),
    );
    expect(p.groups[0]!.paths[0]!.steps[0]!.points[0]!.x).toBeCloseTo(72);
    expect(p.groups[0]!.paths[0]!.steps[0]!.points[0]!.y).toBeCloseTo(81);
    expect(p.groups[0]!.paths[0]!.steps[1]!.points[0]!.y).toBeCloseTo(99);
    const q = plan(svg(`<g transform="rotate(90 80 80)">${path('M80 80 L90 80')}</g>`));
    expect(q.groups[0]!.paths[0]!.steps[1]!.points[0]!.y).toBeCloseTo(81);
  });
  it('preserves relative cubic controls, repeated moves and disjoint subpaths', () => {
    const p = plan(svg(path('m80 80 c10 0 10 10 20 10 m20 0 l10 0 ')));
    expect(p.groups[0]!.paths[0]!.steps[1]!.op).toBe('C');
    expect(p.groups[0]!.paths[0]!.steps[1]!.points).toEqual([
      { x: 81, y: 72 },
      { x: 81, y: 81 },
      { x: 90, y: 81 },
    ]);
    expect(p.groups[0]!.paths[0]!.steps[2]).toEqual({ op: 'M', points: [{ x: 108, y: 81 }] });
    expect(p.groups[0]!.paths[0]!.steps[3]).toEqual({ op: 'L', points: [{ x: 117, y: 81 }] });
  });
  it('adapts a real filled blade polygon, without making up fill unions', () => {
    const blade: WorkspaceObject = {
      ...object,
      paths: [{ ...object.paths[0]!, stroke: '#000000', fill: '#000000' }],
    };
    const input = buildWorkspaceCutSvg(
      [blade],
      360,
      960,
      [{ color: '#000000', type: 'cut' }],
      80,
      '',
      { x: 0, y: 0, width: 360, height: 960 },
    );
    const p = compileNormalizedSvgForJoy(normalizeWorkspaceSvgForJoyPreview(input, mat), options);
    expect(p.groups[0]!.tool).toBe('fine_point_blade');
    expect(p.groups[0]!.paths).toHaveLength(1);
  });
  it.each([
    'M0 0 L20 20 L0 20 L20 0 Z',
    'M0 0 L20 0 Z',
    'M0 0 L20 0 L20 20 Z M4 4 L8 4 L8 8 Z',
    'M0 0 C1 1 2 2 3 0 Z',
  ])('rejects non-simple or curved filled paths: %s', (d) =>
    expect(() => plan(svg(path(d, '#ff0000')))).toThrow(/filled/i),
  );
  it.each([
    ['<image/>', ''],
    [path('M0 0 A3 3 0 2 1 5 5'), ''],
    [path('L0 0 L1 1'), ''],
    [path('M0 0 L1e999 1'), ''],
    [path('M0 0 L1 1'), 'transform="translate(9)"'],
    [path('M0 0 L1 1'), 'style="display:none"'],
    [`<g transform="scale(1,,2)">${path('M0 0 L1 1')}</g>`, ''],
  ])('rejects unsupported/malformed geometry instead of dropping it', (body, attrs) =>
    expect(() => plan(svg(body, attrs))).toThrow(),
  );
});

describe('built-in workspace curves', () => {
  it.each(WORKSPACE_SHAPE_KINDS)(
    'compiles the actual %s shape builder without discarding a path',
    (kind) => {
      const shape: WorkspaceObject = {
        ...object,
        paths: [
          {
            ...object.paths[0]!,
            d: buildShapePath(kind, 40, 40, kind === 'rounded-square' ? 8 : 0),
          },
        ],
      };
      const raw = buildWorkspaceCutSvg(
        [shape],
        360,
        960,
        [{ color: '#ff0000', type: 'pen' }],
        80,
        '',
        { x: 0, y: 0, width: 360, height: 960 },
      );
      const p = plan(raw);
      expect(p.groups[0]!.paths).toHaveLength(1);
      expect(p.groups[0]!.paths[0]!.steps.length).toBeGreaterThan(1);
    },
  );
  it.each(['circle', 'rounded-square'] as const)(
    'also accepts imported built-in %s presets',
    (kind) => {
      expect(plan(svg(path(getWorkspaceShapePath(kind)))).groups[0]!.paths).toHaveLength(1);
    },
  );
  it('preserves quadratic geometry as exact cubics and reflects smooth controls correctly', () => {
    const p = plan(svg(path('M10 10 Q20 0 30 10 T50 10 C55 15 60 15 65 10 S75 5 80 10')));
    const steps = p.groups[0]!.paths[0]!.steps;
    expect(steps.map((s) => s.op)).toEqual(['M', 'C', 'C', 'C', 'C']);
    expect(steps[1]!.points[0]!.x).toBeCloseTo(15);
    expect(steps[1]!.points[0]!.y).toBeCloseTo(3);
    expect(steps[2]!.points[0]!.y).toBeCloseTo(15);
    expect(steps[4]!.points[0]).toEqual({ x: 63, y: 4.5 });
  });
  it('relative arcs preserve exact endpoint and generate cubic segments rather than straight chords', () => {
    const s = plan(svg(path('M20 20 a10 5 30 0 1 20 10'))).groups[0]!.paths[0]!.steps;
    expect(s.slice(1).every((s) => s.op === 'C')).toBe(true);
    expect(s.at(-1)!.points.at(-1)).toEqual({ x: 36, y: 27 });
  });
  it.each([
    'M0 0 A10 10 0 2 0 20 0',
    'M0 0 A-10 10 0 0 1 20 0',
    'M0 0 A10 10 0 1.0 0 20 0',
    'M0 0 Q1 2 3',
    'M0 0 S1 2 3',
    'M0 0 L1 1 R2 2',
    'M0 0 A10 10 0 0 1 20 0 garbage',
  ])('still rejects malformed curve data: %s', (d) => expect(() => plan(svg(path(d)))).toThrow());
  it('does not turn filled curved/compound designs into guessed blade outlines', () => {
    expect(() => plan(svg(path(buildShapePath('circle', 40, 40), '#ff0000')))).toThrow(/filled/i);
  });
});

it.each(WORKSPACE_SHAPE_KINDS)(
  'previews actual unfilled %s cut-tool geometry without enabling execution',
  (kind) => {
    const shape: WorkspaceObject = {
      ...object,
      paths: [
        {
          ...object.paths[0]!,
          stroke: '#000000',
          d: buildShapePath(kind, 40, 40, kind === 'rounded-square' ? 8 : 0),
        },
      ],
    };
    const input = buildWorkspaceCutSvg(
      [shape],
      360,
      960,
      [{ color: '#000000', type: 'cut' }],
      80,
      '',
      { x: 0, y: 0, width: 360, height: 960 },
    );
    const p = compileNormalizedSvgForJoy(normalizeWorkspaceSvgForJoyPreview(input, mat), options);
    expect(p.groups[0]!.tool).toBe('fine_point_blade');
    expect(p.execution).toBe('unsupported');
    expect(p.groups[0]!.paths).toHaveLength(1);
  },
);

it('preview does not grant filled-curve execution or lose compound subpaths', () => {
  const raw = svg(
    path('M20 20 A10 10 0 1 1 40 20 A10 10 0 1 1 20 20 Z M25 20 L30 25 L35 20 Z', '#ff0000'),
  );
  expect(() => normalizeWorkspaceSvgForJoy(raw, mat)).toThrow(/filled/i);
  const p = compileNormalizedSvgForJoy(normalizeWorkspaceSvgForJoyPreview(raw, mat), options);
  expect(p.groups[0]!.paths[0]!.steps.filter((s) => s.op === 'M')).toHaveLength(2);
  expect(p.execution).toBe('unsupported');
});

it('accepts actual filled Cut contours, including holes/curves, only with explicit blade role', () => {
  const raw = svg(
    path('M20 20 A10 10 0 1 1 40 20 A10 10 0 1 1 20 20 Z M25 20 L30 25 L35 20 Z', '#ff0000'),
  );
  expect(() => normalizeWorkspaceSvgForJoy(raw, mat)).toThrow(/filled/i);
  expect(() =>
    normalizeWorkspaceSvgForJoy(raw, mat, { '#ff0000': { tool: 'pen', operation: 'draw' } }),
  ).toThrow(/filled/i);
  const n = normalizeWorkspaceSvgForJoy(raw, mat, {
    '#ff0000': { tool: 'fine_point_blade', operation: 'cut' },
  });
  const p = compileNormalizedSvgForJoy(n, {
    ...options,
    strokeTools: { '#ff0000': { tool: 'fine_point_blade', operation: 'cut' } },
  });
  expect(p.groups[0]!.paths[0]!.steps.filter((s) => s.op === 'M')).toHaveLength(2);
  expect(p.groups[0]!.paths[0]!.steps.some((s) => s.op === 'C')).toBe(true);
});
