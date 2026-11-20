import { DOMParser } from "@xmldom/xmldom";
import {
  compileNativeJoyPlan,
  type Matrix,
  type NativeJoyPlan,
  type NativeJoyPlanInput,
  type JoyPlanTool,
} from "@cricut-companion/craft-core";

export type JoySvgPlanningOptions = Pick<NativeJoyPlanInput, "mat" | "materialId" | "calibration" | "toolOrder" | "boundsPolicy"> & {
  strokeTools: Readonly<Record<string, { tool: JoyPlanTool; operation: "draw" | "cut" }>>;
};

type InputPath = NativeJoyPlanInput["paths"][number];
const SVG_NS = "http://www.w3.org/2000/svg";
const NUMBER = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
const LENGTH = new RegExp(`^(${NUMBER})(?:px)?$`);
const NUMERIC = new RegExp(`^${NUMBER}$`);
const ROOT_ATTRS = new Set(["xmlns", "width", "height", "viewBox", "preserveAspectRatio", "id", "version", "transform"]);
const GROUP_ATTRS = new Set(["id", "transform"]);
const PATH_ATTRS = new Set(["id", "d", "stroke", "fill", "transform", "stroke-width", "stroke-linecap", "stroke-linejoin"]);

/**
 * Compile a STRICT normalized SVG subset, not a general SVG renderer/normalizer.
 * Numeric/px sizes, explicit viewBox, matrix transforms, stroke-mapped M/L/C/Z
 * paths with fill="none" only. Unsupported content fails instead of vanishing.
 * No helpers, secrets, subprocesses, I/O, IPC or device commands. The returned
 * core plan is planning-only; this does not enable native job execution.
 */
export function compileNormalizedSvgForJoy(svg: string, options: JoySvgPlanningOptions): NativeJoyPlan {
  if (typeof svg !== "string" || svg.length === 0 || svg.length > 1_000_000) {
    throw new Error("Normalized SVG must contain at most 1000000 characters.");
  }
  if ((svg.match(/</g)?.length ?? 0) > 10_000 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\?xml-stylesheet/i.test(svg)) {
    throw new Error("Unsupported SVG directives or excessive markup.");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Planning options are required.");
  const mappings = colorMappings(options.strokeTools);
  const malformed = (): never => { throw new Error("Malformed normalized SVG XML."); };
  const doc = new DOMParser({ errorHandler: { warning: malformed, error: malformed, fatalError: malformed } })
    .parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NS) throw new Error("Expected an SVG document with the SVG namespace.");
  for (let i = 0; i < doc.childNodes.length; i += 1) {
    const node = doc.childNodes.item(i);
    if (!node || node === root || node.nodeType === 8 || (node.nodeType === 3 && !node.nodeValue?.trim())) continue;
    if (node.nodeType === 7 && node.nodeName === "xml") continue;
    throw new Error("Unsupported document-level SVG content.");
  }
  attributes(root, ROOT_ATTRS);
  const widthPx = pixelLength(root.getAttribute("width") ?? "");
  const heightPx = pixelLength(root.getAttribute("height") ?? "");
  const [minX, minY, width, height] = numberList(root.getAttribute("viewBox") ?? "", 4);
  const viewBox = { minX: minX!, minY: minY!, width: width!, height: height! };
  const aspect = root.getAttribute("preserveAspectRatio") ?? "";
  if (aspect !== "" && aspect !== "none") throw new Error("Only preserveAspectRatio=none is supported for normalized SVG.");
  // Absent SVG preserveAspectRatio defaults to meet. Do not silently stretch a
  // document whose default presentation differs from the planner's root matrix.
  if (aspect === "" && Math.abs(widthPx / heightPx - viewBox.width / viewBox.height) > 1e-12) {
    throw new Error("Non-matching aspect ratios require explicit preserveAspectRatio=none.");
  }
  const paths: InputPath[] = [];
  let nodes = 0;
  const walk = (element: Element, ancestors: readonly Matrix[], depth: number): void => {
    nodes += 1;
    if (depth > 32 || nodes > 10_000) throw new Error("SVG nesting or element budget exceeded.");
    if (element.namespaceURI !== SVG_NS) throw new Error("Foreign SVG namespaces are unsupported.");
    const tag = element.localName;
    if (tag !== "path" && tag !== "g" && element !== root) throw new Error(`Unsupported normalized SVG element: ${tag}.`);
    attributes(element, element === root ? ROOT_ATTRS : tag === "g" ? GROUP_ATTRS : PATH_ATTRS);
    const local = element.getAttribute("transform");
    const transforms = local ? [...ancestors, matrix(local)] : [...ancestors];
    if (tag === "path") {
      if (element.getAttribute("fill") !== "none") throw new Error("Normalized centerline paths require explicit fill=none; filled outlines are not implemented.");
      const stroke = color(element.getAttribute("stroke") ?? "");
      const binding = mappings.get(stroke);
      if (!binding) throw new Error(`No tool mapping for SVG stroke ${stroke}.`);
      const path: InputPath = {
        id: element.getAttribute("id") || `path-${paths.length + 1}`,
        d: element.getAttribute("d") ?? "", transforms,
        tool: binding.tool, operation: binding.operation,
        ...(binding.tool === "pen" ? { color: stroke } : {}),
      };
      if (paths.length >= 1000) throw new Error("SVG path budget exceeded.");
      paths.push(path);
    }
    for (let i = 0; i < element.childNodes.length; i += 1) {
      const node = element.childNodes.item(i);
      if (!node || node.nodeType === 8 || (node.nodeType === 3 && !node.nodeValue?.trim())) continue;
      if (node.nodeType !== 1 || tag === "path") throw new Error("Unsupported SVG text or path child content.");
      walk(node as Element, transforms, depth + 1);
    }
  };
  walk(root, [], 0);
  return compileNativeJoyPlan({
    widthPx, heightPx, viewBox, preserveAspectRatio: "none", paths,
    mat: options.mat, materialId: options.materialId,
    calibration: options.calibration, toolOrder: options.toolOrder, boundsPolicy: options.boundsPolicy,
  });
}

function attributes(element: Element, allowed: ReadonlySet<string>): void {
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attr = element.attributes.item(i);
    if (!attr || !allowed.has(attr.name)) throw new Error(`Unsupported normalized SVG attribute: ${attr?.name}.`);
  }
}

function pixelLength(value: string): number {
  if (value.length > 64) throw new Error("SVG numeric length budget exceeded.");
  const match = LENGTH.exec(value.trim());
  if (!match || !Number.isFinite(Number(match[1])) || Number(match[1]) <= 0) throw new Error("Normalized SVG width/height must be positive numeric pixel lengths.");
  return Number(match[1]);
}

function numberList(value: string, count: number): number[] {
  if (/^\s*,|,\s*,|,\s*$/.test(value)) throw new Error("Malformed SVG number separators.");
  const tokens = value.trim().split(/[\s,]+/);
  if (tokens.length !== count || tokens.some(token => token.length > 64 || !NUMERIC.test(token) || !Number.isFinite(Number(token)))) {
    throw new Error(`Expected exactly ${count} finite SVG numbers.`);
  }
  return tokens.map(Number);
}

function matrix(value: string): Matrix {
  if (value.length > 512) throw new Error("SVG transform length budget exceeded.");
  const match = /^matrix\(\s*([^()]*)\s*\)$/.exec(value.trim());
  if (!match) throw new Error("Only a normalized matrix transform is supported.");
  return numberList(match[1]!, 6) as Matrix;
}

function color(value: string): string {
  if (!/^#[a-f0-9]{6}$/i.test(value)) throw new Error("Normalized SVG stroke must be an explicit six-digit hex color.");
  return value.toLowerCase();
}

function colorMappings(value: JoySvgPlanningOptions["strokeTools"]): Map<string, { tool: JoyPlanTool; operation: "draw" | "cut" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Explicit SVG stroke mappings are required.");
  const result = new Map<string, { tool: JoyPlanTool; operation: "draw" | "cut" }>();
  for (const [key, binding] of Object.entries(value)) {
    const normalized = color(key);
    if (result.has(normalized)) throw new Error("Duplicate normalized SVG stroke mapping.");
    if (!binding || typeof binding !== "object" ||
      !((binding.tool === "pen" && binding.operation === "draw") || (binding.tool === "fine_point_blade" && binding.operation === "cut"))) {
      throw new Error("Unsupported SVG tool/operation mapping.");
    }
    result.set(normalized, { tool: binding.tool, operation: binding.operation });
  }
  return result;
}
