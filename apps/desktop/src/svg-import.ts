import type { SvgPreflightResult } from "@cricut-companion/svg-preflight";
import type { Language } from "./i18n";
import { createTranslator } from "./i18n";

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

export function getSvgSizeCopy(size: SvgSizeInfo | null, language: Language = "nl"): string {
  const { t } = createTranslator(language);

  if (!size) {
    return t("size.unknown");
  }

  const unit = size.unit === "artwork units" ? t("size.artworkUnits") : size.unit;
  return t("size.about", { width: formatNumber(size.width), height: formatNumber(size.height), unit });
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

export function getFriendlySvgMessages(result: SvgPreflightResult, language: Language = "nl"): string[] {
  return [
    ...result.issues.map((issue) => getFriendlySvgIssue(issue, language)),
    ...result.warnings.map((warning) => getFriendlySvgWarning(warning, language)),
  ];
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

function getFriendlySvgIssue(issue: string, language: Language): string {
  const { t } = createTranslator(language);

  if (/does not look like an SVG/i.test(issue)) {
    return t("svg.issue.notSvg");
  }

  return t("svg.issue.generic");
}

function getFriendlySvgWarning(warning: string, language: Language): string {
  const { t } = createTranslator(language);

  if (/filters, masks, or clipping paths/i.test(warning)) {
    return t("svg.warning.effects");
  }

  if (/contains text/i.test(warning)) {
    return t("svg.warning.text");
  }

  if (/no path elements/i.test(warning)) {
    return t("svg.warning.noPaths");
  }

  return t("svg.warning.generic");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
