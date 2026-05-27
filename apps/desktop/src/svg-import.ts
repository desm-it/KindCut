import type { SvgPreflightResult } from "@cricut-companion/svg-preflight";

export type SvgSizeInfo = {
  width: number;
  height: number;
  unit: string;
  source: "width-height" | "viewBox";
};

type ParsedLength = {
  value: number;
  unit: string;
};

export function getSvgSizeInfo(svg: string): SvgSizeInfo | null {
  const svgTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) {
    return null;
  }

  const width = parseLengthAttribute(svgTag, "width");
  const height = parseLengthAttribute(svgTag, "height");
  if (width && height && width.unit === height.unit) {
    return {
      width: width.value,
      height: height.value,
      unit: width.unit,
      source: "width-height",
    };
  }

  const viewBox = getAttributeValue(svgTag, "viewBox");
  if (!viewBox) {
    return null;
  }

  const numbers = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));

  const boxWidth = numbers[2];
  const boxHeight = numbers[3];
  if (
    numbers.length !== 4 ||
    boxWidth === undefined ||
    boxHeight === undefined ||
    boxWidth <= 0 ||
    boxHeight <= 0
  ) {
    return null;
  }

  return {
    width: boxWidth,
    height: boxHeight,
    unit: "artwork units",
    source: "viewBox",
  };
}

export function getSvgSizeCopy(size: SvgSizeInfo | null): string {
  if (!size) {
    return "Size is not listed in this file yet.";
  }

  return `About ${formatNumber(size.width)} x ${formatNumber(size.height)} ${size.unit}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${formatNumber(kilobytes)} KB`;
  }

  return `${formatNumber(kilobytes / 1024)} MB`;
}

export function getFriendlySvgMessages(result: SvgPreflightResult): string[] {
  return [...result.issues.map(getFriendlySvgIssue), ...result.warnings.map(getFriendlySvgWarning)];
}

function parseLengthAttribute(svgTag: string, name: string): ParsedLength | null {
  const rawValue = getAttributeValue(svgTag, name);
  if (!rawValue) {
    return null;
  }

  const match = rawValue.trim().match(/^([+-]?\d*\.?\d+)([a-z%]*)$/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return {
    value,
    unit: match[2] || "px",
  };
}

function getAttributeValue(svgTag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = svgTag.match(new RegExp(`\\s${escapedName}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function getFriendlySvgIssue(issue: string): string {
  if (/does not look like an SVG/i.test(issue)) {
    return "This does not look like an SVG file. Choose an .svg exported from your design app.";
  }

  return "KindCut could not read this SVG yet. Try exporting it again as a plain SVG.";
}

function getFriendlySvgWarning(warning: string): string {
  if (/filters, masks, or clipping paths/i.test(warning)) {
    return "Some visual effects may not come through exactly when this becomes a cutter project.";
  }

  if (/contains text/i.test(warning)) {
    return "It includes editable text. For best results, turn the words into shapes before cutting.";
  }

  if (/no path elements/i.test(warning)) {
    return "KindCut sees artwork, but it may need shape outlines before cut lines can be prepared.";
  }

  return "This file may need a quick look before it is ready for a cutter project.";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
