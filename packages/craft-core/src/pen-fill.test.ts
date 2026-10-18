import { describe, expect, it } from "vitest";
import {
  DEFAULT_PEN_FILL,
  PEN_FILL_PATTERNS,
  type FillRegion,
  type PenFillPolyline,
  type PenFillSettings,
  generatePenFill,
  normalizePenFill,
  penFillPatternTile,
} from "./pen-fill";
import { type Point, applyMatrix, clipPolylineToRect, flattenSvgPath, formatPolylinePath, parseSvgTransform } from "./svg-path-geometry";

function rectRing(x: number, y: number, width: number, height: number): Point[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function settings(patch: Partial<PenFillSettings>): PenFillSettings {
  return { ...DEFAULT_PEN_FILL, ...patch };
}

function inkLength(polylines: PenFillPolyline[]): number {
  return polylines.reduce((total, polyline) => {
    let length = 0;
    for (let index = 1; index < polyline.points.length; index += 1) {
      const a = polyline.points[index - 1] as Point;
      const b = polyline.points[index] as Point;
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total + length;
  }, 0);
}

function allPoints(polylines: PenFillPolyline[]): Point[] {
  return polylines.flatMap((polyline) => polyline.points);
}

const square: FillRegion = { rings: [rectRing(0, 0, 100, 100)], fillRule: "nonzero" };

describe("flattenSvgPath", () => {
  it("parses absolute and relative lines, H/V and close", () => {
    expect(flattenSvgPath("M0 0 L10 0 v10 h-10 z")).toEqual([
      { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }], closed: true },
    ]);
  });

  it("flattens curves and arcs onto their end points", () => {
    const [cubic] = flattenSvgPath("M0 0C0 10 10 10 10 0", 0.01);
    expect(cubic?.points.length).toBeGreaterThan(8);
    expect(cubic?.points.at(-1)).toEqual({ x: 10, y: 0 });

    const [arc] = flattenSvgPath("M0 0a5 5 0 1 1 10 0", 0.01);
    const last = arc?.points.at(-1);
    expect(last?.x).toBeCloseTo(10);
    expect(last?.y).toBeCloseTo(0);
    // A half circle of radius 5 bulges 5 units out.
    expect(Math.max(...(arc?.points ?? []).map((point) => Math.abs(point.y)))).toBeCloseTo(5, 1);
  });

  it("reads compact arc flags and implicit linetos", () => {
    const [arc] = flattenSvgPath("M0 0a5 5 0 0010 0");
    expect(arc?.points.at(-1)?.x).toBeCloseTo(10);
    expect(flattenSvgPath("M0 0 10 0 10 10")[0]?.points).toHaveLength(3);
  });
});

describe("clipPolylineToRect", () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };

  it("keeps inside lines whole and drops outside ones", () => {
    expect(clipPolylineToRect([{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 1 }], rect)).toEqual([
      [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 1 }],
    ]);
    expect(clipPolylineToRect([{ x: 20, y: 1 }, { x: 30, y: 5 }], rect)).toEqual([]);
  });

  it("cuts a line that leaves and re-enters into separate runs", () => {
    const runs = clipPolylineToRect([{ x: 2, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 8 }, { x: 5, y: 8 }], rect);
    expect(runs).toEqual([
      [{ x: 2, y: 5 }, { x: 10, y: 5 }],
      [{ x: 10, y: 8 }, { x: 5, y: 8 }],
    ]);
  });
});

describe("parseSvgTransform", () => {
  it("composes transform lists left to right", () => {
    const matrix = parseSvgTransform("translate(10 20) scale(2) rotate(90)");
    const point = applyMatrix(matrix, { x: 1, y: 0 });
    expect(point.x).toBeCloseTo(10);
    expect(point.y).toBeCloseTo(22);
  });
});

describe("normalizePenFill", () => {
  it("clamps project-file input to valid settings", () => {
    expect(normalizePenFill({ pattern: "zigzag", density: 400, angle: -45, enabled: false })).toEqual({
      enabled: false,
      pattern: "lines",
      density: 100,
      angle: 135,
    });
    expect(normalizePenFill(null)).toBeNull();
  });
});

describe("generatePenFill", () => {
  it("returns nothing when disabled or for open/degenerate shapes", () => {
    expect(generatePenFill([square], settings({ enabled: false }), { penWidth: 1 })).toEqual([]);
    const line: FillRegion = { rings: [[{ x: 0, y: 0 }, { x: 10, y: 0 }]], fillRule: "nonzero" };
    expect(generatePenFill([line], DEFAULT_PEN_FILL, { penWidth: 1 })).toEqual([]);
  });

  it("matches ink coverage to the density for every pattern", () => {
    for (const pattern of PEN_FILL_PATTERNS) {
      const fill = generatePenFill([square], settings({ pattern, density: 20 }), { penWidth: 1 });
      expect(fill.length, pattern).toBeGreaterThan(0);
      // Ink area ≈ stroke length × pen width; aim for roughly 20 % of the 100×100 square.
      const coverage = (inkLength(fill) * 1) / (100 * 100);
      expect(coverage, pattern).toBeGreaterThan(0.14);
      expect(coverage, pattern).toBeLessThan(0.26);
    }
  });

  it("keeps every stroke inside the shape", () => {
    for (const pattern of PEN_FILL_PATTERNS) {
      const fill = generatePenFill([square], settings({ pattern, angle: 30 }), { penWidth: 1 });
      for (const point of allPoints(fill)) {
        // Dots are drawn as small circles around inside points, so allow a pen radius.
        expect(point.x, pattern).toBeGreaterThanOrEqual(-0.51);
        expect(point.x, pattern).toBeLessThanOrEqual(100.51);
        expect(point.y, pattern).toBeGreaterThanOrEqual(-0.51);
        expect(point.y, pattern).toBeLessThanOrEqual(100.51);
      }
    }
  });

  it("leaves holes empty for both fill rules", () => {
    const hole = rectRing(40, 40, 20, 20);
    const evenOdd: FillRegion = { rings: [rectRing(0, 0, 100, 100), hole], fillRule: "evenodd" };
    // For nonzero the hole must wind the other way.
    const nonzero: FillRegion = { rings: [rectRing(0, 0, 100, 100), [...hole].reverse()], fillRule: "nonzero" };
    for (const region of [evenOdd, nonzero]) {
      const fill = generatePenFill([region], settings({ pattern: "lines", angle: 0, density: 50 }), { penWidth: 1 });
      const insideHole = allPoints(fill).filter((point) => point.x > 40.5 && point.x < 59.5 && point.y > 40.5 && point.y < 59.5);
      expect(insideHole, region.fillRule).toEqual([]);
    }
  });

  it("joins neighbouring hatch lines into one stroke inside convex shapes", () => {
    const fill = generatePenFill([square], settings({ pattern: "lines", angle: 45, density: 10 }), { penWidth: 1 });
    expect(fill).toHaveLength(1);
  });

  it("does not join across a gap between separate shapes", () => {
    const left: FillRegion = { rings: [rectRing(0, 0, 40, 100)], fillRule: "nonzero" };
    const right: FillRegion = { rings: [rectRing(60, 0, 40, 100)], fillRule: "nonzero" };
    const fill = generatePenFill([left, right], settings({ pattern: "lines", angle: 0, density: 10 }), { penWidth: 1 });
    for (const polyline of fill) {
      const xs = polyline.points.map((point) => point.x);
      const crossesGap = xs.some((x) => x < 41) && xs.some((x) => x > 59);
      expect(crossesGap).toBe(false);
    }
  });

  it("anchors the pattern to the object so moving the region shifts the strokes with it", () => {
    const options = { penWidth: 1 };
    const base = generatePenFill([square], settings({ pattern: "cross" }), options);
    const shifted = generatePenFill(
      [{ rings: [rectRing(0, 0, 100, 100)], fillRule: "nonzero" }],
      settings({ pattern: "cross" }),
      options,
    );
    expect(formatPolylinePath(shifted)).toBe(formatPolylinePath(base));
  });

  it("draws exactly on the canvas preview tile, so screen and cutter agree", () => {
    const blob: FillRegion = {
      rings: [[{ x: 13, y: 7 }, { x: 140, y: 31 }, { x: 118, y: 133 }, { x: 22, y: 96 }]],
      fillRule: "nonzero",
    };
    for (const pattern of PEN_FILL_PATTERNS) {
      const fillSettings = settings({ pattern, density: 30, angle: 20 });
      const tile = penFillPatternTile(fillSettings, 1);
      expect(tile, pattern).not.toBeNull();
      if (!tile) continue;
      const toTile = (point: Point) => {
        const radians = (-tile.rotation * Math.PI) / 180;
        const x = point.x * Math.cos(radians) - point.y * Math.sin(radians);
        const y = point.x * Math.sin(radians) + point.y * Math.cos(radians);
        return { x: ((x % tile.width) + tile.width) % tile.width, y: ((y % tile.height) + tile.height) % tile.height };
      };
      const tileSegments = flattenSvgPath(tile.d).flatMap((subpath) =>
        subpath.points.slice(1).map((point, index) => [subpath.points[index] as Point, point] as const),
      );
      const distanceToTile = (point: Point) =>
        Math.min(
          ...tileSegments.map(([a, b]) => {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
          }),
        );

      const fill = generatePenFill([blob], fillSettings, { penWidth: 1 });
      expect(fill.length, pattern).toBeGreaterThan(0);
      for (const polyline of fill.slice(0, 40)) {
        if (pattern === "dots") {
          const ring = polyline.points.slice(0, -1);
          const centre = toTile({
            x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
            y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
          });
          const nearest = Math.min(...tile.dots.map((dot) => Math.hypot(dot.x - centre.x, dot.y - centre.y)));
          expect(nearest, pattern).toBeLessThan(1e-6);
          continue;
        }
        for (const point of [polyline.points[0], polyline.points[1]] as Point[]) {
          expect(distanceToTile(toTile(point)), pattern).toBeLessThan(2e-3);
        }
      }
    }
  });

  it("caps the number of strokes for huge dense fills", () => {
    const huge: FillRegion = { rings: [rectRing(0, 0, 10_000, 10_000)], fillRule: "nonzero" };
    const fill = generatePenFill([huge], settings({ pattern: "dots", density: 100 }), { penWidth: 1, maxElements: 2_000 });
    expect(fill.length).toBeLessThan(2_600);
  });
});
