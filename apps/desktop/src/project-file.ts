import type { MeasurementUnit, WorkspaceItemTransform } from "./workspace-utils";
import { type WorkspaceShapeKind, isWorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspacePathData } from "./workspace-objects";
import { extractWorkspacePathsFromSvg } from "./workspace-svg-import";

export const KINDCUT_PROJECT_FORMAT = "kindcut-project";
export const KINDCUT_PROJECT_VERSION = 1;

export type WorkspaceTool = {
  id: string;
  color: string;
  type: "pen" | "cut";
};

// The Cricut Joy has a single blade, so there is exactly ONE cut tool and its
// colour is the "behind" colour (what shows through the cuts). Pens are the only
// freely-editable tools. Defaults are chosen so they never collide (white paper /
// warm-red behind / black pen) — the collision warning stays silent on a fresh project.
export const DEFAULT_PAPER_COLOR = "#fffdf9";
// Behind colour defaults to the app's existing dark brown (the legacy default
// object stroke) so fresh cut shapes match the established palette.
export const DEFAULT_BEHIND_COLOR = "#8f4f2b";

export const DEFAULT_TOOLS: WorkspaceTool[] = [
  { id: "pen-1", color: "#000000", type: "pen" },
  { id: "cut-1", color: DEFAULT_BEHIND_COLOR, type: "cut" },
];

// Appealing Stabilo Point 88 fineliner-inspired colours, in pick order. Adding a
// pen walks this list and uses the first colour not already in use, so a new pen
// never lands on a colour that's already taken (which would warn instantly).
export const PEN_PALETTE: string[] = [
  "#2156a8", // blue
  "#d81e2c", // red
  "#009b48", // green
  "#f5821f", // orange
  "#e5007d", // magenta
  "#6d4aa7", // violet
  "#00a9a5", // turquoise
  "#00a3e0", // azure
  "#8bc53f", // lime
  "#f7c600", // yellow
  "#a8112a", // carmine
  "#ef7fb1", // light pink
  "#00778b", // petrol
  "#6b4423", // brown
  "#1d1d1b", // black
];

/** First palette colour not present in `usedColors` (case-insensitive). */
export function nextPenColor(usedColors: string[]): string {
  const used = new Set(usedColors.map((c) => c.toLowerCase()));
  return PEN_PALETTE.find((c) => !used.has(c.toLowerCase())) ?? PEN_PALETTE[0] ?? "#000000";
}

// ── Tool selectors / mutators ────────────────────────────────────────────────
// `tools` is kept as the single source of truth (one cut tool + N pens). These
// helpers encapsulate that invariant so callers never have to know the cut tool
// is "the behind colour".

export function getPens(tools: WorkspaceTool[]): WorkspaceTool[] {
  return tools.filter((tool) => tool.type === "pen");
}

export function getCutTool(tools: WorkspaceTool[]): WorkspaceTool {
  return tools.find((tool) => tool.type === "cut") ?? { id: "cut-1", color: DEFAULT_BEHIND_COLOR, type: "cut" };
}

export function getBehindColor(tools: WorkspaceTool[]): string {
  return getCutTool(tools).color;
}

/** Returns a new tools array with the cut tool's colour (= behind colour) replaced. */
export function withBehindColor(tools: WorkspaceTool[], color: string): WorkspaceTool[] {
  const cut = getCutTool(tools);
  return [...getPens(tools), { ...cut, color }];
}

/** Returns a new tools array with the pen list replaced, keeping the single cut tool. */
export function withPens(tools: WorkspaceTool[], pens: WorkspaceTool[]): WorkspaceTool[] {
  return [...pens.map((pen) => ({ ...pen, type: "pen" as const })), getCutTool(tools)];
}

/** Coerces any tools array to the invariant: ≥1 pen + exactly one cut tool. */
export function normalizeToolSet(tools: WorkspaceTool[]): WorkspaceTool[] {
  const pens = getPens(tools);
  const safePens = pens.length > 0 ? pens : [{ id: "pen-1", color: "#000000", type: "pen" as const }];
  const firstCut = tools.find((tool) => tool.type === "cut");
  const cut: WorkspaceTool = firstCut
    ? { ...firstCut, type: "cut" }
    : { id: "cut-1", color: DEFAULT_BEHIND_COLOR, type: "cut" };
  return [...safePens, cut];
}

export type SavedImportedSvg = {
  id?: string;
  kind?: "image" | "shape" | "text";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  svg: string;
  transform?: WorkspaceItemTransform;
};

export type SavedWorkspaceObject = {
  id?: string;
  type: "path" | "group";
  kind?: "image" | "shape" | "text";
  sourceKind?: "image" | "shape" | "text";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  frame: { width: number; height: number };
  paths: WorkspacePathData[];
  transform?: WorkspaceItemTransform;
  textContent?: import("./workspace-objects").WorkspaceTextContent;
};

export type KindCutProjectFile = {
  format: typeof KINDCUT_PROJECT_FORMAT;
  version: typeof KINDCUT_PROJECT_VERSION;
  name: string;
  savedAt: string;
  workspace: {
    selectedMaterialId: number;
    selectedMatPreset: string;
    measurementUnit: MeasurementUnit;
    tools: WorkspaceTool[];
    paperColor: string;
  };
  importedSvgs: SavedImportedSvg[];
  selectedSvgId: string | null;
  importedSvg: SavedImportedSvg | null;
  workspaceObjects: SavedWorkspaceObject[];
  selectedObjectId: string | null;
};

export function buildProjectFile(input: {
  name: string;
  selectedMaterialId: number;
  selectedMatPreset: string;
  measurementUnit: MeasurementUnit;
  tools?: WorkspaceTool[];
  paperColor?: string;
  importedSvg?: SavedImportedSvg | null;
  importedSvgs?: SavedImportedSvg[];
  workspaceObjects?: SavedWorkspaceObject[];
  selectedObjectId?: string | null;
  selectedSvgId?: string | null;
  savedAt?: string;
}): KindCutProjectFile {
  const importedSvgs = input.importedSvgs ?? (input.importedSvg ? [input.importedSvg] : []);
  const savedImportedSvgs = importedSvgs.map((item, index) =>
    normalizeSavedImportedSvg({ ...item, id: item.id ?? `svg-${index + 1}` }),
  );
  const workspaceObjects = (input.workspaceObjects ?? savedImportedSvgs.flatMap(migrateImportedSvgToWorkspaceObject)).map((item, index) =>
    normalizeSavedWorkspaceObject({ ...item, id: item.id ?? `object-${index + 1}` }),
  );
  const selectedObjectId =
    typeof input.selectedObjectId === "string" && workspaceObjects.some((item) => item.id === input.selectedObjectId)
      ? input.selectedObjectId
      : workspaceObjects[0]?.id ?? null;
  const selectedSvgId =
    typeof input.selectedSvgId === "string" && savedImportedSvgs.some((item) => item.id === input.selectedSvgId)
      ? input.selectedSvgId
      : savedImportedSvgs[0]?.id ?? null;

  return {
    format: KINDCUT_PROJECT_FORMAT,
    version: KINDCUT_PROJECT_VERSION,
    name: input.name.trim() || "KindCut project",
    savedAt: input.savedAt ?? new Date().toISOString(),
    workspace: {
      selectedMaterialId: input.selectedMaterialId,
      selectedMatPreset: input.selectedMatPreset,
      measurementUnit: input.measurementUnit,
      tools: normalizeToolSet(input.tools ?? DEFAULT_TOOLS),
      paperColor: input.paperColor ?? DEFAULT_PAPER_COLOR,
    },
    importedSvgs: savedImportedSvgs,
    selectedSvgId,
    importedSvg: savedImportedSvgs[0] ?? null,
    workspaceObjects,
    selectedObjectId,
  };
}

export function serializeProjectFile(project: KindCutProjectFile): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function parseProjectFile(content: string): KindCutProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("This is not a valid KindCut project file.");
  }

  if (!isRecord(parsed) || parsed.format !== KINDCUT_PROJECT_FORMAT) {
    throw new Error("This is not a valid KindCut project file.");
  }

  if (parsed.version !== KINDCUT_PROJECT_VERSION) {
    throw new Error("This KindCut project uses an unsupported KindCut project version.");
  }

  const workspace = parsed.workspace;
  if (!isRecord(workspace)) {
    throw new Error("This is not a valid KindCut project file.");
  }

  const selectedMaterialId = workspace.selectedMaterialId;
  const selectedMatPreset = workspace.selectedMatPreset;
  const measurementUnit = workspace.measurementUnit;
  if (
    typeof selectedMaterialId !== "number" ||
    typeof selectedMatPreset !== "string" ||
    !isMeasurementUnit(measurementUnit)
  ) {
    throw new Error("This is not a valid KindCut project file.");
  }

  const importedSvgs = parseImportedSvgs(parsed.importedSvgs, parsed.importedSvg);
  const workspaceObjects = parseWorkspaceObjects(parsed.workspaceObjects, importedSvgs);
  const selectedSvgId =
    typeof parsed.selectedSvgId === "string" && importedSvgs.some((item) => item.id === parsed.selectedSvgId)
      ? parsed.selectedSvgId
      : importedSvgs[0]?.id ?? null;

  const selectedObjectId =
    typeof parsed.selectedObjectId === "string" && workspaceObjects.some((item) => item.id === parsed.selectedObjectId)
      ? parsed.selectedObjectId
      : typeof parsed.selectedSvgId === "string" && workspaceObjects.some((item) => item.id === parsed.selectedSvgId)
        ? parsed.selectedSvgId
        : workspaceObjects[0]?.id ?? null;

  return {
    format: KINDCUT_PROJECT_FORMAT,
    version: KINDCUT_PROJECT_VERSION,
    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "KindCut project",
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
    workspace: {
      selectedMaterialId,
      selectedMatPreset,
      measurementUnit,
      tools: parseTools(workspace.tools),
      paperColor: typeof workspace.paperColor === "string" && workspace.paperColor ? workspace.paperColor : DEFAULT_PAPER_COLOR,
    },
    importedSvgs,
    selectedSvgId,
    importedSvg: importedSvgs[0] ?? null,
    workspaceObjects,
    selectedObjectId,
  };
}

function parseWorkspaceObjects(value: unknown, legacyImportedSvgs: SavedImportedSvg[]): SavedWorkspaceObject[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => parseWorkspaceObject(item, `object-${index + 1}`));
  }
  return legacyImportedSvgs.flatMap(migrateImportedSvgToWorkspaceObject);
}

function parseWorkspaceObject(value: unknown, fallbackId: string): SavedWorkspaceObject {
  if (!isRecord(value) || (value.type !== "path" && value.type !== "group") || !Array.isArray(value.paths)) {
    throw new Error("This is not a valid KindCut project file.");
  }
  if (
    typeof value.fileName !== "string" ||
    typeof value.fileSize !== "string" ||
    !isRecord(value.frame) ||
    typeof value.frame.width !== "number" ||
    typeof value.frame.height !== "number"
  ) {
    throw new Error("This is not a valid KindCut project file.");
  }
  const kind = value.kind === "shape" ? "shape" : value.kind === "text" ? "text" : "image";
  const sourceKind = value.sourceKind === "shape" ? "shape" : value.sourceKind === "text" ? "text" : "image";
  return normalizeSavedWorkspaceObject({
    id: typeof value.id === "string" && value.id.trim() ? value.id : fallbackId,
    type: value.type,
    kind,
    sourceKind,
    shapeKind: isWorkspaceShapeKind(value.shapeKind) ? value.shapeKind : undefined,
    fileName: value.fileName,
    fileSize: value.fileSize,
    frame: { width: value.frame.width, height: value.frame.height },
    paths: value.paths.map(parseWorkspacePath),
    transform: parseTransform(value.transform),
    textContent: isRecord(value.textContent) ? value.textContent as import("./workspace-objects").WorkspaceTextContent : undefined,
  });
}

function parseWorkspacePath(value: unknown): WorkspacePathData {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.d !== "string") {
    throw new Error("This is not a valid KindCut project file.");
  }
  return {
    id: value.id,
    d: value.d,
    fill: typeof value.fill === "string" ? value.fill : "none",
    stroke: typeof value.stroke === "string" ? value.stroke : "#8f4f2b",
    strokeWidth: typeof value.strokeWidth === "string" ? value.strokeWidth : "2",
    strokeLinecap: typeof value.strokeLinecap === "string" ? value.strokeLinecap : undefined,
    strokeLinejoin: typeof value.strokeLinejoin === "string" ? value.strokeLinejoin : undefined,
    pathTransform: typeof value.pathTransform === "string" ? value.pathTransform : undefined,
    sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : undefined,
  };
}

function normalizeSavedWorkspaceObject(value: SavedWorkspaceObject): SavedWorkspaceObject {
  const isTextItem = value.kind === "text" || Boolean(value.textContent);
  const paths = value.paths.map((path, index) => ({
    id: path.id || `path-${index + 1}`,
    d: path.d,
    fill: path.fill || "none",
    stroke: path.stroke || "#8f4f2b",
    strokeWidth: path.strokeWidth || "2",
    strokeLinecap: path.strokeLinecap,
    strokeLinejoin: path.strokeLinejoin,
    fillRule: path.fillRule,
    pathTransform: path.pathTransform,
    sourceLabel: path.sourceLabel,
  }));
  // Text items have no paths (they render live from textContent) — that is valid
  if (!isTextItem && (paths.length === 0 || (value.type === "path" && paths.length !== 1))) {
    throw new Error("This is not a valid KindCut project file.");
  }
  const kind = value.kind === "shape" ? "shape" : value.kind === "text" ? "text" : "image";
  const sourceKind = value.sourceKind === "shape" ? "shape" : value.sourceKind === "text" ? "text" : "image";
  return {
    id: value.id,
    type: value.type,
    kind,
    sourceKind,
    shapeKind: kind === "shape" && isWorkspaceShapeKind(value.shapeKind) ? value.shapeKind : undefined,
    fileName: value.fileName,
    fileSize: value.fileSize,
    frame: {
      width: Number.isFinite(value.frame.width) && value.frame.width > 0 ? value.frame.width : 200,
      height: Number.isFinite(value.frame.height) && value.frame.height > 0 ? value.frame.height : 200,
    },
    paths,
    transform: value.transform ? normalizeTransform(value.transform) : undefined,
    textContent: value.textContent,
  };
}

function migrateImportedSvgToWorkspaceObject(item: SavedImportedSvg): SavedWorkspaceObject[] {
  try {
    const extracted = extractWorkspacePathsFromSvg(item.svg);
    return [{
      id: item.id,
      type: extracted.paths.length === 1 ? "path" : "group",
      kind: item.kind,
      sourceKind: item.kind,
      shapeKind: item.shapeKind,
      fileName: item.fileName,
      fileSize: item.fileSize,
      frame: extracted.frame,
      paths: extracted.paths,
      transform: item.transform,
    }];
  } catch {
    return [];
  }
}

function parseImportedSvgs(value: unknown, legacyValue: unknown): SavedImportedSvg[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      const parsed = parseImportedSvg(item, `svg-${index + 1}`);
      return parsed ? [parsed] : [];
    });
  }
  const legacySvg = parseImportedSvg(legacyValue, "svg-1");
  return legacySvg ? [legacySvg] : [];
}

function parseImportedSvg(value: unknown, fallbackId: string): SavedImportedSvg | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.fileName !== "string" ||
    typeof value.fileSize !== "string" ||
    typeof value.svg !== "string"
  ) {
    throw new Error("This is not a valid KindCut project file.");
  }
  return normalizeSavedImportedSvg({
    id: typeof value.id === "string" && value.id.trim() ? value.id : fallbackId,
    kind: value.kind === "shape" ? "shape" : "image",
    shapeKind: isWorkspaceShapeKind(value.shapeKind) ? value.shapeKind : undefined,
    fileName: value.fileName,
    fileSize: value.fileSize,
    svg: value.svg,
    transform: parseTransform(value.transform),
  });
}

function normalizeSavedImportedSvg(value: SavedImportedSvg): SavedImportedSvg {
  return {
    id: value.id,
    kind: value.kind === "shape" ? "shape" : "image",
    shapeKind: value.kind === "shape" && isWorkspaceShapeKind(value.shapeKind) ? value.shapeKind : undefined,
    fileName: value.fileName,
    fileSize: value.fileSize,
    svg: value.svg,
    transform: value.transform ? normalizeTransform(value.transform) : undefined,
  };
}

function parseTransform(value: unknown): WorkspaceItemTransform | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { x, y, scale, scaleX, scaleY, rotation } = value;
  if (typeof x !== "number" || typeof y !== "number") {
    throw new Error("This is not a valid KindCut project file.");
  }
  if (typeof scaleX === "number" || typeof scaleY === "number" || typeof rotation === "number") {
    if (typeof scaleX !== "number" || typeof scaleY !== "number" || typeof rotation !== "number") {
      throw new Error("This is not a valid KindCut project file.");
    }
    return normalizeTransform({ x, y, scaleX, scaleY, rotation, mirrorX: Boolean(value.mirrorX), mirrorY: Boolean(value.mirrorY) });
  }
  if (typeof scale !== "number") {
    throw new Error("This is not a valid KindCut project file.");
  }
  return normalizeTransform({ x, y, scaleX: scale, scaleY: scale, rotation: 0 });
}

function normalizeTransform(transform: WorkspaceItemTransform): WorkspaceItemTransform {
  return {
    x: Number.isFinite(transform.x) ? transform.x : 0,
    y: Number.isFinite(transform.y) ? transform.y : 0,
    scaleX: Number.isFinite(transform.scaleX) && transform.scaleX > 0 ? transform.scaleX : 1,
    scaleY: Number.isFinite(transform.scaleY) && transform.scaleY > 0 ? transform.scaleY : 1,
    rotation: Number.isFinite(transform.rotation) ? transform.rotation : 0,
    mirrorX: Boolean(transform.mirrorX),
    mirrorY: Boolean(transform.mirrorY),
  };
}

function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === "in" || value === "cm" || value === "mm";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTools(value: unknown): WorkspaceTool[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_TOOLS;
  const tools: WorkspaceTool[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isRecord(item) || typeof item.color !== "string" || (item.type !== "pen" && item.type !== "cut")) continue;
    tools.push({
      id: typeof item.id === "string" && item.id ? item.id : `tool-${i + 1}`,
      color: item.color,
      type: item.type,
    });
  }
  if (tools.length === 0) return DEFAULT_TOOLS;
  // Enforce the one-blade invariant: legacy projects could have multiple cut tools
  // (the old default had two). Collapse to a single cut tool (first cut colour wins)
  // and guarantee at least one pen.
  return normalizeToolSet(tools);
}

export function getSafeProjectFileName(name: string): string {
  const withoutExtension = name.replace(/\.kindcut$/i, "").replace(/\.svg$/i, "");
  return withoutExtension.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "kindcut-project";
}
