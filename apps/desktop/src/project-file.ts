import type { MeasurementUnit, WorkspaceItemTransform } from "./workspace-utils";
import { type WorkspaceShapeKind, isWorkspaceShapeKind } from "./workspace-shapes";

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
};

export function buildProjectFile(input: {
  name: string;
  selectedMaterialId: number;
  selectedMatPreset: string;
  measurementUnit: MeasurementUnit;
  importedSvg?: SavedImportedSvg | null;
  importedSvgs?: SavedImportedSvg[];
  selectedSvgId?: string | null;
  savedAt?: string;
}): KindCutProjectFile {
  const importedSvgs = input.importedSvgs ?? (input.importedSvg ? [input.importedSvg] : []);
  const savedImportedSvgs = importedSvgs.map((item, index) =>
    normalizeSavedImportedSvg({ ...item, id: item.id ?? `svg-${index + 1}` }),
  );
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
  const selectedSvgId =
    typeof parsed.selectedSvgId === "string" && importedSvgs.some((item) => item.id === parsed.selectedSvgId)
      ? parsed.selectedSvgId
      : importedSvgs[0]?.id ?? null;

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
  };
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
