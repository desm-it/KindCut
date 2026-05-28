import { DOMParser } from "@xmldom/xmldom";
import type { WorkspacePathData } from "./workspace-objects";

export type ExtractedWorkspaceSvg = {
  frame: { width: number; height: number };
  paths: WorkspacePathData[];
};

const DRAWABLE_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const DEFAULT_STROKE = "#8f4f2b";

export function extractWorkspacePathsFromSvg(svg: string): ExtractedWorkspaceSvg {
  const doc = new DOMParser({
    errorHandler: { warning: () => undefined, error: () => undefined, fatalError: () => undefined },
  }).parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    throw new Error("KindCut kan deze afbeelding nog niet openen.");
  }

  const frame = getSvgFrame(root);
  const paths: WorkspacePathData[] = [];
  walkDrawableElements(root, [], (element, transformStack) => {
    const tagName = element.tagName.toLowerCase();
    if (!DRAWABLE_TAGS.has(tagName)) {
      return;
    }
    if (isDroppedBackgroundRect(element, frame)) {
      return;
    }
    const d = elementToPathData(element);
    if (!d) {
      return;
    }
    const pathTransform = transformStack.concat(getAttribute(element, "transform") ?? []).filter(Boolean).join(" ");
    paths.push({
      id: `path-${paths.length + 1}`,
      d,
      fill: normalizePaint(getInheritedAttribute(element, "fill"), "none"),
      stroke: normalizePaint(getInheritedAttribute(element, "stroke"), DEFAULT_STROKE),
      strokeWidth: getInheritedAttribute(element, "stroke-width") ?? "2",
      strokeLinecap: getInheritedAttribute(element, "stroke-linecap") ?? "round",
      strokeLinejoin: getInheritedAttribute(element, "stroke-linejoin") ?? "round",
      pathTransform: pathTransform || undefined,
    });
  });

  if (paths.length === 0) {
    throw new Error("KindCut vond geen snijlijnen in deze afbeelding.");
  }

  return { frame, paths };
}

function walkDrawableElements(
  element: Element,
  transformStack: string[],
  visit: (element: Element, transformStack: string[]) => void,
): void {
  const tagName = element.tagName.toLowerCase();
  const nextTransformStack = tagName === "svg" ? transformStack : transformStack.concat(getAttribute(element, "transform") ?? []);
  visit(element, transformStack);
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child.nodeType === 1) {
      walkDrawableElements(child as Element, nextTransformStack, visit);
    }
  }
}

function elementToPathData(element: Element): string | null {
  const tagName = element.tagName.toLowerCase();
  switch (tagName) {
    case "path":
      return getAttribute(element, "d")?.trim() || null;
    case "rect":
      return rectToPath(element);
    case "circle":
      return circleToPath(element);
    case "ellipse":
      return ellipseToPath(element);
    case "line":
      return lineToPath(element);
    case "polyline":
      return pointsToPath(getAttribute(element, "points"), false);
    case "polygon":
      return pointsToPath(getAttribute(element, "points"), true);
    default:
      return null;
  }
}

function rectToPath(element: Element): string | null {
  const x = parseNumber(getAttribute(element, "x"), 0);
  const y = parseNumber(getAttribute(element, "y"), 0);
  const width = parseNumber(getAttribute(element, "width"), NaN);
  const height = parseNumber(getAttribute(element, "height"), NaN);
  if (!isPositive(width) || !isPositive(height)) {
    return null;
  }
  const rx = Math.min(parseNumber(getAttribute(element, "rx"), parseNumber(getAttribute(element, "ry"), 0)), width / 2);
  const ry = Math.min(parseNumber(getAttribute(element, "ry"), rx), height / 2);
  if (rx > 0 || ry > 0) {
    return [
      `M ${formatNumber(x + rx)} ${formatNumber(y)}`,
      `H ${formatNumber(x + width - rx)}`,
      `Q ${formatNumber(x + width)} ${formatNumber(y)} ${formatNumber(x + width)} ${formatNumber(y + ry)}`,
      `V ${formatNumber(y + height - ry)}`,
      `Q ${formatNumber(x + width)} ${formatNumber(y + height)} ${formatNumber(x + width - rx)} ${formatNumber(y + height)}`,
      `H ${formatNumber(x + rx)}`,
      `Q ${formatNumber(x)} ${formatNumber(y + height)} ${formatNumber(x)} ${formatNumber(y + height - ry)}`,
      `V ${formatNumber(y + ry)}`,
      `Q ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(x + rx)} ${formatNumber(y)}`,
      "Z",
    ].join(" ");
  }
  return `M ${formatNumber(x)} ${formatNumber(y)} H ${formatNumber(x + width)} V ${formatNumber(y + height)} H ${formatNumber(x)} Z`;
}

function circleToPath(element: Element): string | null {
  const cx = parseNumber(getAttribute(element, "cx"), 0);
  const cy = parseNumber(getAttribute(element, "cy"), 0);
  const r = parseNumber(getAttribute(element, "r"), NaN);
  return isPositive(r) ? ellipsePath(cx, cy, r, r) : null;
}

function ellipseToPath(element: Element): string | null {
  const cx = parseNumber(getAttribute(element, "cx"), 0);
  const cy = parseNumber(getAttribute(element, "cy"), 0);
  const rx = parseNumber(getAttribute(element, "rx"), NaN);
  const ry = parseNumber(getAttribute(element, "ry"), NaN);
  return isPositive(rx) && isPositive(ry) ? ellipsePath(cx, cy, rx, ry) : null;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${formatNumber(cx + rx)} ${formatNumber(cy)} A ${formatNumber(rx)} ${formatNumber(ry)} 0 1 1 ${formatNumber(cx - rx)} ${formatNumber(cy)} A ${formatNumber(rx)} ${formatNumber(ry)} 0 1 1 ${formatNumber(cx + rx)} ${formatNumber(cy)} Z`;
}

function lineToPath(element: Element): string | null {
  const x1 = parseNumber(getAttribute(element, "x1"), 0);
  const y1 = parseNumber(getAttribute(element, "y1"), 0);
  const x2 = parseNumber(getAttribute(element, "x2"), 0);
  const y2 = parseNumber(getAttribute(element, "y2"), 0);
  return `M ${formatNumber(x1)} ${formatNumber(y1)} L ${formatNumber(x2)} ${formatNumber(y2)}`;
}

function pointsToPath(points: string | null, closed: boolean): string | null {
  const pairs = (points ?? "").trim().match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (pairs.length < 4 || pairs.length % 2 !== 0) {
    return null;
  }
  const commands = [`M ${formatNumber(pairs[0]!)} ${formatNumber(pairs[1]!)}`];
  for (let index = 2; index < pairs.length; index += 2) {
    commands.push(`L ${formatNumber(pairs[index]!)} ${formatNumber(pairs[index + 1]!)}`);
  }
  if (closed) {
    commands.push("Z");
  }
  return commands.join(" ");
}

function getSvgFrame(root: Element): { width: number; height: number } {
  const viewBox = getAttribute(root, "viewBox");
  if (viewBox) {
    const numbers = viewBox.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    if (numbers.length === 4 && isPositive(numbers[2]!) && isPositive(numbers[3]!)) {
      return { width: numbers[2]!, height: numbers[3]! };
    }
  }
  const width = parseNumber(getAttribute(root, "width"), 200);
  const height = parseNumber(getAttribute(root, "height"), 200);
  return { width: isPositive(width) ? width : 200, height: isPositive(height) ? height : 200 };
}

function isDroppedBackgroundRect(element: Element, frame: { width: number; height: number }): boolean {
  if (element.tagName.toLowerCase() !== "rect") {
    return false;
  }
  const x = parseNumber(getAttribute(element, "x"), 0);
  const y = parseNumber(getAttribute(element, "y"), 0);
  const width = parseNumber(getAttribute(element, "width"), NaN);
  const height = parseNumber(getAttribute(element, "height"), NaN);
  const fill = normalizeColor(getInheritedAttribute(element, "fill"));
  const stroke = normalizePaint(getInheritedAttribute(element, "stroke"), "none");
  const coversFrame = Math.abs(x) <= 0.001 && Math.abs(y) <= 0.001 && Math.abs(width - frame.width) <= 0.001 && Math.abs(height - frame.height) <= 0.001;
  return coversFrame && (fill === "white" || fill === "none" || fill === "transparent") && (stroke === "none" || stroke === "transparent");
}

function normalizePaint(value: string | null, fallback: string): string {
  const normalized = normalizeColor(value);
  return normalized || fallback;
}

const CSS_COLOR_NAMES: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  lime: "#00ff00",
  navy: "#000080",
  teal: "#008080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
};

function normalizeColor(value: string | null): string {
  const cleaned = (value ?? "").trim().toLowerCase();
  if (!cleaned) {
    return "";
  }
  if (cleaned === "#fff" || cleaned === "#ffffff" || cleaned === "rgb(255,255,255)" || cleaned === "rgb(255 255 255)") {
    return "white";
  }
  // Expand 3-digit hex to 6-digit
  if (/^#[0-9a-f]{3}$/.test(cleaned)) {
    return `#${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}${cleaned[3]}${cleaned[3]}`;
  }
  // Convert named colors to hex
  if (Object.prototype.hasOwnProperty.call(CSS_COLOR_NAMES, cleaned)) {
    return CSS_COLOR_NAMES[cleaned]!;
  }
  return cleaned;
}

function getInheritedAttribute(element: Element, name: string): string | null {
  let current: Element | null = element;
  while (current) {
    const value = getAttribute(current, name);
    if (value !== null) {
      return value;
    }
    current = current.parentNode && current.parentNode.nodeType === 1 ? current.parentNode as Element : null;
  }
  return null;
}

function getAttribute(element: Element, name: string): string | null {
  const value = element.getAttribute(name);
  return value === "" ? null : value;
}

function parseNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
