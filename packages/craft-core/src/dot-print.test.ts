import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOT_PRINT,
  type DotPrintSettings,
  type RasterImage,
  dotPathData,
  dotPrintMaxCoverage,
  generateDotPrint,
  normalizeDotPrintSettings,
  separateInks,
} from './dot-print';

function solid(width: number, height: number, rgb: [number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([...rgb, 255], index * 4);
  }
  return { width, height, data };
}

function settings(patch: Partial<DotPrintSettings>): DotPrintSettings {
  return { ...DEFAULT_DOT_PRINT, ...patch };
}

const size = { width: 40, height: 40 };

describe('separateInks', () => {
  it('prints grey with black only and pure colours without black', () => {
    expect(separateInks([0.5, 0.5, 0.5], 'cmyk')).toEqual({ c: 0, m: 0, y: 0, k: 0.5 });
    const red = separateInks([1, 0, 0], 'cmyk');
    expect(red).toEqual({ c: 0, m: 1, y: 1, k: 0 });
    expect(separateInks([1, 1, 1], 'black').k).toBeCloseTo(0);
  });
});

describe('generateDotPrint', () => {
  it('puts no ink on white and keeps every dot inside the picture', () => {
    expect(generateDotPrint(solid(10, 10, [255, 255, 255]), size, DEFAULT_DOT_PRINT)).toEqual([]);
    for (const channel of generateDotPrint(
      solid(10, 10, [40, 160, 220]),
      size,
      DEFAULT_DOT_PRINT,
    )) {
      for (const dot of channel.dots) {
        expect(dot.x).toBeGreaterThanOrEqual(0);
        expect(dot.x).toBeLessThanOrEqual(size.width);
        expect(dot.y).toBeGreaterThanOrEqual(0);
        expect(dot.y).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it('uses more dots for darker tones', () => {
    const count = (grey: number) =>
      generateDotPrint(solid(8, 8, [grey, grey, grey]), size, settings({ colorMode: 'black' }))[0]
        ?.dots.length ?? 0;
    const light = count(200);
    const mid = count(128);
    const dark = count(40);
    expect(light).toBeLessThan(mid);
    expect(mid).toBeLessThan(dark);
    // Mid grey at ~50 % ink: dots per cell ≈ 0.5 / coverage per dot.
    const cells = (size.width * size.height) / DEFAULT_DOT_PRINT.spacingMm ** 2;
    const coverage = dotPrintMaxCoverage(DEFAULT_DOT_PRINT);
    expect(mid / cells).toBeGreaterThan(0.9 * ((1 - 128 / 255) / coverage));
    expect(mid / cells).toBeLessThan(1.1 * ((1 - 128 / 255) / coverage));
  });

  it('splits colour into the right inks, light inks first', () => {
    // A dark green: yellow + cyan, with black for the darkness and no magenta.
    const green = generateDotPrint(solid(8, 8, [0, 160, 0]), size, DEFAULT_DOT_PRINT);
    expect(green.map((channel) => channel.ink)).toEqual(['y', 'c', 'k']);
    const [yellow, cyan, black] = green;
    expect(yellow?.dots.length).toBeGreaterThan(black?.dots.length ?? 0);
    expect(cyan?.dots.length).toBeGreaterThan(black?.dots.length ?? 0);
    expect(yellow?.color).toBe(DEFAULT_DOT_PRINT.pens.y);
    expect(
      generateDotPrint(solid(8, 8, [0, 0, 255]), size, DEFAULT_DOT_PRINT).map(
        (channel) => channel.ink,
      ),
    ).toEqual(['c', 'm']);
  });

  it("orders each ink's dots row by row to keep pen travel short", () => {
    const [black] = generateDotPrint(
      solid(8, 8, [0, 0, 0]),
      size,
      settings({ colorMode: 'black' }),
    );
    const dots = black?.dots ?? [];
    const steps = dots
      .slice(1)
      .map((dot, index) =>
        Math.hypot(dot.x - (dots[index]?.x ?? 0), dot.y - (dots[index]?.y ?? 0)),
      );
    const average = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    expect(average).toBeLessThan(2 * DEFAULT_DOT_PRINT.spacingMm);
  });
});

describe('switching inks off', () => {
  it('leaves a switched-off ink out', () => {
    const inks = generateDotPrint(
      solid(8, 8, [0, 160, 0]),
      size,
      settings({ disabledInks: ['y'] }),
    ).map((channel) => channel.ink);
    expect(inks).toEqual(['c', 'k']);
  });

  it('builds darks from cyan, magenta and yellow when black is off', () => {
    const grey = generateDotPrint(
      solid(8, 8, [60, 60, 60]),
      size,
      settings({ disabledInks: ['k'] }),
    );
    expect(grey.map((channel) => channel.ink)).toEqual(['y', 'c', 'm']);
  });

  it('lets black alone follow brightness, so colours still show as tones', () => {
    const red = generateDotPrint(
      solid(8, 8, [220, 0, 0]),
      size,
      settings({ disabledInks: ['y', 'c', 'm'] }),
    );
    expect(red.map((channel) => channel.ink)).toEqual(['k']);
    expect(red[0]?.dots.length).toBeGreaterThan(0);
  });
});

describe('separate settings for black', () => {
  it('gives black its own resolution without touching the colours', () => {
    const fine = generateDotPrint(solid(8, 8, [90, 60, 40]), size, settings({ blackSpacingMm: 1 }));
    const coarse = generateDotPrint(
      solid(8, 8, [90, 60, 40]),
      size,
      settings({ blackSpacingMm: 2 }),
    );
    const count = (channels: typeof fine, ink: string) =>
      channels.find((channel) => channel.ink === ink)?.dots.length ?? 0;
    expect(count(coarse, 'k')).toBeLessThan(count(fine, 'k') / 2);
    expect(count(coarse, 'y')).toBe(count(fine, 'y'));
    expect(count(coarse, 'm')).toBe(count(fine, 'm'));
  });

  it('gives black its own pen tip: a thicker black needs fewer dots for the same tone', () => {
    const grey = solid(8, 8, [150, 150, 150]);
    const thin = generateDotPrint(grey, size, settings({ blackTipWidthMm: 0.8 }));
    const thick = generateDotPrint(grey, size, settings({ blackTipWidthMm: 1.2 }));
    expect(thick[0]?.ink).toBe('k');
    expect(thick[0]?.dots.length).toBeLessThan(thin[0]?.dots.length ?? 0);
  });

  it('opens older prints with black using their single resolution, tip and bleed', () => {
    const older = normalizeDotPrintSettings({ spacingMm: 1.5, tipWidthMm: 0.7, inkBleed: 30 });
    expect(older?.blackSpacingMm).toBe(1.5);
    expect(older?.blackTipWidthMm).toBe(0.7);
    expect(older?.blackInkBleed).toBe(30);
    expect(normalizeDotPrintSettings({})?.blackInkBleed).toBe(DEFAULT_DOT_PRINT.blackInkBleed);
  });
});

describe('dot settings and shapes', () => {
  it('cleans up settings from a project file', () => {
    expect(
      normalizeDotPrintSettings({
        spacingMm: 99,
        tipWidthMm: -1,
        dotStyle: 'blob',
        pens: { c: '#ABCDEF', m: 'red' },
      }),
    ).toEqual({
      ...DEFAULT_DOT_PRINT,
      spacingMm: 4,
      blackSpacingMm: 4,
      tipWidthMm: 0.1,
      blackTipWidthMm: 0.1,
      pens: { ...DEFAULT_DOT_PRINT.pens, c: '#abcdef' },
    });
  });

  it('writes each dot as one subpath in its style', () => {
    expect(dotPathData(5, 5, 'tap', 10)).toBe('M5 5L5 5');
    expect(dotPathData(5, 5, 'dash', 10)).toBe('M4.5 5L5.5 5');
    expect(dotPathData(5, 5, 'circle', 10)).toMatch(/^M6\.5 5(L[\d.]+ [\d.]+){7}Z$/);
  });
});
