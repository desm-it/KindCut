import { describe, expect, it } from "vitest";
import { formatFileSize, getFriendlySvgMessages, getSvgSizeCopy, getSvgSizeInfo } from "./svg-import";

describe("svg import helpers", () => {
  it("reads width and height from the root svg tag", () => {
    const size = getSvgSizeInfo('<svg width="4.25in" height="5.5in"><path d="M 0 0" /></svg>');

    expect(size).toEqual({
      width: 4.25,
      height: 5.5,
      unit: "in",
      source: "width-height",
    });
    expect(getSvgSizeCopy(size)).toBe("Ongeveer 4.3 x 5.5 in");
    expect(getSvgSizeCopy(size, "en")).toBe("About 4.3 x 5.5 in");
  });

  it("falls back to the viewBox artwork area", () => {
    const size = getSvgSizeInfo('<svg viewBox="0 0 288 240"><path d="M 0 0" /></svg>');

    expect(size).toEqual({
      width: 288,
      height: 240,
      unit: "artwork units",
      source: "viewBox",
    });
    expect(getSvgSizeCopy(size)).toBe("Ongeveer 288 x 240 tekeneenheden");
  });

  it("keeps unknown sizes calm", () => {
    expect(getSvgSizeInfo("<svg><path /></svg>")).toBeNull();
    expect(getSvgSizeCopy(null)).toBe("De afmeting staat nog niet in dit bestand.");
  });

  it("formats file sizes for the import card", () => {
    expect(formatFileSize(512)).toBe("512 bytes");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1536 * 1024)).toBe("1.5 MB");
  });

  it("turns preflight messages into plain-language guidance", () => {
    const messages = getFriendlySvgMessages({
      ok: false,
      issues: ["Input does not look like an SVG document."],
      warnings: ["SVG contains text. Convert text to outlines before sending to Cricut."],
    });

    expect(messages[0]).toContain("lijkt geen SVG-bestand");
    expect(messages[1]).toContain("zet de woorden om naar vormen");
    expect(messages.join(" ")).not.toMatch(/preflight|path elements|clipPath|stderr|stdout/i);
  });
});
