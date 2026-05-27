import { describe, expect, it } from "vitest";
import { preflightSvg } from "./index";

describe("preflightSvg", () => {
  it("accepts a basic path SVG", () => {
    expect(preflightSvg('<svg><path d="M 0 0 L 1 1" /></svg>').ok).toBe(true);
  });

  it("flags non-SVG input", () => {
    const result = preflightSvg("hello");
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("SVG");
  });
});
