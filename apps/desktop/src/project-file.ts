import type { MeasurementUnit, WorkspaceItemTransform } from "./workspace-utils";
import { type WorkspaceShapeKind, isWorkspaceShapeKind } from "./workspace-shapes";
import type { WorkspacePathData } from "./workspace-objects";
import { extractWorkspacePathsFromSvg } from "./workspace-svg-import";

export const KINDCUT_PROJECT_FORMAT = "kindcut-project";
export const KINDCUT_PROJECT_VERSION = 1;

export type SavedImportedSvg = {
  id?: string;
  kind?: "image" | "shape";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  svg: string;
  transform?: WorkspaceItemTransform;
};

export type SavedWorkspaceObject = {
  id?: string;
  type: "path" | "group";
  kind?: "image" | "shape";
  sourceKind?: "image" | "shape";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  frame: { width: number; height: number };
  paths: WorkspacePathData[];
  transform?: WorkspaceItemTransform;
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
  return normalizeSavedWorkspaceObject({
    id: typeof value.id === "string" && value.id.trim() ? value.id : fallbackId,
    type: value.type,
    kind: value.kind === "shape" ? "shape" : "image",
    sourceKind: value.sourceKind === "shape" ? "shape" : "image",
    shapeKind: isWorkspaceShapeKind(value.shapeKind) ? value.shapeKind : undefined,
    fileName: value.fileName,
    fileSize: value.fileSize,
    frame: { width: value.frame.width, height: value.frame.height },
    paths: value.paths.map(parseWorkspacePath),
    transform: parseTransform(value.transform),
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
  const paths = value.paths.map((path, index) => ({
    id: path.id || `path-${index + 1}`,
    d: path.d,
    fill: path.fill || "none",
    stroke: path.stroke || "#8f4f2b",
    strokeWidth: path.strokeWidth || "2",
    strokeLinecap: path.strokeLinecap,
    strokeLinejoin: path.strokeLinejoin,
    pathTransform: path.pathTransform,
    sourceLabel: path.sourceLabel,
  }));
  if (paths.length === 0 || (value.type === "path" && paths.length !== 1)) {
    throw new Error("This is not a valid KindCut project file.");
  }
  return {
    id: value.id,
    type: value.type,
    kind: value.kind === "shape" ? "shape" : "image",
    sourceKind: value.sourceKind === "shape" ? "shape" : "image",
    shapeKind: value.kind === "shape" && isWorkspaceShapeKind(value.shapeKind) ? value.shapeKind : undefined,
    fileName: value.fileName,
    fileSize: value.fileSize,
    frame: {
      width: Number.isFinite(value.frame.width) && value.frame.width > 0 ? value.frame.width : 200,
      height: Number.isFinite(value.frame.height) && value.frame.height > 0 ? value.frame.height : 200,
    },
    paths,
    transform: value.transform ? normalizeTransform(value.transform) : undefined,
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
    return normalizeTransform({ x, y, scaleX, scaleY, rotation });
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
  };
}

function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return value === "in" || value === "cm" || value === "mm";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
