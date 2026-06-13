export type RasterImportFileLike = {
  name: string;
  type: string;
};

export type RasterTraceOptions = {
  threshold: number;
  detail: number;
  invert: boolean;
};

export type RasterTraceBackendOptions = {
  threshold: number;
  turdSize: number;
  optTolerance: number;
  invert: boolean;
};

export const RASTER_IMPORT_EXT_RE = /\.(png|jpe?g)$/i;
export const DEFAULT_RASTER_TRACE_OPTIONS: RasterTraceOptions = {
  threshold: 128,
  detail: 45,
  invert: false,
};

function clamp(value: number, min: number, max: number): number {
  const finiteValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, finiteValue));
}

export function normalizeRasterTraceOptions(options?: Partial<RasterTraceOptions> | null): RasterTraceOptions {
  return {
    threshold: Math.round(clamp(options?.threshold ?? DEFAULT_RASTER_TRACE_OPTIONS.threshold, 0, 255)),
    detail: Math.round(clamp(options?.detail ?? DEFAULT_RASTER_TRACE_OPTIONS.detail, 0, 100)),
    invert: Boolean(options?.invert ?? DEFAULT_RASTER_TRACE_OPTIONS.invert),
  };
}

export function mapRasterTraceOptions(options?: Partial<RasterTraceOptions> | null): RasterTraceBackendOptions {
  const normalized = normalizeRasterTraceOptions(options);
  const detailRatio = normalized.detail / 100;
  return {
    threshold: normalized.threshold,
    turdSize: Math.round(260 - detailRatio * 245),
    optTolerance: Number((0.36 - detailRatio * 0.28).toFixed(2)),
    invert: normalized.invert,
  };
}

export function isRasterImportFile(file: RasterImportFileLike): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" || RASTER_IMPORT_EXT_RE.test(file.name);
}

export function rasterMimeType(file: RasterImportFileLike): string {
  if (file.type === "image/png" || file.type === "image/jpeg") {
    return file.type;
  }
  return file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

export function stripImageExtension(fileName: string): string {
  return fileName.replace(/\.(svg|png|jpe?g)$/i, "");
}

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",", 2)[1] ?? "";
}
