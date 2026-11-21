import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOT_PRINT,
  DEFAULT_INK_PEN_COLORS,
  type RasterImage,
} from '@cricut-companion/craft-core';
import { DEFAULT_TOOLS } from './project-file';
import type { WorkspaceObject } from './workspace-objects';
import { dotPrintToPaths, ensureInkPens, missingInkPens } from './dot-print-render';

function picture(rgb: [number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < 64; index += 1) data.set([...rgb, 255], index * 4);
  return { width: 8, height: 8, data };
}

const item: WorkspaceObject = {
  id: 'photo',
  type: 'group',
  kind: 'image',
  sourceKind: 'image',
  fileName: 'photo',
  fileSize: '',
  sizeCopy: '',
  // 80 px = 1 inch = 25.4 mm at scale 2 → 50.8 mm printed.
  frame: { width: 80, height: 80 },
  paths: [],
  transform: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 },
  dotPrint: { image: 'data:image/png;base64,AAAA', settings: DEFAULT_DOT_PRINT },
};

describe('dot prints for the cutter', () => {
  it('turns dots into pen paths per ink, light inks first, inside the frame', () => {
    const paths = dotPrintToPaths(item, picture([0, 120, 200]));
    const colors = [...new Set(paths.map((path) => path.stroke))];
    expect(colors).toEqual([
      DEFAULT_INK_PEN_COLORS.c,
      DEFAULT_INK_PEN_COLORS.m,
      DEFAULT_INK_PEN_COLORS.k,
    ]);
    for (const path of paths) {
      expect(path.fill).toBe('none');
      const numbers = path.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(80);
      // Tap dots: pen down and up on the same spot.
      expect(path.d).toMatch(/^M([\d.]+) ([\d.]+)L\1 \2/);
    }
  });

  it('splits large prints into several paths', () => {
    const paths = dotPrintToPaths(item, picture([0, 0, 0]));
    expect(paths.length).toBeGreaterThan(1);
    expect(paths.every((path) => (path.d.match(/M/g)?.length ?? 0) <= 400)).toBe(true);
  });

  it('adds missing ink pens once and reuses existing ones', () => {
    const { tools, pens } = ensureInkPens(DEFAULT_TOOLS);
    const penColors = tools.filter((tool) => tool.type === 'pen').map((tool) => tool.color);
    expect(penColors.filter((color) => color === '#000000')).toHaveLength(1);
    expect(penColors).toEqual(expect.arrayContaining(Object.values(DEFAULT_INK_PEN_COLORS)));
    expect(tools.filter((tool) => tool.type === 'cut')).toHaveLength(1);
    expect(ensureInkPens(tools).tools).toBe(tools);
    expect(
      missingInkPens(
        { ...item, dotPrint: { ...item.dotPrint!, settings: { ...DEFAULT_DOT_PRINT, pens } } },
        tools,
      ),
    ).toEqual([]);
    expect(missingInkPens(item, DEFAULT_TOOLS)).toEqual([
      DEFAULT_INK_PEN_COLORS.y,
      DEFAULT_INK_PEN_COLORS.c,
      DEFAULT_INK_PEN_COLORS.m,
    ]);
  });
});
