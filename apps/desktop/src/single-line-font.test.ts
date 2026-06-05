import { describe, expect, it } from "vitest";
import type { WorkspaceTextContent } from "./workspace-objects";
import { buildSingleLineStrokes, measureSingleLineText, strokesToPathD } from "./single-line-font";

function tc(overrides: Partial<WorkspaceTextContent> = {}): WorkspaceTextContent {
  return {
    text: "A",
    fontFamily: "sans-serif",
    fontSize: 48,
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
    textAlign: "left",
    letterSpacing: 0,
    lineHeight: 1.25,
    color: "#000000",
    singleLine: true,
    ...overrides,
  };
}

describe("single-line (Hershey) font", () => {
  it("measures a non-empty, sensible frame", () => {
    const frame = measureSingleLineText(tc({ text: "Hi" }));
    expect(frame.width).toBeGreaterThan(10);
    expect(frame.height).toBeGreaterThan(40); // ~ fontSize * lineHeight
  });

  it("grows height with line count", () => {
    const one = measureSingleLineText(tc({ text: "A" }));
    const two = measureSingleLineText(tc({ text: "A\nB" }));
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("builds open stroke polylines for a glyph (capital A = 3 strokes)", () => {
    const frame = measureSingleLineText(tc({ text: "A" }));
    const strokes = buildSingleLineStrokes(tc({ text: "A" }), frame);
    // futural 'A' = two diagonals + a crossbar
    expect(strokes.length).toBe(3);
    for (const s of strokes) {
      expect(s.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("serializes strokes to a multi-subpath 'd' string", () => {
    const frame = measureSingleLineText(tc({ text: "A" }));
    const d = strokesToPathD(buildSingleLineStrokes(tc({ text: "A" }), frame));
    expect(d.startsWith("M")).toBe(true);
    // three strokes => three moveto commands
    expect((d.match(/M/g) ?? []).length).toBe(3);
  });

  it("adds an underline stroke when decoration is underline", () => {
    const frame = measureSingleLineText(tc({ text: "A" }));
    const plain = buildSingleLineStrokes(tc({ text: "A", textDecoration: "none" }), frame);
    const underlined = buildSingleLineStrokes(tc({ text: "A", textDecoration: "underline" }), frame);
    expect(underlined.length).toBe(plain.length + 1);
  });

  it("falls back to space for unknown characters without throwing", () => {
    const frame = measureSingleLineText(tc({ text: "☃" })); // snowman, outside ASCII
    expect(() => buildSingleLineStrokes(tc({ text: "☃" }), frame)).not.toThrow();
  });
});
