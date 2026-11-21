// Pen "printing": turns a picture into dots for up to four pens (cyan, magenta,
// yellow, black), so a plotter can rebuild it like an inkjet printer does.
//
// A pen dot always has the same size, so tone comes from how many dots land in
// an area, not from bigger or smaller dots. Each ink gets its own dot grid,
// turned to a classic printing screen angle so the colours don't line up in
// bands, and error diffusion (Floyd–Steinberg) decides which grid cells get a dot.

import type { Point } from './svg-path-geometry';

export const DOT_STYLES = ['tap', 'dash', 'circle'] as const;
/**
 * How the pen makes one dot:
 * - tap: pen down and straight up again (a zero-length stroke)
 * - dash: a 0.1 mm stroke, for pens that need a little movement to ink
 * - circle: the smallest circle the machine draws neatly
 */
export type DotStyle = (typeof DOT_STYLES)[number];

export const DASH_LENGTH_MM = 0.1;
export const CIRCLE_DOT_RADIUS_MM = 0.15;

/** Ink area of one dot (mm²) for a pen tip `tipMm` wide. */
export function dotInkAreaMm2(style: DotStyle, tipMm: number): number {
  const disc = (diameter: number) => (Math.PI * diameter * diameter) / 4;
  switch (style) {
    case 'tap':
      return disc(tipMm);
    case 'dash':
      return disc(tipMm) + DASH_LENGTH_MM * tipMm;
    case 'circle':
      return disc(tipMm + 2 * CIRCLE_DOT_RADIUS_MM);
  }
}

/** The pen moves for one dot centred on (x, y); `unitsPerMm` scales the fixed dash and circle sizes. */
export function dotStroke(
  x: number,
  y: number,
  style: DotStyle,
  unitsPerMm: number,
): { points: Point[]; closed: boolean } {
  switch (style) {
    case 'tap':
      return {
        points: [
          { x, y },
          { x, y },
        ],
        closed: false,
      };
    case 'dash': {
      const half = (DASH_LENGTH_MM * unitsPerMm) / 2;
      return {
        points: [
          { x: x - half, y },
          { x: x + half, y },
        ],
        closed: false,
      };
    }
    case 'circle': {
      const r = CIRCLE_DOT_RADIUS_MM * unitsPerMm;
      const steps = 8;
      const points = Array.from({ length: steps }, (_, step) => {
        const angle = (step / steps) * Math.PI * 2;
        return { x: x + r * Math.cos(angle), y: y + r * Math.sin(angle) };
      });
      return { points, closed: true };
    }
  }
}

/** One dot as SVG path data (a single subpath, so many dots can share one <path>). */
export function dotPathData(x: number, y: number, style: DotStyle, unitsPerMm: number): string {
  const f = (value: number) => String(Math.round(value * 1000) / 1000);
  const { points, closed } = dotStroke(x, y, style, unitsPerMm);
  return (
    points.map((point, index) => `${index === 0 ? 'M' : 'L'}${f(point.x)} ${f(point.y)}`).join('') +
    (closed ? 'Z' : '')
  );
}

export function normalizeDotStyle(value: unknown, fallback: DotStyle = 'tap'): DotStyle {
  return DOT_STYLES.includes(value as DotStyle) ? (value as DotStyle) : fallback;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const INK_CHANNELS = ['y', 'c', 'm', 'k'] as const;
/** Inks in drawing order: light to dark, so dark pens don't drag through fresh light ink as much. */
export type InkChannel = (typeof INK_CHANNELS)[number];

/** Classic printing screen angles, so the four dot grids don't line up into patterns. */
const SCREEN_ANGLES: Record<InkChannel, number> = { y: 0, c: 15, m: 75, k: 45 };

export const DEFAULT_INK_PEN_COLORS: Record<InkChannel, string> = {
  c: '#00aeef',
  m: '#ec008c',
  y: '#ffd400',
  k: '#000000',
};

export type DotPrintSettings = {
  /** Distance between grid points (mm) for cyan, magenta and yellow: their resolution. */
  spacingMm: number;
  /** Distance between grid points (mm) for black, which has its own resolution. */
  blackSpacingMm: number;
  /** Width of the cyan, magenta and yellow pen tips (mm). */
  tipWidthMm: number;
  /** Width of the black pen tip (mm); black markers are often thicker. */
  blackTipWidthMm: number;
  colorMode: 'cmyk' | 'black';
  dotStyle: DotStyle;
  /** -100…100 */
  brightness: number;
  /** -100…100 */
  contrast: number;
  /** Pen colour used for each ink; must match pens in the project's tool list. */
  pens: Record<InkChannel, string>;
  /** How far cyan, magenta and yellow marker ink runs into the paper and neighbouring dots (0…100). Preview only. */
  inkBleed: number;
  /** The same for black, which usually runs more. Preview only. */
  blackInkBleed: number;
  /** Inks switched off for this print; their dots are left out. */
  disabledInks: InkChannel[];
};

export const DOT_PRINT_LIMITS = {
  spacingMm: { min: 0.3, max: 4 },
  tipWidthMm: { min: 0.1, max: 3 },
  brightness: { min: -100, max: 100 },
  contrast: { min: -100, max: 100 },
  inkBleed: { min: 0, max: 100 },
} as const;

export const DEFAULT_DOT_PRINT: DotPrintSettings = {
  // A grid as fine as the pen tip: dots then cover ~79 % of their cell, so black stays black.
  spacingMm: 1,
  blackSpacingMm: 1,
  tipWidthMm: 1,
  blackTipWidthMm: 1,
  colorMode: 'cmyk',
  dotStyle: 'tap',
  brightness: 0,
  contrast: 0,
  pens: { ...DEFAULT_INK_PEN_COLORS },
  inkBleed: 50,
  blackInkBleed: 70,
  disabledInks: [],
};

function clampNumber(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number,
): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(limits.max, Math.max(limits.min, number)) : fallback;
}

/** Accepts anything (e.g. from a project file) and returns valid settings, or null. */
export function normalizeDotPrintSettings(value: unknown): DotPrintSettings | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pens = (record.pens && typeof record.pens === 'object' ? record.pens : {}) as Record<
    string,
    unknown
  >;
  const hex = (input: unknown, fallback: string) =>
    typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : fallback;
  const spacingMm = clampNumber(
    record.spacingMm,
    DOT_PRINT_LIMITS.spacingMm,
    DEFAULT_DOT_PRINT.spacingMm,
  );
  const inkBleed = clampNumber(
    record.inkBleed,
    DOT_PRINT_LIMITS.inkBleed,
    DEFAULT_DOT_PRINT.inkBleed,
  );
  const tipWidthMm = clampNumber(
    record.tipWidthMm,
    DOT_PRINT_LIMITS.tipWidthMm,
    DEFAULT_DOT_PRINT.tipWidthMm,
  );
  return {
    spacingMm,
    // Older prints had one resolution and bleed for all inks: black keeps those.
    blackSpacingMm: clampNumber(record.blackSpacingMm, DOT_PRINT_LIMITS.spacingMm, spacingMm),
    tipWidthMm,
    blackTipWidthMm: clampNumber(record.blackTipWidthMm, DOT_PRINT_LIMITS.tipWidthMm, tipWidthMm),
    colorMode: record.colorMode === 'black' ? 'black' : 'cmyk',
    dotStyle: normalizeDotStyle(record.dotStyle),
    brightness: clampNumber(record.brightness, DOT_PRINT_LIMITS.brightness, 0),
    contrast: clampNumber(record.contrast, DOT_PRINT_LIMITS.contrast, 0),
    pens: {
      c: hex(pens.c, DEFAULT_INK_PEN_COLORS.c),
      m: hex(pens.m, DEFAULT_INK_PEN_COLORS.m),
      y: hex(pens.y, DEFAULT_INK_PEN_COLORS.y),
      k: hex(pens.k, DEFAULT_INK_PEN_COLORS.k),
    },
    inkBleed,
    blackInkBleed: clampNumber(
      record.blackInkBleed,
      DOT_PRINT_LIMITS.inkBleed,
      Number.isFinite(Number(record.inkBleed)) ? inkBleed : DEFAULT_DOT_PRINT.blackInkBleed,
    ),
    disabledInks: INK_CHANNELS.filter(
      (ink) => Array.isArray(record.disabledInks) && record.disabledInks.includes(ink),
    ),
  };
}

/** Grid spacing for one ink: black has its own, the colours share one. */
export function dotPrintInkSpacing(
  settings: Pick<DotPrintSettings, 'spacingMm' | 'blackSpacingMm'>,
  ink: InkChannel,
): number {
  return ink === 'k' ? (settings.blackSpacingMm ?? settings.spacingMm) : settings.spacingMm;
}

/** Pen tip width for one ink: black has its own, the colours share one. */
export function dotPrintInkTip(
  settings: Pick<DotPrintSettings, 'tipWidthMm' | 'blackTipWidthMm'>,
  ink: InkChannel,
): number {
  return ink === 'k' ? (settings.blackTipWidthMm ?? settings.tipWidthMm) : settings.tipWidthMm;
}

/** Preview ink bleed for one ink: black has its own, the colours share one. */
export function dotPrintInkBleed(
  settings: Pick<DotPrintSettings, 'inkBleed' | 'blackInkBleed'>,
  ink: InkChannel,
): number {
  return ink === 'k' ? (settings.blackInkBleed ?? settings.inkBleed) : settings.inkBleed;
}

/** Inks the colour mode offers (each can still be switched off). */
export function dotPrintModeInks(settings: Pick<DotPrintSettings, 'colorMode'>): InkChannel[] {
  return settings.colorMode === 'black' ? ['k'] : [...INK_CHANNELS];
}

/** Inks a print actually uses, in drawing order. */
export function dotPrintInks(
  settings: Pick<DotPrintSettings, 'colorMode' | 'disabledInks'>,
): InkChannel[] {
  return dotPrintModeInks(settings).filter((ink) => !(settings.disabledInks ?? []).includes(ink));
}

// ── Generation ───────────────────────────────────────────────────────────────

/** RGBA pixels, row by row (like canvas ImageData). */
export type RasterImage = { width: number; height: number; data: ArrayLike<number> };

export type DotPrintChannel = { ink: InkChannel; color: string; dots: Point[] };

/** Bilinear sample at (u, v) in [0, 1]², composited over white; returns RGB in 0…1. */
function sample(image: RasterImage, u: number, v: number): [number, number, number] {
  const x = Math.min(image.width - 1, Math.max(0, u * image.width - 0.5));
  const y = Math.min(image.height - 1, Math.max(0, v * image.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  const corners: Array<[number, number, number]> = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ];
  for (const [cx, cy, weight] of corners) {
    const index = (cy * image.width + cx) * 4;
    const alpha = (image.data[index + 3] ?? 255) / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (image.data[index + channel] ?? 255) / 255;
      out[channel] = (out[channel] ?? 0) + weight * (value * alpha + (1 - alpha));
    }
  }
  return out;
}

function adjust(value: number, brightness: number, contrast: number): number {
  const factor = 1 + contrast / 100;
  return Math.min(1, Math.max(0, (value - 0.5) * factor + 0.5 + brightness / 200));
}

/**
 * Ink amounts (0…1) for one colour. With black, black prints the grey the three
 * colours share; without it, cyan, magenta and yellow build the darks together.
 */
export function separateInks(
  rgb: [number, number, number],
  colorMode: 'cmyk' | 'black',
  useBlack = true,
): Record<InkChannel, number> {
  const [r, g, b] = rgb;
  if (colorMode === 'black') {
    return { c: 0, m: 0, y: 0, k: 1 - (0.299 * r + 0.587 * g + 0.114 * b) };
  }
  const c = 1 - r;
  const m = 1 - g;
  const y = 1 - b;
  if (!useBlack) return { c, m, y, k: 0 };
  const k = Math.min(c, m, y);
  if (k >= 0.999) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (c - k) / (1 - k), m: (m - k) / (1 - k), y: (y - k) / (1 - k), k };
}

/**
 * Turns a picture into pen dots. `sizeMm` is the printed size; returned dot
 * positions are in mm from the picture's top-left, ordered row by row in
 * alternating direction to keep pen travel short. Inks come in drawing order.
 */
export function generateDotPrint(
  image: RasterImage,
  sizeMm: { width: number; height: number },
  input: DotPrintSettings,
): DotPrintChannel[] {
  const settings = normalizeDotPrintSettings(input) ?? DEFAULT_DOT_PRINT;
  if (image.width < 1 || image.height < 1 || !(sizeMm.width > 0) || !(sizeMm.height > 0)) return [];
  const enabledInks = dotPrintInks(settings);
  // Black on its own follows the picture's brightness, like the black-only mode.
  const separationMode =
    enabledInks.length === 1 && enabledInks[0] === 'k' ? 'black' : settings.colorMode;
  const channels: DotPrintChannel[] = [];
  for (const ink of enabledInks) {
    const spacing = dotPrintInkSpacing(settings, ink);
    // A cell with a dot is this fully inked; tones darker than that are as dark as dots can get.
    const coveragePerDot = dotPrintMaxCoverage(settings, ink);
    const radians = (SCREEN_ANGLES[ink] * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // Grid indices whose rotated points can fall inside the picture.
    const corners = [
      [0, 0],
      [sizeMm.width, 0],
      [0, sizeMm.height],
      [sizeMm.width, sizeMm.height],
    ].map(([x, y]) => ({
      i: ((x ?? 0) * cos + (y ?? 0) * sin) / spacing,
      j: (-(x ?? 0) * sin + (y ?? 0) * cos) / spacing,
    }));
    const iMin = Math.floor(Math.min(...corners.map((corner) => corner.i)));
    const iMax = Math.ceil(Math.max(...corners.map((corner) => corner.i)));
    const jMin = Math.floor(Math.min(...corners.map((corner) => corner.j)));
    const jMax = Math.ceil(Math.max(...corners.map((corner) => corner.j)));
    const columns = iMax - iMin + 1;
    const rows = jMax - jMin + 1;

    // Target dot probability per grid cell (NaN = outside the picture).
    const target = new Float64Array(columns * rows).fill(Number.NaN);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const gi = (column + iMin) * spacing;
        const gj = (row + jMin) * spacing;
        const x = gi * cos - gj * sin;
        const y = gi * sin + gj * cos;
        if (x < 0 || y < 0 || x > sizeMm.width || y > sizeMm.height) continue;
        const [r, g, b] = sample(image, x / sizeMm.width, y / sizeMm.height);
        const inks = separateInks(
          [
            adjust(r, settings.brightness, settings.contrast),
            adjust(g, settings.brightness, settings.contrast),
            adjust(b, settings.brightness, settings.contrast),
          ],
          separationMode,
          enabledInks.includes('k'),
        );
        target[row * columns + column] = Math.min(1, inks[ink] / coveragePerDot);
      }
    }

    // Serpentine Floyd–Steinberg: the rounding error of each cell is passed to its neighbours.
    const dots: Point[] = [];
    for (let row = 0; row < rows; row += 1) {
      const forward = row % 2 === 0;
      for (let step = 0; step < columns; step += 1) {
        const column = forward ? step : columns - 1 - step;
        const index = row * columns + column;
        const value = target[index] ?? Number.NaN;
        if (Number.isNaN(value)) continue;
        const placed = value >= 0.5 ? 1 : 0;
        const error = value - placed;
        if (placed) {
          const gi = (column + iMin) * spacing;
          const gj = (row + jMin) * spacing;
          dots.push({ x: gi * cos - gj * sin, y: gi * sin + gj * cos });
        }
        const ahead = forward ? 1 : -1;
        const spread = (dc: number, dr: number, weight: number) => {
          const c = column + dc;
          const r = row + dr;
          if (c < 0 || c >= columns || r >= rows) return;
          const neighbour = r * columns + c;
          const current = target[neighbour] ?? Number.NaN;
          if (!Number.isNaN(current)) target[neighbour] = current + error * weight;
        };
        spread(ahead, 0, 7 / 16);
        spread(-ahead, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(ahead, 1, 1 / 16);
      }
    }
    if (dots.length > 0) channels.push({ ink, color: settings.pens[ink], dots });
  }
  return channels;
}

/** The darkest tone an ink can reach: how much of its grid cell one dot inks (0…1). */
export function dotPrintMaxCoverage(
  settings: Pick<
    DotPrintSettings,
    'dotStyle' | 'tipWidthMm' | 'blackTipWidthMm' | 'spacingMm' | 'blackSpacingMm'
  >,
  ink: InkChannel = 'c',
): number {
  const spacing = dotPrintInkSpacing(settings, ink);
  return Math.min(
    1,
    dotInkAreaMm2(settings.dotStyle, dotPrintInkTip(settings, ink)) / (spacing * spacing),
  );
}

/**
 * A rough plotting time. Each dot is a pen lift; the per-dot time is a guess
 * until it has been measured on a real machine.
 */
export const ESTIMATED_SECONDS_PER_DOT = 0.35;

export function estimateDotPrintMinutes(dotCount: number, inkCount: number): number {
  const penSwapSeconds = Math.max(0, inkCount - 1) * 30;
  return (dotCount * ESTIMATED_SECONDS_PER_DOT + penSwapSeconds) / 60;
}
