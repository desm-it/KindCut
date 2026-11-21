/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { compileNormalizedSvgForJoy } from './joy-svg-plan';

it('compiles a real SVG through clipping/pt72 planning and isolated offline Python candidate bodies', () => {
  const svg = readFileSync(new URL('../test-fixtures/joy-offline.svg', import.meta.url), 'utf8');
  const plan = compileNormalizedSvgForJoy(svg, {
    mat: { widthIn: 4.5, heightIn: 12 },
    materialId: 1,
    strokeTools: {
      '#000000': { tool: 'pen', operation: 'draw' },
      '#ff0000': { tool: 'fine_point_blade', operation: 'cut' },
    },
  });
  expect(plan.schemaVersion).toBe(2);
  expect(plan.coordinateFrame).toBe('kindcut_canvas_pt72_v1');
  expect(plan.clipping.clippedPathIds).toEqual(['clipped-line']);
  expect(plan.groups[0]!.paths[0]!.steps.some((s) => s.op === 'C')).toBe(true);
  const program = `import sys,json,builtins
sys.path.insert(0,sys.argv[1])
original=builtins.__import__
def guarded(name,*args,**kwargs):
    if name.split('.')[0] in {'worker','transport','initializer','materials','channel','crypto','IOBluetooth','socket','subprocess'}:
        raise AssertionError('Forbidden offline dependency: '+name)
    return original(name,*args,**kwargs)
builtins.__import__=guarded
from joy_tool_geometry import compile_tool_aware_candidate
result=compile_tool_aware_candidate(json.load(sys.stdin),batch_limit=3)
print(json.dumps(result))
`;
  const python = fileURLToPath(
    new URL(
      `../../joy-runtime/.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`,
      import.meta.url,
    ),
  );
  const result = spawnSync(
    python,
    ['-I', '-c', program, fileURLToPath(new URL('../../joy-runtime/runtime', import.meta.url))],
    { input: JSON.stringify(plan), encoding: 'utf8', timeout: 10_000, maxBuffer: 10_000_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const job = JSON.parse(result.stdout);
  expect(job.execution).toBe('unsupported');
  expect(job.safetyValidated).toBe(false);
  expect(job.coordinateMapping).toBe('kindcut_canvas_pt72_v1');
  expect(job.coordinateFrame.origin).toBe('logical_canvas_top_left');
  expect(job.coordinateFrame.physicalOrigin).toBe('unverified');
  expect(job.coordinateFrame.vendorTransformStateUsed).toBe(false);
  expect(job.groups.map((g: { tool: string }) => g.tool)).toEqual(['pen', 'fine_point_blade']);
  expect(job.clipping.clippedPathIds).toEqual(['clipped-line']);
  const curve = job.groups[0].paths[0];
  expect(job.groups.map((g: { strategy: unknown }) => g.strategy)).toEqual([
    { parserSelector: 1, optionsWord: 4 },
    { parserSelector: 2, optionsWord: 2 },
  ]);
  // Selector1 preserves its explicit initial line record; selector0's older golden is not this route.
  expect(curve.pointKinds).toEqual([2, 0, 0, 1, 1, 1, 1, 0, 2]);
  const line = job.groups[0].paths[1];
  const points = (line.batchBodiesHex as string[]).flatMap((hex) => {
    const body = Buffer.from(hex, 'hex');
    expect(body[0]).toBe(0x43);
    expect((body.length - 1) % 9).toBe(0);
    const p = [];
    for (let i = 1; i < body.length; i += 9)
      p.push({ kind: body[i], x: body.readFloatLE(i + 1), y: body.readFloatLE(i + 5) });
    return p;
  });
  expect(points[0]!.kind).toBe(2);
  expect(points.at(-1)!.kind).toBe(2);
  expect([...new Set(points.map((p) => p.x))].sort()).toEqual([0, 1]);
  expect(points.every((p) => p.y === 0.5)).toBe(true);
  expect(job.groups[1].paths[0].id).toBe('blade-line');
}, 15_000);
