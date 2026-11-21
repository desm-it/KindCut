import { it, expect } from 'vitest';
import { compileNativeJoyPlan } from './native-joy-plan';
const input = {
  widthPx: 432,
  heightPx: 600,
  viewBox: { minX: 0, minY: 0, width: 360, height: 500 },
  mat: { widthIn: 4.5, heightIn: 6.25, mode: 'card' },
  materialId: 535,
  paths: [{ id: 'line', d: 'M10 10 L20 20', tool: 'pen', operation: 'draw', color: '#000000' }],
} as any;
it('preserves explicit CardMat mode independently of its 6.25 inch dimensions', () => {
  expect(compileNativeJoyPlan(input).mat).toEqual(input.mat);
});
it('rejects unsupported modes and inconsistent explicit CardMat dimensions', () => {
  for (const mat of [
    { widthIn: 4.5, heightIn: 6.25, mode: 'matless' },
    { widthIn: 4.5, heightIn: 6.5, mode: 'card' },
    { widthIn: 4, heightIn: 6.25, mode: 'card' },
  ])
    expect(() => compileNativeJoyPlan({ ...input, mat })).toThrow(/mode|CardMat/i);
});
