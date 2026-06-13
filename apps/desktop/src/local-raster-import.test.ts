import { describe, expect, it } from "vitest";
import {
  DEFAULT_RASTER_TRACE_OPTIONS,
  dataUrlToBase64,
  isRasterImportFile,
  mapRasterTraceOptions,
  normalizeRasterTraceOptions,
  rasterMimeType,
  stripImageExtension,
} from "./local-raster-import";

describe("local raster import helpers", () => {
  it("accepts PNG and JPEG files by MIME type or extension", () => {
    expect(isRasterImportFile({ name: "photo.png", type: "" })).toBe(true);
    expect(isRasterImportFile({ name: "photo.JPG", type: "" })).toBe(true);
    expect(isRasterImportFile({ name: "photo", type: "image/jpeg" })).toBe(true);
    expect(isRasterImportFile({ name: "vector.svg", type: "image/svg+xml" })).toBe(false);
  });

  it("normalizes missing raster MIME types from the file name", () => {
    expect(rasterMimeType({ name: "flower.png", type: "" })).toBe("image/png");
    expect(rasterMimeType({ name: "flower.jpeg", type: "" })).toBe("image/jpeg");
    expect(rasterMimeType({ name: "flower.bin", type: "image/png" })).toBe("image/png");
  });

  it("strips supported image extensions and extracts base64 payloads", () => {
    expect(stripImageExtension("flower.PNG")).toBe("flower");
    expect(stripImageExtension("flower.card.svg")).toBe("flower.card");
    expect(dataUrlToBase64("data:image/png;base64,abc123")).toBe("abc123");
  });

  it("normalizes trace options and maps detail to potrace cleanup settings", () => {
    expect(normalizeRasterTraceOptions({ threshold: 999, detail: -10, invert: true })).toEqual({
      threshold: 255,
      detail: 0,
      invert: true,
    });
    expect(normalizeRasterTraceOptions(null)).toEqual(DEFAULT_RASTER_TRACE_OPTIONS);

    const clean = mapRasterTraceOptions({ detail: 0 });
    const detailed = mapRasterTraceOptions({ detail: 100 });
    expect(clean.turdSize).toBeGreaterThan(detailed.turdSize);
    expect(clean.optTolerance).toBeGreaterThan(detailed.optTolerance);
    expect(detailed.turdSize).toBe(15);
  });
});
