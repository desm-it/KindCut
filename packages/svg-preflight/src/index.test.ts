import { describe, expect, it } from "vitest";
import { preflightSvg } from "./index";

describe("preflightSvg", () => {
  it("accepts a basic path SVG without path warnings", () => {
    const result = preflightSvg('<svg><path d="M 0 0 L 1 1" /></svg>');

    expect(result.ok).toBe(true);
    expect(result.warnings).not.toContain(
      "SVG has no path elements yet. Preflight currently focuses on path-based Cricut output.",
    );
  });

  it("flags non-SVG input", () => {
    const result = preflightSvg("hello");
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("SVG");
  });
});
