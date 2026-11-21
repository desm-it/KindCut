import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DASH,
  DEFAULT_OUTLINE,
  dashPolyline,
  normalizeDash,
  normalizeOutline,
  polygonSignedArea,
  simplifyClosedPolyline,
  traceAlphaContours,
} from './outline';

const length = (points: Array<{ x: number; y: number }>) =>
  points
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
      0,
    );

describe('dashPolyline', () => {
  it('cuts an open line into equal dashes with a bridge at both ends', () => {
    const pieces = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
      6,
      4,
    );
    expect(pieces).toHaveLength(10);
    for (const piece of pieces) expect(length(piece)).toBeCloseTo(6, 6);
    // The ends stay attached, and both ends are the same.
    const first = pieces[0]![0]!.x;
    const last = 100 - pieces[9]![pieces[9]!.length - 1]!.x;
    expect(first).toBeGreaterThan(1);
    expect(first).toBeCloseTo(last, 6);
    // Bridges between dashes are all the same size.
    const bridge = pieces[1]![0]!.x - pieces[0]![1]!.x;
    expect(bridge).toBeCloseTo(first, 6);
  });

  it('follows corners', () => {
    const pieces = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 4.5, y: 0 },
        { x: 4.5, y: 4.5 },
      ],
      false,
      6,
      2,
    );
    const turning = pieces.find((piece) => piece.length === 3);
    expect(turning?.[1]).toEqual({ x: 4.5, y: 0 });
    for (const piece of pieces) expect(length(piece)).toBeCloseTo(6, 6);
  });

  it('spaces dashes evenly round a closed shape', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    const pieces = dashPolyline(square, true, 6, 4);
    expect(pieces).toHaveLength(12);
    expect(pieces.reduce((sum, piece) => sum + length(piece), 0)).toBeCloseTo(72, 6);
  });

  it('keeps one centred dash on a line that is too short for the pattern', () => {
    const pieces = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      false,
      6,
      4,
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]![0]!.x).toBeCloseTo(5 - pieces[0]![1]!.x, 6);
    expect(length(pieces[0]!)).toBeLessThan(5);
  });
});

function disc(size: number, cx: number, cy: number, radius: number, hole = 0): number[] {
  const alpha: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // Soft one-pixel edge, like an anti-aliased canvas.
      const outer = Math.min(1, Math.max(0, radius - distance + 0.5));
      const inner = hole > 0 ? Math.min(1, Math.max(0, distance - hole + 0.5)) : 1;
      alpha.push(Math.round(255 * Math.min(outer, inner)));
    }
  }
  return alpha;
}

describe('traceAlphaContours', () => {
  it('traces a disc as one outer loop at sub-pixel accuracy', () => {
    const loops = traceAlphaContours(disc(64, 32, 32, 20), 64, 64);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    expect(loop.area).toBeGreaterThan(0);
    expect(loop.area).toBeCloseTo(Math.PI * 400, -1);
    for (const point of loop.points) {
      expect(Math.abs(Math.hypot(point.x - 32, point.y - 32) - 20)).toBeLessThan(0.2);
    }
  });

  it('reports a hole with a negative area', () => {
    const loops = traceAlphaContours(disc(64, 32, 32, 24, 10), 64, 64);
    expect(loops.map((loop) => Math.sign(loop.area)).sort()).toEqual([-1, 1]);
    const hole = loops.find((loop) => loop.area < 0)!;
    expect(-hole.area).toBeCloseTo(Math.PI * 100, -1);
  });

  it('closes shapes that touch the image border', () => {
    const loops = traceAlphaContours(new Array(16).fill(255), 4, 4);
    expect(loops).toHaveLength(1);
    // The corners are cut off diagonally, half a pixel each.
    expect(loops[0]!.area).toBeGreaterThan(15);
    expect(loops[0]!.area).toBeLessThanOrEqual(16);
  });

  it('returns nothing for an empty image', () => {
    expect(traceAlphaContours(new Array(16).fill(0), 4, 4)).toEqual([]);
  });
});

describe('simplifyClosedPolyline', () => {
  it('drops points on straight edges and keeps the corners', () => {
    const square: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 10; i++) square.push({ x: i, y: 0 });
    for (let i = 0; i < 10; i++) square.push({ x: 10, y: i });
    for (let i = 0; i < 10; i++) square.push({ x: 10 - i, y: 10 });
    for (let i = 0; i < 10; i++) square.push({ x: 0, y: 10 - i });
    const simplified = simplifyClosedPolyline(square, 0.01);
    expect(simplified).toHaveLength(4);
    expect(Math.abs(polygonSignedArea(simplified))).toBeCloseTo(100, 6);
  });

  it('stays within the tolerance on a curve', () => {
    const circle = Array.from({ length: 720 }, (_value, index) => {
      const angle = (index / 720) * Math.PI * 2;
      return { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 };
    });
    const simplified = simplifyClosedPolyline(circle, 0.25);
    expect(simplified.length).toBeLessThan(120);
    expect(Math.abs(polygonSignedArea(simplified))).toBeGreaterThan(Math.PI * 10000 * 0.995);
  });
});

describe('settings', () => {
  it('fills in defaults and clamps', () => {
    expect(normalizeDash({})).toEqual(DEFAULT_DASH);
    expect(normalizeDash({ dashMm: 99, gapMm: 0 })).toEqual({
      enabled: true,
      dashMm: 10,
      gapMm: 1,
    });
    expect(normalizeDash(null)).toBeNull();
    expect(normalizeOutline({})).toEqual(DEFAULT_OUTLINE);
    expect(
      normalizeOutline({ distanceMm: 100, penId: 'pen-2', holes: true, enabled: false }),
    ).toEqual({ enabled: false, distanceMm: 15, penId: 'pen-2', holes: true });
    expect(normalizeOutline('x')).toBeNull();
  });
});
