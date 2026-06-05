// Single-line ("stroke") text rendering using the public-domain Hershey "futural"
// (Sans 1-stroke) font. Unlike a normal outline font — where each glyph is a closed
// contour you fill — every glyph here is a set of open polylines along the letter
// skeleton, so it draws/cuts as a single pen stroke instead of a filled "rectangle".
//
// Both the on-canvas display and the cut export use the helpers below, so what you
// see is what gets drawn.
import type { WorkspaceItemFrame } from "./workspace-utils";
import type { WorkspaceTextContent } from "./workspace-objects";
import { HERSHEY_FUTURAL } from "./single-line-font-data";

// Hershey coordinate system: each character encodes a signed value as (charCode - 'R').
const HERSHEY_ORIGIN = "R".charCodeAt(0); // 82
// Glyphs span roughly y = -16 (accents) .. +16 (descenders); baseline sits at +9.
// Treat 32 units as one em so font-size px maps to a sensible visual height.
const HERSHEY_EM = 32;
const HERSHEY_BASELINE = 9;

export type Stroke = Array<[number, number]>;
type Glyph = { left: number; right: number; strokes: Stroke[] };

const glyphCache = new Map<number, Glyph>();

function parseGlyph(spec: string): Glyph {
  const left = spec.charCodeAt(0) - HERSHEY_ORIGIN;
  const right = spec.charCodeAt(1) - HERSHEY_ORIGIN;
  const strokes: Stroke[] = [];
  let current: Stroke | null = null;
  for (let i = 2; i + 1 < spec.length; i += 2) {
    if (spec[i] === " ") {
      current = null; // pen up — start a new stroke on the next point
      continue;
    }
    const point: [number, number] = [spec.charCodeAt(i) - HERSHEY_ORIGIN, spec.charCodeAt(i + 1) - HERSHEY_ORIGIN];
    if (!current) {
      current = [];
      strokes.push(current);
    }
    current.push(point);
  }
  return { left, right, strokes };
}

function glyphForChar(ch: string): Glyph {
  const code = ch.charCodeAt(0);
  const index = code - 32;
  const cached = glyphCache.get(code);
  if (cached) return cached;
  const spec = HERSHEY_FUTURAL[index] ?? HERSHEY_FUTURAL[0]; // fall back to space
  const glyph = parseGlyph(spec!);
  glyphCache.set(code, glyph);
  return glyph;
}

function lineWidthUnits(line: string, letterSpacingUnits: number): number {
  const chars = [...line];
  if (chars.length === 0) return 0;
  let total = 0;
  for (const ch of chars) {
    const g = glyphForChar(ch);
    total += g.right - g.left;
  }
  return total + Math.max(0, chars.length - 1) * letterSpacingUnits;
}

// Measure the tight frame (in workspace px) a single-line text occupies.
export function measureSingleLineText(tc: WorkspaceTextContent): { width: number; height: number } {
  const scale = tc.fontSize / HERSHEY_EM;
  const letterSpacingUnits = tc.letterSpacing / scale;
  const lines = tc.text.split("\n");
  const lineH = tc.fontSize * tc.lineHeight;
  const maxW = Math.max(10, ...lines.map((l) => lineWidthUnits(l, letterSpacingUnits) * scale));
  return { width: Math.ceil(maxW) + 2, height: Math.ceil(lineH * lines.length) + 2 };
}

// Build the stroke polylines (in frame/viewBox coordinate space) for the whole text.
export function buildSingleLineStrokes(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): Stroke[] {
  const scale = tc.fontSize / HERSHEY_EM;
  const letterSpacing = tc.letterSpacing; // px, added between glyph advances
  const letterSpacingUnits = letterSpacing / scale;
  const lineH = tc.fontSize * tc.lineHeight;
  const lines = tc.text.split("\n");
  const out: Stroke[] = [];

  lines.forEach((line, lineIndex) => {
    const lineW = lineWidthUnits(line, letterSpacingUnits) * scale;
    const xStart =
      tc.textAlign === "center" ? (frame.width - lineW) / 2 : tc.textAlign === "right" ? frame.width - 1 - lineW : 1;
    const baselinePx = tc.fontSize + lineIndex * lineH;
    let penX = xStart;
    for (const ch of [...line]) {
      const g = glyphForChar(ch);
      for (const stroke of g.strokes) {
        out.push(
          stroke.map(([x, y]) => [
            penX + (x - g.left) * scale,
            baselinePx + (y - HERSHEY_BASELINE) * scale,
          ]) as Stroke,
        );
      }
      penX += (g.right - g.left) * scale + letterSpacing;
    }
    if (tc.textDecoration === "underline") {
      const ulY = baselinePx + tc.fontSize * 0.12;
      out.push([
        [xStart, ulY],
        [xStart + lineW, ulY],
      ]);
    }
  });
  return out;
}

// Serialize strokes to an SVG path "d" (each stroke is its own M…L… subpath).
export function strokesToPathD(strokes: Stroke[]): string {
  return strokes
    .map((stroke) =>
      stroke
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`)
        .join(" "),
    )
    .join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
