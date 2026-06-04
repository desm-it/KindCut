import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
import { buildBeginnerProject, joyStandardMat, validateProject } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "@cricut-companion/ai-designer";
import { MAT_PRESETS, MATERIAL_OPTIONS, buildPlanCommand } from "@cricut-companion/slicebug-bridge";
import { preflightSvg } from "@cricut-companion/svg-preflight";
import Moveable from "react-moveable";
import type {
  OnDrag,
  OnDragGroup,
  OnDragGroupStart,
  OnDragStart,
  OnRotate,
  OnRotateGroup,
  OnRotateGroupStart,
  OnRotateStart,
  OnScale,
  OnScaleGroup,
  OnScaleGroupStart,
  OnScaleStart,
} from "react-moveable";
import {
  APP_NAME,
  formatToolName,
  getFriendlyPlanResultCopy,
  getFriendlySlicebugStatusCopy,
} from "./onboarding-copy";
import {
  type KindCutProjectFile,
  type WorkspaceTool,
  DEFAULT_TOOLS,
  buildProjectFile,
  parseProjectFile,
  serializeProjectFile,
} from "./project-file";
import { formatFileSize, getFriendlySvgMessages, getSvgSizeCopy, getSvgSizeInfo } from "./svg-import";
import {
  type WorkspaceObject,
  type WorkspacePathData,
  type WorkspaceSvgItem,
  type WorkspaceTextContent,
  buildWorkspaceObjectsSvg,
  buildWorkspaceObjectSvg,
  buildWorkspaceCutSvg,
  buildTextContentSvg,
  cloneWorkspaceObjects,
  getWorkspaceObjectPartCount,
} from "./workspace-objects";
import { extractWorkspacePathsFromSvg } from "./workspace-svg-import";
import {
  type WorkspaceClipboardSvgItem,
  createPastedWorkspaceSvgInputs,
  getSelectedWorkspaceClipboardItems,
} from "./workspace-clipboard";
import {
  LANGUAGES,
  type Language,
  createTranslator,
  getMatBeginnerCopy,
  getMatName,
  getMaterialBeginnerCopy,
  getMaterialName,
  loadLanguagePreference,
  saveLanguagePreference,
  translateValidationMessage,
} from "./i18n";
import {
  type MeasurementUnit,
  type Point,
  type WorkspaceItemTransform,
  getMatDimensionsInches,
  getMeasurementTicks,
  getViewportTransform,
  getWorkspaceItemTransform,
  getWorkspaceItemVisualSize,
  getWorkspaceSelectionBounds,
  normalizeWorkspaceItemTransform,
  rotatePoint,
  rotateWorkspaceItemTransformAroundPoint,
  scaleWorkspaceItemTransformFromAnchor,
} from "./workspace-utils";
import {
  WORKSPACE_SHAPES,
  type WorkspaceShapeKind,
  buildWorkspaceShapePathObject,
  getWorkspaceShapeDefinition,
} from "./workspace-shapes";
import { createWorkspaceGroup, ungroupWorkspaceObject } from "./workspace-grouping";
import {
  type AiProgressStep,
  type AiProvider,
  type AiProviderSettings,
  type AiSvgInput,
  type OpenAiImageModel,
  generateAiSvg,
  hasActiveApiKey,
  loadAiSettings,
  saveAiSettings,
} from "./ai-svg-generate";

type LibraryImage = { name: string; path: string; isAi: boolean; svg: string };

type SlicebugStatus = {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
};

type SlicebugPlanResult = {
  ok: boolean;
  executable: string;
  inputSvgPath: string;
  outputPlanPath: string;
  stdout: string;
  stderr: string;
  message: string;
  plan: null | {
    mat: { width: number; height: number };
    material: { width: number; height: number; type: number };
    pathCount: number;
    tools: string[];
  };
};

type CutSessionSnapshot = {
  id: string;
  status: "idle" | "running" | "waiting" | "finished" | "error" | "stopped" | "blocked";
  action: {
    kind: string;
    title: string;
    message: string;
    requiresContinue: boolean;
    canStop: boolean;
    tone: "neutral" | "waiting" | "running" | "success" | "error";
  };
  transcript: string;
  command: string;
  args: string[];
  planPath: string;
};

type WorkspaceHistorySnapshot = {
  importedSvgs: WorkspaceSvgItem[];
  selectedSvgId: string | null;
  selectedSvgIds: string[];
};

type AppScreen = "welcome" | "workspace";

type DesktopActionPayload = {
  action:
    | "new-project"
    | "open-project"
    | "save-project"
    | "example-project"
    | "set-language"
    | "edit-cut"
    | "edit-copy"
    | "edit-paste"
    | "edit-delete"
    | "edit-select-all"
    | "edit-undo"
    | "edit-redo"
    | "edit-group"
    | "edit-ungroup"
    | "edit-flip-x"
    | "edit-flip-y";
  value?: string;
};

const sampleProject = buildBeginnerProject({
  name: "Dog birthday card",
  machine: "cricut_joy",
  mat: joyStandardMat,
  materialId: 218,
  prompt: "Create a cute dog birthday card with black pen details and a red cut border.",
});

const validation = validateProject(sampleProject);
const prompt = createDesignPrompt(sampleProject);
const preflight = preflightSvg(`<svg width="288" height="240"><path d="M 10 10 L 40 40" stroke="#000" fill="none" /></svg>`);
const planCommand = buildPlanCommand({
  slicebugExecutable: "slicebug",
  inputSvgPath: "examples/dog-card.svg",
  outputPlanPath: "examples/dog-card.json",
  materialId: sampleProject.material.id,
  matPreset: "joy-standard",
  colorMap: {
    "000000": "pen",
    ff0000: "fine_point_blade",
  },
});

export function App() {
  const [screen, setScreen] = useState<AppScreen>("welcome");
  const [language, setLanguage] = useState<Language>(() => loadLanguagePreference());
  const [slicebugStatus, setSlicebugStatus] = useState<SlicebugStatus | null>(null);
  const [slicebugLoading, setSlicebugLoading] = useState(false);
  const [samplePlan, setSamplePlan] = useState<SlicebugPlanResult | null>(null);
  const [samplePlanLoading, setSamplePlanLoading] = useState(false);
  const [importedSvgs, setImportedSvgs] = useState<WorkspaceSvgItem[]>([]);
  const [selectedSvgId, setSelectedSvgId] = useState<string | null>(null);
  const [selectedSvgIds, setSelectedSvgIds] = useState<string[]>([]);
  const [workspaceHistory, setWorkspaceHistory] = useState<{ past: WorkspaceHistorySnapshot[]; future: WorkspaceHistorySnapshot[] }>({
    past: [],
    future: [],
  });
  const [clipboardHasItems, setClipboardHasItems] = useState(false);
  const workspaceClipboard = useRef<WorkspaceClipboardSvgItem[]>([]);
  const lastWorkspaceContextMenuAt = useRef(0);
  const lastWorkspaceContextSelectionCount = useRef<number | null>(null);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectOpening, setProjectOpening] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState(218);
  const [selectedMatPreset, setSelectedMatPreset] = useState("joy-standard");
  const [tools, setTools] = useState<WorkspaceTool[]>(DEFAULT_TOOLS);
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>(() => loadMeasurementUnitPreference());
  const [importedPlan, setImportedPlan] = useState<SlicebugPlanResult | null>(null);
  const [importedPlanLoading, setImportedPlanLoading] = useState(false);
  const [cutPreview, setCutPreview] = useState<{ plan: SlicebugPlanResult; svg: string; matPreset: string } | null>(null);
  const [cutSession, setCutSession] = useState<CutSessionSnapshot | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiProviderSettings>(() => loadAiSettings());
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [imageLibrary, setImageLibrary] = useState<LibraryImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const { t } = useMemo(() => createTranslator(language), [language]);
  const importedSvg = useMemo(
    () => importedSvgs.find((item) => item.id === selectedSvgId) ?? importedSvgs[0] ?? null,
    [importedSvgs, selectedSvgId],
  );

  const statusCopy = useMemo(
    () => getFriendlySlicebugStatusCopy(slicebugStatus, slicebugLoading, language),
    [language, slicebugLoading, slicebugStatus],
  );

  async function loadImageLibrary() {
    if (!window.cricutCompanion?.imageLibrary) {
      console.warn("[ImageLibrary] IPC bridge not available — shell may need rebuilding");
      return;
    }
    setLibraryLoading(true);
    try {
      const items = await window.cricutCompanion.imageLibrary.list();
      setImageLibrary(items ?? []);
    } catch (err) {
      console.error("[ImageLibrary] Failed to list library:", err);
    } finally {
      setLibraryLoading(false);
    }
  }

  async function saveToLibrary(name: string, svg: string, isAi: boolean): Promise<void> {
    if (!window.cricutCompanion?.imageLibrary) {
      console.warn("[ImageLibrary] IPC bridge not available — shell may need rebuilding");
      return;
    }
    try {
      const savedPath = await window.cricutCompanion.imageLibrary.save({ name, svg, isAi });
      console.log("[ImageLibrary] Saved:", savedPath);
    } catch (err) {
      console.error("[ImageLibrary] Failed to save:", err);
    }
  }

  async function deleteFromLibrary(filePath: string): Promise<void> {
    await window.cricutCompanion?.imageLibrary?.delete(filePath);
    setImageLibrary((prev) => prev.filter((img) => img.path !== filePath));
  }

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguagePreference(window.localStorage, nextLanguage);
  }

  function selectSingleSvg(id: string | null) {
    setSelectedSvgId(id);
    setSelectedSvgIds(id ? [id] : []);
  }

  function selectSvgGroup(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => importedSvgs.some((item) => item.id === id));
    setSelectedSvgIds(uniqueIds);
    setSelectedSvgId(uniqueIds.at(-1) ?? null);
  }

  function createWorkspaceHistorySnapshot(): WorkspaceHistorySnapshot {
    return {
      importedSvgs: cloneWorkspaceSvgItems(importedSvgs),
      selectedSvgId,
      selectedSvgIds: [...selectedSvgIds],
    };
  }

  function pushWorkspaceHistorySnapshot(snapshot = createWorkspaceHistorySnapshot()) {
    setWorkspaceHistory((current) => ({
      past: [...current.past, snapshot].slice(-WORKSPACE_HISTORY_LIMIT),
      future: [],
    }));
  }

  function resetWorkspaceHistory() {
    setWorkspaceHistory({ past: [], future: [] });
  }

  function restoreWorkspaceHistorySnapshot(snapshot: WorkspaceHistorySnapshot) {
    setImportedSvgs(cloneWorkspaceSvgItems(snapshot.importedSvgs));
    setSelectedSvgId(snapshot.selectedSvgId);
    setSelectedSvgIds([...snapshot.selectedSvgIds]);
    setImportedPlan(null);
    setCutSession(null);
  }

  function handleUndoWorkspace(): boolean {
    const previous = workspaceHistory.past.at(-1);
    if (!previous) {
      return false;
    }
    const currentSnapshot = createWorkspaceHistorySnapshot();
    setWorkspaceHistory((current) => ({
      past: current.past.slice(0, -1),
      future: [currentSnapshot, ...current.future].slice(0, WORKSPACE_HISTORY_LIMIT),
    }));
    restoreWorkspaceHistorySnapshot(previous);
    return true;
  }

  function handleRedoWorkspace(): boolean {
    const next = workspaceHistory.future[0];
    if (!next) {
      return false;
    }
    const currentSnapshot = createWorkspaceHistorySnapshot();
    setWorkspaceHistory((current) => ({
      past: [...current.past, currentSnapshot].slice(-WORKSPACE_HISTORY_LIMIT),
      future: current.future.slice(1),
    }));
    restoreWorkspaceHistorySnapshot(next);
    return true;
  }

  function enterWorkspace() {
    setScreen("workspace");
  }

  function handleNewProject() {
    resetWorkspaceHistory();
    setImportedSvgs([]);
    setSelectedSvgId(null);
    setSelectedSvgIds([]);
    setImportedPlan(null);
    setSamplePlan(null);
    setImportMessage(null);
    setProjectMessage(null);
    setCurrentProjectPath(null);
    setCutSession(null);
    enterWorkspace();
  }

  async function handleOpenProject() {
    if (!window.cricutCompanion?.project) {
      setProjectMessage(t("project.openInDesktop"));
      enterWorkspace();
      return;
    }

    setProjectOpening(true);
    try {
      const result = await window.cricutCompanion.project.open();
      if (result.canceled) {
        return;
      }
      if (!result.content) {
        throw new Error(t("project.openEmpty"));
      }
      applyProjectFile(parseProjectFile(result.content), result.path);
      setProjectMessage(t("project.opened", { path: result.path }));
      enterWorkspace();
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : t("project.openError"));
      enterWorkspace();
    } finally {
      setProjectOpening(false);
    }
  }

  async function handleSaveProject() {
    if (!window.cricutCompanion?.project) {
      setProjectMessage(t("project.saveInDesktop"));
      enterWorkspace();
      return;
    }

    const projectFile = createCurrentProjectFile();
    setProjectSaving(true);
    try {
      const result = await window.cricutCompanion.project.save({
        content: serializeProjectFile(projectFile),
        defaultFileName: `${getSafeProjectFileName(projectFile.name)}.kindcut`,
        currentPath: currentProjectPath,
      });
      if (result.canceled) {
        return;
      }
      setCurrentProjectPath(result.path);
      setProjectMessage(t("project.saved", { path: result.path }));
      enterWorkspace();
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : t("project.saveError"));
      enterWorkspace();
    } finally {
      setProjectSaving(false);
    }
  }

  function createCurrentProjectFile(): KindCutProjectFile {
    return buildProjectFile({
      name: importedSvg?.fileName ?? (language === "nl" ? "Nieuw leeg ontwerp" : "New blank design"),
      selectedMaterialId,
      selectedMatPreset,
      measurementUnit,
      tools,
      importedSvg: null,
      importedSvgs: [],
      workspaceObjects: importedSvgs.map((item) => ({
        id: item.id,
        type: item.type,
        kind: item.kind,
        sourceKind: item.sourceKind,
        shapeKind: item.shapeKind,
        fileName: item.fileName,
        fileSize: item.fileSize,
        frame: item.frame,
        paths: item.paths,
        transform: item.transform,
        textContent: item.textContent,
      })),
      selectedObjectId: selectedSvgId,
      selectedSvgId: null,
    });
  }

  function applyProjectFile(projectFile: KindCutProjectFile, projectPath: string) {
    setSelectedMaterialId(projectFile.workspace.selectedMaterialId);
    setSelectedMatPreset(projectFile.workspace.selectedMatPreset);
    setMeasurementUnit(projectFile.workspace.measurementUnit);
    setTools(projectFile.workspace.tools);
    saveMeasurementUnitPreference(projectFile.workspace.measurementUnit);
    setCurrentProjectPath(projectPath);
    setImportedPlan(null);
    setSamplePlan(null);
    setCutSession(null);
    setImportMessage(null);

    const restoredItems = projectFile.workspaceObjects.map((item, index) => {
      const base = createWorkspaceObjectItem({
        id: item.id ?? `svg-${index + 1}`,
        type: item.type,
        kind: item.kind ?? "image",
        sourceKind: item.sourceKind ?? item.kind ?? "image",
        shapeKind: item.shapeKind,
        fileName: item.fileName,
        fileSize: item.fileSize,
        frame: item.frame,
        paths: item.paths,
        language,
        index,
        transform: item.transform,
      });
      if (item.textContent) base.textContent = item.textContent;
      return base;
    });
    setImportedSvgs(restoredItems);
    const restoredSelectedId = projectFile.selectedObjectId ?? projectFile.selectedSvgId ?? restoredItems[0]?.id ?? null;
    setSelectedSvgId(restoredSelectedId);
    setSelectedSvgIds(restoredSelectedId ? [restoredSelectedId] : []);
    resetWorkspaceHistory();
  }

  function handleSelectAllSvgs() {
    selectSvgGroup(importedSvgs.map((item) => item.id));
  }

  function handleCopySvgs(): boolean {
    const copiedItems = getSelectedWorkspaceClipboardItems(importedSvgs, selectedSvgIds, selectedSvgId);
    if (copiedItems.length === 0) {
      return false;
    }
    workspaceClipboard.current = copiedItems;
    setClipboardHasItems(true);
    return true;
  }

  function handlePasteSvgs(): boolean {
    if (workspaceClipboard.current.length === 0) {
      return false;
    }
    const pastedInputs = createPastedWorkspaceSvgInputs({
      items: workspaceClipboard.current,
      startIndex: importedSvgs.length,
      timestamp: Date.now(),
    });
    const pastedItems = pastedInputs.map((item) =>
      createWorkspaceObjectItem({
        id: item.id,
        type: item.type,
        kind: item.kind ?? "image",
        sourceKind: item.sourceKind ?? item.kind ?? "image",
        shapeKind: item.shapeKind,
        fileName: item.fileName,
        fileSize: item.fileSize,
        frame: item.frame,
        paths: item.paths,
        language,
        index: item.index,
        transform: item.transform,
      }),
    );
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current, ...pastedItems]);
    const pastedIds = pastedItems.map((item) => item.id);
    setSelectedSvgId(pastedIds.at(-1) ?? null);
    setSelectedSvgIds(pastedIds);
    setImportedPlan(null);
    setCutSession(null);
    return true;
  }

  function handleDeleteSvgs(): boolean {
    const idsToDelete = new Set(selectedSvgIds.length > 0 ? selectedSvgIds : selectedSvgId ? [selectedSvgId] : []);
    if (idsToDelete.size === 0) {
      return false;
    }
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => current.filter((item) => !idsToDelete.has(item.id)));
    setSelectedSvgId(null);
    setSelectedSvgIds([]);
    setImportedPlan(null);
    setCutSession(null);
    return true;
  }

  function handleGroupSvgs(): boolean {
    const idsToGroup = selectedSvgIds.filter((id) => importedSvgs.some((item) => item.id === id));
    if (idsToGroup.length < 2) {
      return false;
    }
    const selectedSet = new Set(idsToGroup);
    const selectedObjects = importedSvgs.filter((item) => selectedSet.has(item.id));
    const partCount = selectedObjects.reduce((total, item) => total + item.paths.length, 0);
    const groupItem = createWorkspaceGroup({
      id: `group-${Date.now()}`,
      items: selectedObjects,
      label: language === "nl" ? "Groep" : "Group",
      fileSize: language === "nl" ? `${partCount} onderdelen` : `${partCount} parts`,
    });
    if (!groupItem) {
      return false;
    }
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current.filter((item) => !selectedSet.has(item.id)), groupItem]);
    setSelectedSvgId(groupItem.id);
    setSelectedSvgIds([groupItem.id]);
    setImportedPlan(null);
    setCutSession(null);
    return true;
  }

  function handleFlipX(): boolean {
    if (selectedSvgIds.length === 0) return false;
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) =>
      current.map((item) => {
        if (!selectedSvgIds.includes(item.id)) return item;
        const newMirrorX = !item.transform.mirrorX;
        // transform-origin: top left → scale(-1,1) mirrors around left edge.
        // Compensate by +W (enabling mirror) or -W (disabling) rotated to item's axis.
        const W = item.frame.width * item.transform.scaleX;
        const rawOffset = { x: newMirrorX ? W : -W, y: 0 };
        const offset = rotatePoint(rawOffset, item.transform.rotation);
        return {
          ...item,
          transform: { ...item.transform, mirrorX: newMirrorX, x: item.transform.x + offset.x, y: item.transform.y + offset.y },
        };
      }),
    );
    return true;
  }

  function handleFlipY(): boolean {
    if (selectedSvgIds.length === 0) return false;
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) =>
      current.map((item) => {
        if (!selectedSvgIds.includes(item.id)) return item;
        const newMirrorY = !item.transform.mirrorY;
        const H = item.frame.height * item.transform.scaleY;
        const rawOffset = { x: 0, y: newMirrorY ? H : -H };
        const offset = rotatePoint(rawOffset, item.transform.rotation);
        return {
          ...item,
          transform: { ...item.transform, mirrorY: newMirrorY, x: item.transform.x + offset.x, y: item.transform.y + offset.y },
        };
      }),
    );
    return true;
  }

  function handleUngroupSvg(): boolean {
    const group = importedSvgs.find((item) => item.id === selectedSvgId && item.type === "group");
    if (!group) {
      return false;
    }
    const rawChildren = ungroupWorkspaceObject({
      group,
      idPrefix: `${group.id}-part-${Date.now()}`,
      labelForIndex: (index) => language === "nl" ? `${group.fileName} onderdeel ${index + 1}` : `${group.fileName} part ${index + 1}`,
    });
    const children = rawChildren.map((child) => reframeUngroupedChild(child, group.transform));
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => current.flatMap((item) => (item.id === group.id ? children : [item])));
    const childIds = children.map((item) => item.id);
    setSelectedSvgId(childIds.at(-1) ?? null);
    setSelectedSvgIds(childIds);
    setImportedPlan(null);
    setCutSession(null);
    return true;
  }

  function handleAddWorkspaceShape(shapeKind: WorkspaceShapeKind) {
    const item = createWorkspaceShapeItem({
      shapeKind,
      language,
      index: importedSvgs.length,
      timestamp: Date.now(),
    });
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current, item]);
    setSelectedSvgId(item.id);
    setSelectedSvgIds([item.id]);
    setImportMessage(null);
    setImportedPlan(null);
    setCutSession(null);
  }

  // Step 1: Generate only — returns normalised SVG, does NOT import yet
  async function handleGenerateAiDesign(input: Omit<AiSvgInput, "settings">): Promise<string> {
    const rawSvg = await generateAiSvg({ ...input, settings: aiSettings, language });
    return normalizeAiSvg(rawSvg);
  }

  // Step 2: Import — called after user clicks "Import" in the modal
  async function handleImportAiDesign(svg: string, prompt: string): Promise<void> {
    const name = prompt.slice(0, 40);
    await saveToLibrary(name, svg, true);
    await loadImageLibrary();
    addSvgToWorkspace(name, svg);
  }

  function addSvgToWorkspace(name: string, svg: string, normalizeFirst = false): void {
    const finalSvg = normalizeFirst ? normalizeAiSvg(svg) : svg;
    const item = createWorkspaceSvgItem({
      id: `svg-${Date.now()}`,
      kind: "image",
      fileName: name,
      fileSize: "",
      svg: finalSvg,
      language,
      index: importedSvgs.length,
    });
    // Cap to 4 inches max on the longest side
    const MAX_PX = 4 * WORKSPACE_PIXELS_PER_INCH;
    const longest = Math.max(item.frame.width, item.frame.height);
    if (longest > MAX_PX) {
      const scale = MAX_PX / longest;
      item.transform.scaleX = scale;
      item.transform.scaleY = scale;
    }
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current, item]);
    setSelectedSvgId(item.id);
    setSelectedSvgIds([item.id]);
    setImportedPlan(null);
    setCutSession(null);
  }

  // ── Text ────────────────────────────────────────────────────────────────────

  function measureTextFrame(tc: WorkspaceTextContent): { width: number; height: number } {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${tc.fontStyle} ${tc.fontWeight} ${tc.fontSize}px ${tc.fontFamily}`;
    const lines = tc.text.split("\n");
    const lineH = tc.fontSize * tc.lineHeight;
    const maxW = Math.max(
      10,
      ...lines.map((l) => {
        const chars = [...l];
        if (chars.length === 0) return 0;
        return chars.reduce((w, c) => w + ctx.measureText(c).width, 0) + Math.max(0, chars.length - 1) * tc.letterSpacing;
      }),
    );
    return { width: Math.ceil(maxW) + 2, height: Math.ceil(lineH * lines.length) + 2 };
  }

  function renderTextToCanvas(tc: WorkspaceTextContent): string {
    // Render text at 3× scale for clean Potrace input, return base64 PNG
    const SCALE = 3;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const fontStr = `${tc.fontStyle === "italic" ? "italic " : ""}${tc.fontWeight === "bold" ? "bold " : ""}${tc.fontSize * SCALE}px ${tc.fontFamily}`;
    ctx.font = fontStr;
    const lines = tc.text.split("\n");
    const lineH = tc.fontSize * SCALE * tc.lineHeight;
    const widths = lines.map((l) => {
      const chars = [...l];
      if (!chars.length) return 0;
      return chars.reduce((w, c) => w + ctx.measureText(c).width, 0) + Math.max(0, chars.length - 1) * tc.letterSpacing * SCALE;
    });
    const maxW = Math.max(10, ...widths);
    const PAD = 8 * SCALE;
    canvas.width = Math.ceil(maxW) + PAD * 2;
    canvas.height = Math.ceil(lineH * lines.length) + PAD * 2;
    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Re-set font after resize
    ctx.font = fontStr;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      const y = PAD + i * lineH;
      const lineW = widths[i] ?? 0;
      const xStart = tc.textAlign === "center"
        ? (canvas.width - lineW) / 2
        : tc.textAlign === "right"
          ? canvas.width - PAD - lineW
          : PAD;
      let x = xStart;
      for (const char of [...line]) {
        ctx.fillText(char, x, y);
        x += ctx.measureText(char).width + tc.letterSpacing * SCALE;
      }
      if (tc.textDecoration === "underline") {
        const ulY = y + tc.fontSize * SCALE + 2 * SCALE;
        ctx.fillRect(xStart, ulY, lineW, Math.max(2, tc.fontSize * SCALE * 0.06));
      }
    });
    return canvas.toDataURL("image/png").replace("data:image/png;base64,", "");
  }

  async function resolveTextItemsForCutting(items: WorkspaceSvgItem[]): Promise<WorkspaceSvgItem[]> {
    // Convert any text items (no paths) to path-based items via canvas → Potrace
    return Promise.all(items.map(async (item) => {
      if (!item.textContent || item.paths.length > 0) return item;
      try {
        const pngBase64 = renderTextToCanvas(item.textContent);
        const rawSvg = await window.cricutCompanion?.ai?.tracePngToSvg(pngBase64);
        if (!rawSvg) return item;
        const svg = normalizeAiSvg(rawSvg);
        const extracted = extractWorkspacePathsFromSvg(svg);
        // The canvas was rendered at 3× scale, so Potrace paths are 3× too large.
        // Scale them back down to fit the original text item frame.
        const scaleX = item.frame.width / extracted.frame.width;
        const scaleY = item.frame.height / extracted.frame.height;
        const color = item.textContent.color;
        const paths = extracted.paths.map((p) => ({
          ...p,
          stroke: color,
          fill: color,
          // Prepend the scale-down transform; preserve any existing pathTransform
          pathTransform: p.pathTransform
            ? `scale(${scaleX} ${scaleY}) ${p.pathTransform}`
            : `scale(${scaleX} ${scaleY})`,
        }));
        return {
          ...item,
          // Keep original frame — the scale transform brings paths into that space
          paths: paths as unknown as [WorkspacePathData],
        };
      } catch {
        return item; // fall back to text element if tracing fails
      }
    }));
  }

  function createTextItem(tc: WorkspaceTextContent, index: number, existingId?: string): WorkspaceSvgItem {
    const frame = measureTextFrame(tc);
    const id = existingId ?? `text-${Date.now()}`;
    return {
      id,
      kind: "text",
      sourceKind: "text",
      fileName: tc.text.slice(0, 30) || "Text",
      fileSize: "",
      sizeCopy: "",
      frame,
      transform: { x: 40 + index * 20, y: 40 + index * 20, scaleX: 1, scaleY: 1, rotation: 0 },
      type: "path",
      paths: [] as unknown as [WorkspacePathData],
      textContent: tc,
    } satisfies WorkspaceSvgItem;
  }

  function handleAddText() {
    const defaultContent: WorkspaceTextContent = {
      text: language === "nl" ? "Tekst" : "Text",
      fontFamily: "sans-serif",
      fontSize: 48,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      textAlign: "left",
      letterSpacing: 0,
      lineHeight: 1.25,
      color: "#000000",
    };
    const item = createTextItem(defaultContent, importedSvgs.length);
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current, item]);
    setSelectedSvgId(item.id);
    setSelectedSvgIds([item.id]);
    setEditingTextId(item.id);
    setImportedPlan(null);
  }

  function handleTextContentChange(id: string, patch: Partial<WorkspaceTextContent>) {
    setImportedSvgs((current) =>
      current.map((item) => {
        if (item.id !== id || !item.textContent) return item;
        const newContent = { ...item.textContent, ...patch };
        const frame = measureTextFrame(newContent);
        return { ...item, textContent: newContent, frame, paths: [] as unknown as [WorkspacePathData] };
      }),
    );
  }

  function commitTextEdit(id: string) {
    setEditingTextId(null);
    // Re-snapshot so undo captures the committed text
    pushWorkspaceHistorySnapshot();
  }

  // ── End text ─────────────────────────────────────────────────────────────────

  function handleCutSvgs(): boolean {
    if (!handleCopySvgs()) {
      return false;
    }
    return handleDeleteSvgs();
  }

  function handleRenameObject(id: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setImportedSvgs((current) => current.map((item) => item.id === id ? { ...item, fileName: trimmed } : item));
  }

  function handleChangeObjectColor(id: string, color: string) {
    setImportedSvgs((current) =>
      current.map((item): WorkspaceObject => {
        if (item.id !== id) return item;
        if (item.type === "path") {
          return { ...item, paths: [{ ...item.paths[0], stroke: color }] };
        }
        return { ...item, paths: item.paths.map((p) => ({ ...p, stroke: color })) };
      }),
    );
  }

  function markWorkspaceContextMenuTarget(selectedObjectCount?: number) {
    lastWorkspaceContextMenuAt.current = Date.now();
    lastWorkspaceContextSelectionCount.current = selectedObjectCount ?? null;
  }

  async function handleExampleProject() {
    enterWorkspace();
    await generateSamplePlan();
  }

  function handleDesktopAction(payload: DesktopActionPayload) {
    if (
      payload.action.startsWith("edit-") &&
      isEditableKeyboardTarget(document.activeElement)
    ) {
      // Electron intercepted the shortcut before the input got it — forward it manually.
      switch (payload.action) {
        case "edit-copy": document.execCommand("copy"); break;
        case "edit-cut": document.execCommand("cut"); break;
        case "edit-paste": document.execCommand("paste"); break;
        case "edit-select-all": (document.activeElement as HTMLInputElement | HTMLTextAreaElement).select?.(); break;
      }
      return;
    }
    switch (payload.action) {
      case "new-project":
        handleNewProject();
        break;
      case "open-project":
        void handleOpenProject();
        break;
      case "save-project":
        void handleSaveProject();
        break;
      case "example-project":
        void handleExampleProject();
        break;
      case "set-language":
        if (payload.value === "nl" || payload.value === "en") {
          handleLanguageChange(payload.value);
        }
        break;
      case "edit-select-all":
        handleSelectAllSvgs();
        break;
      case "edit-undo":
        handleUndoWorkspace();
        break;
      case "edit-redo":
        handleRedoWorkspace();
        break;
      case "edit-copy":
        handleCopySvgs();
        break;
      case "edit-paste":
        handlePasteSvgs();
        break;
      case "edit-cut":
        handleCutSvgs();
        break;
      case "edit-delete":
        handleDeleteSvgs();
        break;
      case "edit-group":
        handleGroupSvgs();
        break;
      case "edit-ungroup":
        handleUngroupSvg();
        break;
      case "edit-flip-x":
        handleFlipX();
        break;
      case "edit-flip-y":
        handleFlipY();
        break;
    }
  }

  async function refreshSlicebugStatus() {
    if (!window.cricutCompanion?.slicebug) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message:
          language === "nl"
            ? "Open dit scherm in de Electron-desktopapp om SliceBug te gebruiken."
            : "Open this screen in the Electron desktop shell to call SliceBug.",
      });
      return;
    }

    setSlicebugLoading(true);
    try {
      setSlicebugStatus(await window.cricutCompanion.slicebug.getStatus());
    } catch (error) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message:
          error instanceof Error
            ? error.message
            : language === "nl"
              ? "Onbekende SliceBug-fout."
              : "Unknown SliceBug error.",
      });
    } finally {
      setSlicebugLoading(false);
    }
  }

  async function generateSamplePlan() {
    if (!window.cricutCompanion?.slicebug) {
      setSamplePlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message:
          language === "nl"
            ? "Open dit scherm in de Electron-desktopapp om een SliceBug-plan te maken."
            : "Open this screen in the Electron desktop shell to generate a SliceBug plan.",
        plan: null,
      });
      return;
    }

    setSamplePlanLoading(true);
    try {
      setSamplePlan(
        await window.cricutCompanion.slicebug.generateSamplePlan({
          materialId: selectedMaterialId,
          matPreset: selectedMatPreset,
        }),
      );
    } catch (error) {
      setSamplePlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message:
          error instanceof Error
            ? error.message
            : language === "nl"
              ? "Onbekende SliceBug-planfout."
              : "Unknown SliceBug plan error.",
        plan: null,
      });
    } finally {
      setSamplePlanLoading(false);
    }
  }

  async function prepareImportedPlan() {
    if (!importedSvg) {
      setImportMessage(t("import.chooseSvgFile"));
      return;
    }

    if (!window.cricutCompanion?.slicebug) {
      setImportedPlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message: t("import.openInShellPlan"),
        plan: null,
      });
      return;
    }

    setImportedPlanLoading(true);
    setImportedPlan(null);
    setCutSession(null);
    try {
      setImportedPlan(
        await window.cricutCompanion.slicebug.createPlan({
          svg: buildWorkspaceObjectsSvg(importedSvgs),
          fileName: importedSvg.fileName,
          materialId: selectedMaterialId,
          matPreset: selectedMatPreset,
        }),
      );
    } catch (error) {
      setImportedPlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message: error instanceof Error ? error.message : t("import.planError"),
        plan: null,
      });
    } finally {
      setImportedPlanLoading(false);
    }
  }

  function buildToolColorMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const tool of tools) {
      const hex = tool.color.replace(/^#/, "").toLowerCase();
      map[hex] = tool.type === "pen" ? "pen" : "fine_point_blade";
    }
    return map;
  }

  async function handleOpenCutPreview() {
    if (importedSvgs.length === 0) return;
    const matDims = getMatDimensionsInches(selectedMatPreset);
    const matW = matDims.width * WORKSPACE_PIXELS_PER_INCH;
    const matH = matDims.height * WORKSPACE_PIXELS_PER_INCH;
    // Convert any text items to traced paths so slicebug can cut them
    const resolvedItems = await resolveTextItemsForCutting(importedSvgs);
    const svg = buildWorkspaceCutSvg(resolvedItems, matW, matH, tools, WORKSPACE_PIXELS_PER_INCH);
    const colorMap = buildToolColorMap();

    if (!window.cricutCompanion?.slicebug) {
      setCutPreview({
        plan: { ok: false, executable: "", inputSvgPath: "", outputPlanPath: "", stdout: "", stderr: "", message: "Slicebug not available", plan: null },
        svg,
        matPreset: selectedMatPreset,
      });
      return;
    }

    setImportedPlanLoading(true);
    try {
      const plan = await window.cricutCompanion.slicebug.createPlan({
        svg,
        fileName: importedSvgs[0]?.fileName ?? "design",
        materialId: selectedMaterialId,
        matPreset: selectedMatPreset,
        colorMap,
      });
      setImportedPlan(plan);
      setCutPreview({ plan, svg, matPreset: selectedMatPreset });
    } catch (error) {
      const plan: SlicebugPlanResult = { ok: false, executable: "", inputSvgPath: "", outputPlanPath: "", stdout: "", stderr: "", message: error instanceof Error ? error.message : "Plan failed", plan: null };
      setCutPreview({ plan, svg, matPreset: selectedMatPreset });
    } finally {
      setImportedPlanLoading(false);
    }
  }

  async function startCutSession(planPath: string) {
    if (!window.cricutCompanion?.slicebug) {
      return;
    }
    setCutBusy(true);
    try {
      setCutSession(await window.cricutCompanion.slicebug.startCutSession(planPath));
    } finally {
      setCutBusy(false);
    }
  }

  async function continueCutSession() {
    if (!window.cricutCompanion?.slicebug) {
      return;
    }
    setCutBusy(true);
    try {
      setCutSession(await window.cricutCompanion.slicebug.continueCutSession());
    } finally {
      setCutBusy(false);
    }
  }

  async function stopCutSession() {
    if (!window.cricutCompanion?.slicebug) {
      return;
    }
    setCutBusy(true);
    try {
      setCutSession(await window.cricutCompanion.slicebug.stopCutSession());
    } finally {
      setCutBusy(false);
    }
  }

  async function handleSvgFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setImportMessage(null);
    setProjectMessage(null);

    const svgFiles = files.filter((file) => file.name.toLowerCase().endsWith(".svg"));
    if (svgFiles.length === 0) {
      setImportMessage(t("import.invalidSvg"));
      event.target.value = "";
      return;
    }

    try {
      const startIndex = importedSvgs.length;
      const loaded = await Promise.all(svgFiles.map(async (file) => ({ file, svg: await file.text() })));
      // Save each to library (fire-and-forget, non-fatal)
      void Promise.all(loaded.map(({ file, svg }) => saveToLibrary(file.name.replace(/\.svg$/i, ""), svg, false)))
        .then(() => loadImageLibrary());
      const newItems = loaded.map(({ file, svg }, fileIndex) =>
        createWorkspaceSvgItem({
          id: `svg-${Date.now()}-${startIndex + fileIndex}`,
          fileName: file.name,
          fileSize: formatFileSize(file.size),
          svg,
          language,
          index: startIndex + fileIndex,
        }),
      );
      pushWorkspaceHistorySnapshot();
      setImportedSvgs((current) => [...current, ...newItems]);
      const newSelectedIds = newItems.map((item) => item.id);
      setSelectedSvgId(newSelectedIds.at(-1) ?? null);
      setSelectedSvgIds(newSelectedIds);
      if (svgFiles.length !== files.length) {
        setImportMessage(t("import.invalidSvg"));
      }
      setImportedPlan(null);
      setCutSession(null);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : t("import.openError"));
    }
    event.target.value = "";
  }

  function handleSvgTransformsCommit(updates: Array<{ id: string; transform: WorkspaceItemTransform }>) {
    const transformById = new Map(updates.map((update) => [update.id, normalizeWorkspaceItemTransform(update.transform)]));
    const hasChanges = importedSvgs.some((item) => {
      const transform = transformById.get(item.id);
      return transform ? !workspaceTransformsEqual(item.transform, transform) : false;
    });
    if (!hasChanges) {
      return;
    }
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) =>
      current.map((item) => {
        const transform = transformById.get(item.id);
        return transform ? { ...item, transform } : item;
      }),
    );
  }

  useEffect(() => {
    void refreshSlicebugStatus();
    void loadImageLibrary();
  }, []);

  useEffect(() => window.cricutCompanion?.onAppAction?.(handleDesktopAction));

  useEffect(() => {
    return window.cricutCompanion?.workspaceEditState?.setProvider(() => {
      const selCount = lastWorkspaceContextSelectionCount.current ?? selectedSvgIds.length;
      const selectedSet = new Set(selectedSvgIds);
      const selectedObjects = importedSvgs.filter((item) => selectedSet.has(item.id));
      return {
        isWorkspaceContextTarget: screen === "workspace" && Date.now() - lastWorkspaceContextMenuAt.current < 500,
        selectedObjectCount: selCount,
        objectCount: importedSvgs.length,
        hasInternalClipboard: workspaceClipboard.current.length > 0,
        canGroup: selCount >= 2,
        canUngroup: selectedObjects.some((item) => item.type === "group"),
      };
    });
  }, [importedSvgs, screen, selectedSvgIds]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = APP_NAME;
  }, [language]);

  useEffect(() => {
    function handleDocumentContextMenu(event: globalThis.MouseEvent) {
      lastWorkspaceContextMenuAt.current = (event.target as HTMLElement | null)?.closest(".viewport") ? Date.now() : 0;
      if (!lastWorkspaceContextMenuAt.current) {
        lastWorkspaceContextSelectionCount.current = null;
      }
    }

    document.addEventListener("contextmenu", handleDocumentContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleDocumentContextMenu, true);
  }, []);

  useEffect(() => {
    if (!window.cricutCompanion?.slicebug || !cutSession || !["running", "waiting"].includes(cutSession.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void window.cricutCompanion?.slicebug.getCutSession().then((snapshot) => {
        if (snapshot) {
          setCutSession(snapshot);
        }
      });
    }, 800);

    return () => window.clearInterval(timer);
  }, [cutSession]);

  if (screen === "welcome") {
    return (
      <WelcomeScreen
        language={language}
        statusCopy={statusCopy}
        statusDetailsLabel={t("details.advanced")}
        samplePlanLoading={samplePlanLoading}
        slicebugLoading={slicebugLoading}
        onLanguageChange={handleLanguageChange}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProject}
        onExampleProject={() => void handleExampleProject()}
        onCheckSetup={() => void refreshSlicebugStatus()}
      />
    );
  }

  return (
    <>
    <DesignWorkspace
      language={language}
      measurementUnit={measurementUnit}
      selectedMaterialId={selectedMaterialId}
      selectedMatPreset={selectedMatPreset}
      importedSvg={importedSvg}
      importedSvgs={importedSvgs}
      selectedSvgId={selectedSvgId}
      selectedSvgIds={selectedSvgIds}
      importedPlan={importedPlan}
      importedPlanLoading={importedPlanLoading}
      samplePlan={samplePlan}
      samplePlanLoading={samplePlanLoading}
      validationOk={validation.ok && preflight.ok}
      importMessage={importMessage}
      projectMessage={projectMessage}
      currentProjectPath={currentProjectPath}
      projectSaving={projectSaving}
      projectOpening={projectOpening}
      cutSession={cutSession}
      cutBusy={cutBusy}
      onBackWelcome={() => setScreen("welcome")}
      onMaterialChange={setSelectedMaterialId}
      onMatChange={setSelectedMatPreset}
      tools={tools}
      onToolsChange={setTools}
      onSvgFileChange={(event) => void handleSvgFileChange(event)}
      onAddShape={handleAddWorkspaceShape}
      onAddText={handleAddText}
      editingTextId={editingTextId}
      onEnterTextEdit={setEditingTextId}
      onExitTextEdit={commitTextEdit}
      onTextContentChange={handleTextContentChange}
      onSelectSvg={selectSingleSvg}
      onSelectSvgGroup={selectSvgGroup}
      onSelectAllSvgs={handleSelectAllSvgs}
      canPaste={clipboardHasItems}
      onCopySvgs={handleCopySvgs}
      onPasteSvgs={handlePasteSvgs}
      onCutSvgs={handleCutSvgs}
      onDeleteSvgs={handleDeleteSvgs}
      onGroupSvgs={handleGroupSvgs}
      onUngroupSvg={handleUngroupSvg}
      onFlipX={handleFlipX}
      onFlipY={handleFlipY}
      onRenameObject={handleRenameObject}
      onChangeObjectColor={handleChangeObjectColor}
      onUndoSvgs={handleUndoWorkspace}
      onRedoSvgs={handleRedoWorkspace}
      onWorkspaceContextMenu={markWorkspaceContextMenuTarget}
      onSvgTransformsCommit={handleSvgTransformsCommit}
      onPrepareImportedPlan={() => void prepareImportedPlan()}
      onOpenProject={() => void handleOpenProject()}
      onSaveProject={() => void handleSaveProject()}
      onGenerateSamplePlan={() => void generateSamplePlan()}
      onStartCut={() => void handleOpenCutPreview()}
      onContinueCut={() => void continueCutSession()}
      onStopCut={() => void stopCutSession()}
      hasActiveAiKey={hasActiveApiKey(aiSettings)}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenAiGenerate={() => setAiGenerateOpen(true)}
      onAiGenerateSvg={handleGenerateAiDesign}
      imageLibrary={imageLibrary}
      imageLibraryLoading={libraryLoading}
      onLoadImageLibrary={() => void loadImageLibrary()}
      onDeleteLibraryImage={(p) => void deleteFromLibrary(p)}
      onAddLibraryImageToWorkspace={(img) => addSvgToWorkspace(img.name, img.svg)}
    />
    {settingsOpen ? (
      <SettingsModal
        language={language}
        settings={aiSettings}
        onSave={(updated) => { saveAiSettings(updated); setAiSettings(updated); setSettingsOpen(false); }}
        onClose={() => setSettingsOpen(false)}
      />
    ) : null}
    {aiGenerateOpen ? (
      <AiGenerateModal
        language={language}
        hasApiKey={hasActiveApiKey(aiSettings)}
        onGenerate={handleGenerateAiDesign}
        onImport={(svg, prompt) => void handleImportAiDesign(svg, prompt)}
        onOpenSettings={() => { setAiGenerateOpen(false); setSettingsOpen(true); }}
        onClose={() => setAiGenerateOpen(false)}
      />
    ) : null}
    {cutPreview ? (
      <CutPreviewModal
        language={language}
        preview={cutPreview}
        cutBusy={cutBusy}
        cutSession={cutSession}
        onClose={() => setCutPreview(null)}
        onConfirmCut={() => {
          if (cutPreview.plan.outputPlanPath) {
            void startCutSession(cutPreview.plan.outputPlanPath);
          }
        }}
        onContinueCut={() => void continueCutSession()}
        onStopCut={() => { void stopCutSession(); setCutPreview(null); }}
      />
    ) : null}
    </>
  );
}


const MEASUREMENT_UNIT_STORAGE_KEY = "kindcutMeasurementUnit";
const WORKSPACE_PIXELS_PER_INCH = 80;
const WORKSPACE_MIN_ZOOM = 0.45;
const WORKSPACE_MAX_ZOOM = 3;
const WORKSPACE_STAGE_LEFT_OFFSET = 42; // width of the Y ruler
const WORKSPACE_STAGE_TOP_OFFSET = 32;  // height of the X ruler (statusbar handled by grid layout)
const WORKSPACE_HISTORY_LIMIT = 50;
const ROTATION_SNAP_INTERVAL_DEGREES = 45;
const ROTATION_SNAP_THRESHOLD_DEGREES = 4;
const MOVEABLE_CENTER_DIRECTION = [0, 0] as const;

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

/**
 * Computes the tight bounding box of all paths in a workspace item using DOM getBBox().
 * Shifts paths so content starts at (0,0) and adjusts the item's frame and position
 * so no visual change occurs — the bounding box just snugly wraps the actual content.
 */
function computeSnugFrame(item: WorkspaceSvgItem): WorkspaceSvgItem {
  if (item.textContent) return item;
  const validPaths = item.paths.filter((p) => p.d);
  if (validPaths.length === 0) return item;

  // Batch all paths into a single off-screen SVG for efficiency
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;overflow:visible";
  svg.setAttribute("viewBox", "0 0 100000 100000");
  document.body.appendChild(svg);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  try {
    for (const path of validPaths) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", path.d);
      if (path.pathTransform) el.setAttribute("transform", path.pathTransform);
      svg.appendChild(el);
      const bb = el.getBBox();
      if (bb.width > 0 || bb.height > 0) {
        minX = Math.min(minX, bb.x);
        minY = Math.min(minY, bb.y);
        maxX = Math.max(maxX, bb.x + bb.width);
        maxY = Math.max(maxY, bb.y + bb.height);
      }
    }
  } finally {
    document.body.removeChild(svg);
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return item;

  const newWidth = Math.max(1, maxX - minX);
  const newHeight = Math.max(1, maxY - minY);

  // Already snug — skip
  if (Math.abs(minX) < 0.5 && Math.abs(minY) < 0.5 &&
      Math.abs(newWidth - item.frame.width) < 0.5 &&
      Math.abs(newHeight - item.frame.height) < 0.5) {
    return item;
  }

  // Shift all paths so content begins at (0,0) in SVG coordinate space
  const needsShift = Math.abs(minX) >= 0.5 || Math.abs(minY) >= 0.5;
  const updatedPaths = validPaths.map((p) => ({
    ...p,
    pathTransform: needsShift
      ? (p.pathTransform
          ? `translate(${-minX} ${-minY}) ${p.pathTransform}`
          : `translate(${-minX} ${-minY})`)
      : p.pathTransform,
  }));

  // Adjust world-position so the object doesn't appear to move (handles rotation)
  const cropOffset = rotatePoint(
    { x: minX * item.transform.scaleX, y: minY * item.transform.scaleY },
    item.transform.rotation,
  );

  return {
    ...item,
    frame: { width: newWidth, height: newHeight },
    transform: { ...item.transform, x: item.transform.x + cropOffset.x, y: item.transform.y + cropOffset.y },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    paths: updatedPaths as any,
  } as WorkspaceSvgItem;
}

function createWorkspaceSvgItem({
  id,
  kind = "image",
  shapeKind,
  fileName,
  fileSize,
  svg,
  language,
  index,
  transform,
}: {
  id: string;
  kind?: "image" | "shape";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  svg: string;
  language: Language;
  index: number;
  transform?: WorkspaceItemTransform;
}): WorkspaceSvgItem {
  const extracted = extractWorkspacePathsFromSvg(svg);
  const sizeInfo = getSvgSizeInfo(svg);
  const base = {
    id,
    kind,
    sourceKind: kind,
    shapeKind,
    fileName,
    fileSize,
    sizeCopy: getSvgSizeCopy(sizeInfo, language),
    frame: extracted.frame,
    transform: transform ?? { x: 32 + index * 24, y: 32 + index * 24, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const item: WorkspaceSvgItem = extracted.paths.length === 1
    ? { ...base, type: "path", paths: [extracted.paths[0]!] }
    : { ...base, type: "group", paths: extracted.paths };
  return computeSnugFrame(item);
}

function createWorkspaceObjectItem({
  id,
  type,
  kind = "image",
  sourceKind,
  shapeKind,
  fileName,
  fileSize,
  frame,
  paths,
  language,
  index,
  transform,
}: {
  id: string;
  type: "path" | "group";
  kind?: "image" | "shape" | "text";
  sourceKind?: "image" | "shape" | "text";
  shapeKind?: WorkspaceShapeKind;
  fileName: string;
  fileSize: string;
  frame: { width: number; height: number };
  paths: WorkspaceObject["paths"];
  language: Language;
  index: number;
  transform?: WorkspaceItemTransform;
}): WorkspaceSvgItem {
  return {
    id,
    type,
    kind,
    sourceKind: sourceKind ?? kind,
    shapeKind,
    fileName,
    fileSize,
    sizeCopy: `${Math.round(frame.width)} × ${Math.round(frame.height)} px`,
    frame,
    paths: paths.map((path) => ({ ...path })) as WorkspaceObject["paths"],
    transform: transform ?? { x: 32 + index * 24, y: 32 + index * 24, scaleX: 1, scaleY: 1, rotation: 0 },
  } as WorkspaceSvgItem;
}

function createWorkspaceShapeItem({
  shapeKind,
  language,
  index,
  timestamp,
}: {
  shapeKind: WorkspaceShapeKind;
  language: Language;
  index: number;
  timestamp: number;
}): WorkspaceSvgItem {
  const definition = getWorkspaceShapeDefinition(shapeKind);
  const label = language === "nl" ? definition.labelNl : definition.labelEn;
  const shape = buildWorkspaceShapePathObject(shapeKind);
  return createWorkspaceObjectItem({
    id: `shape-${timestamp}-${index}`,
    type: "path",
    kind: "shape",
    sourceKind: "shape",
    shapeKind,
    fileName: label,
    fileSize: language === "nl" ? "KindCut-vorm" : "KindCut shape",
    frame: shape.frame,
    paths: [shape.path],
    language,
    index,
  });
}

function getSafeProjectFileName(name: string): string {
  const withoutExtension = name.replace(/\.kindcut$/i, "").replace(/\.svg$/i, "");
  return withoutExtension.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "kindcut-project";
}

function loadMeasurementUnitPreference(): MeasurementUnit {
  try {
    const saved = window.localStorage.getItem(MEASUREMENT_UNIT_STORAGE_KEY);
    return saved === "in" || saved === "cm" || saved === "mm" ? saved : "cm";
  } catch {
    return "cm";
  }
}

function cloneWorkspaceSvgItems(items: WorkspaceSvgItem[]): WorkspaceSvgItem[] {
  return cloneWorkspaceObjects(items) as WorkspaceSvgItem[];
}

function workspaceTransformsEqual(a: WorkspaceItemTransform, b: WorkspaceItemTransform): boolean {
  return a.x === b.x && a.y === b.y && a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotation === b.rotation;
}

function normalizeAiSvg(svg: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const root = doc.querySelector("svg");
  if (!root) return svg;

  const vb = root.getAttribute("viewBox") ?? "";
  const vbParts = vb.split(/\s+/).map(Number);
  const vbX = vbParts[0] ?? 0;
  const vbY = vbParts[1] ?? 0;
  const vbW = vbParts[2] ?? 0;
  const vbH = vbParts[3] ?? 0;

  function resolveDim(val: string | null, refSize: number): number {
    if (!val) return 0;
    const trimmed = val.trim();
    if (trimmed.endsWith("%")) return (parseFloat(trimmed) / 100) * refSize;
    const n = parseFloat(trimmed);
    return isNaN(n) ? 0 : n;
  }

  function isLightOrDefault(c: string): boolean {
    const cleaned = c.trim().toLowerCase();
    // Empty = SVG default (black) — treat as background candidate
    return (
      cleaned === "" || cleaned === "white" || cleaned === "#fff" ||
      cleaned === "#ffffff" || cleaned === "transparent" || cleaned === "none"
    );
  }

  function coversViewBox(el: Element): boolean {
    const x = resolveDim(el.getAttribute("x"), vbW);
    const y = resolveDim(el.getAttribute("y"), vbH);
    const w = resolveDim(el.getAttribute("width"), vbW);
    const h = resolveDim(el.getAttribute("height"), vbH);
    if (w === 0 || h === 0 || vbW === 0 || vbH === 0) return false;
    // Covers ≥ 85 % of viewBox starting near the origin
    return x <= vbW * 0.1 && y <= vbH * 0.1 && w >= vbW * 0.85 && h >= vbH * 0.85;
  }

  // Remove ALL rects that are either large background candidates or light-colored.
  // Also remove any rect whose stroke would be invisible (no stroke = SVG default none on rects).
  for (const rect of Array.from(root.querySelectorAll("rect"))) {
    const fill = rect.getAttribute("fill") ?? "";
    const stroke = rect.getAttribute("stroke") ?? "";
    // Keep only rects that are small design elements with an explicit dark stroke
    const isSmall = !coversViewBox(rect);
    const hasVisibleStroke = stroke && !isLightOrDefault(stroke);
    const hasDarkFill = fill && !isLightOrDefault(fill);
    if (!(isSmall && (hasVisibleStroke || hasDarkFill))) {
      rect.remove();
    }
  }

  // Strip inline styles from groups/svg root before processing shapes
  for (const el of Array.from(root.querySelectorAll("g"))) {
    el.removeAttribute("style");
  }
  root.removeAttribute("style");

  // Normalize all path/shape elements.
  // Potrace outputs fill="#000000" stroke="none".
  // We keep fill="#000000" so the saved SVG file has fill data baked in
  // (visible in library previews and portable to other tools).
  // stroke="#000000" is kept for tool color matching in WorkspaceObjectArtwork.
  const shapeSelectors = ["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"];
  for (const el of Array.from(root.querySelectorAll(shapeSelectors.join(",")))) {
    el.setAttribute("stroke", "#000000");
    el.setAttribute("fill", "#000000");
    el.setAttribute("stroke-width", "1");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    el.removeAttribute("style");
    el.removeAttribute("stroke-opacity");
    el.removeAttribute("fill-opacity");
    el.removeAttribute("opacity");
  }

  return new XMLSerializer().serializeToString(doc);
}

function parseGroupedPathTransform(pathTransform: string | undefined): {
  dx: number; dy: number; rotation: number; scaleX: number; scaleY: number; original: string;
} {
  if (!pathTransform) return { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1, original: "" };
  let rem = pathTransform;
  const tMatch = rem.match(/^translate\(([-\d.e]+)\s+([-\d.e]+)\)\s*/);
  const dx = tMatch ? parseFloat(tMatch[1]!) : 0;
  const dy = tMatch ? parseFloat(tMatch[2]!) : 0;
  if (tMatch) rem = rem.slice(tMatch[0].length);
  const rMatch = rem.match(/^rotate\(([-\d.e]+)\)\s*/);
  const rotation = rMatch ? parseFloat(rMatch[1]!) : 0;
  if (rMatch) rem = rem.slice(rMatch[0].length);
  const sMatch = rem.match(/^scale\(([-\d.e]+)\s+([-\d.e]+)\)\s*/);
  const scaleX = sMatch ? parseFloat(sMatch[1]!) : 1;
  const scaleY = sMatch ? parseFloat(sMatch[2]!) : 1;
  if (sMatch) rem = rem.slice(sMatch[0].length);
  return { dx, dy, rotation, scaleX, scaleY, original: rem.trim() };
}

function computePathBBoxInDOM(d: string, transform?: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.style.cssText = "position:fixed;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none";
    const pathEl = document.createElementNS(ns, "path");
    pathEl.setAttribute("d", d);
    if (transform) pathEl.setAttribute("transform", transform);
    svg.appendChild(pathEl);
    document.body.appendChild(svg);
    const bbox = pathEl.getBBox();
    document.body.removeChild(svg);
    return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  } catch {
    return null;
  }
}

function reframeUngroupedChild(child: WorkspaceSvgItem, groupTransform: WorkspaceItemTransform): WorkspaceSvgItem {
  const firstPath = child.paths[0];
  if (!firstPath) return child;

  // All paths in a segment share the same item-level transform prefix from createWorkspaceGroup.
  const { dx, dy, rotation: pathRot, scaleX: pathSx, scaleY: pathSy } = parseGroupedPathTransform(firstPath.pathTransform);

  // Compute bounding box of each path in the item's local space (using original path transform, before group was added).
  const bboxes = child.paths.map((p) => {
    const { original } = parseGroupedPathTransform(p.pathTransform);
    return computePathBBoxInDOM(p.d, original || undefined);
  });
  const validBboxes = bboxes.filter((b): b is { x: number; y: number; width: number; height: number } => b !== null && b.width >= 0);
  if (validBboxes.length === 0) return child;

  const minX = Math.min(...validBboxes.map((b) => b.x));
  const minY = Math.min(...validBboxes.map((b) => b.y));
  const maxX = Math.max(...validBboxes.map((b) => b.x + b.width));
  const maxY = Math.max(...validBboxes.map((b) => b.y + b.height));
  const naturalWidth = maxX - minX;
  const naturalHeight = maxY - minY;
  if (naturalWidth <= 0 || naturalHeight <= 0) return child;

  // Rebuild paths: strip the group-added translate/rotate/scale, keep original, offset to 0,0.
  const newPaths = child.paths.map((p) => {
    const { original } = parseGroupedPathTransform(p.pathTransform);
    const offset = minX !== 0 || minY !== 0 ? `translate(${formatN(-minX)} ${formatN(-minY)})` : "";
    const newTransform = [offset, original].filter(Boolean).join(" ") || undefined;
    return { ...p, pathTransform: newTransform };
  });

  // Reconstruct world transform: combine group world transform with path's local translate(dx, dy) + natural offset.
  const offsetX = (dx + minX) * groupTransform.scaleX;
  const offsetY = (dy + minY) * groupTransform.scaleY;
  const rotated = rotatePoint({ x: offsetX, y: offsetY }, groupTransform.rotation);

  const paths = child.type === "path"
    ? [newPaths[0]!] as [WorkspacePathData]
    : newPaths as WorkspacePathData[];

  return {
    ...child,
    frame: { width: naturalWidth, height: naturalHeight },
    sizeCopy: `${Math.round(naturalWidth)} × ${Math.round(naturalHeight)} px`,
    transform: {
      x: groupTransform.x + rotated.x,
      y: groupTransform.y + rotated.y,
      rotation: groupTransform.rotation + pathRot,
      scaleX: groupTransform.scaleX * pathSx,
      scaleY: groupTransform.scaleY * pathSy,
    },
    paths,
  } as WorkspaceSvgItem;
}

function formatN(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function saveMeasurementUnitPreference(unit: MeasurementUnit): void {
  try {
    window.localStorage.setItem(MEASUREMENT_UNIT_STORAGE_KEY, unit);
  } catch {
    // localStorage can be unavailable in constrained renderer contexts.
  }
}

function DesignWorkspace({
  language,
  measurementUnit,
  selectedMaterialId,
  selectedMatPreset,
  importedSvg,
  importedSvgs,
  selectedSvgId,
  selectedSvgIds,
  importedPlan,
  importedPlanLoading,
  samplePlan,
  samplePlanLoading,
  validationOk,
  importMessage,
  projectMessage,
  currentProjectPath,
  projectSaving,
  projectOpening,
  cutSession,
  cutBusy,
  canPaste,
  onBackWelcome,
  onMaterialChange,
  onMatChange,
  tools,
  onToolsChange,
  onSvgFileChange,
  onAddShape,
  onAddText,
  editingTextId,
  onEnterTextEdit,
  onExitTextEdit,
  onTextContentChange,
  onSelectSvg,
  onSelectSvgGroup,
  onSelectAllSvgs,
  onCopySvgs,
  onPasteSvgs,
  onCutSvgs,
  onDeleteSvgs,
  onGroupSvgs,
  onUngroupSvg,
  onFlipX,
  onFlipY,
  onRenameObject,
  onChangeObjectColor,
  onUndoSvgs,
  onRedoSvgs,
  onWorkspaceContextMenu,
  onSvgTransformsCommit,
  onPrepareImportedPlan,
  onOpenProject,
  onSaveProject,
  onGenerateSamplePlan,
  onStartCut,
  onContinueCut,
  onStopCut,
  hasActiveAiKey,
  onOpenSettings,
  onOpenAiGenerate,
  onAiGenerateSvg,
  imageLibrary,
  imageLibraryLoading,
  onLoadImageLibrary,
  onDeleteLibraryImage,
  onAddLibraryImageToWorkspace,
}: {
  language: Language;
  measurementUnit: MeasurementUnit;
  selectedMaterialId: number;
  selectedMatPreset: string;
  importedSvg: WorkspaceSvgItem | null;
  importedSvgs: WorkspaceSvgItem[];
  selectedSvgId: string | null;
  selectedSvgIds: string[];
  importedPlan: SlicebugPlanResult | null;
  importedPlanLoading: boolean;
  samplePlan: SlicebugPlanResult | null;
  samplePlanLoading: boolean;
  validationOk: boolean;
  importMessage: string | null;
  projectMessage: string | null;
  currentProjectPath: string | null;
  projectSaving: boolean;
  projectOpening: boolean;
  cutSession: CutSessionSnapshot | null;
  cutBusy: boolean;
  canPaste: boolean;
  onBackWelcome: () => void;
  onMaterialChange: (materialId: number) => void;
  onMatChange: (matPreset: string) => void;
  tools: WorkspaceTool[];
  onToolsChange: (tools: WorkspaceTool[]) => void;
  onSvgFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddShape: (shapeKind: WorkspaceShapeKind) => void;
  onSelectSvg: (id: string | null) => void;
  onSelectSvgGroup: (ids: string[]) => void;
  onSelectAllSvgs: () => void;
  onCopySvgs: () => boolean;
  onPasteSvgs: () => boolean;
  onCutSvgs: () => boolean;
  onDeleteSvgs: () => boolean;
  onGroupSvgs: () => boolean;
  onUngroupSvg: () => boolean;
  onFlipX: () => boolean;
  onFlipY: () => boolean;
  onRenameObject: (id: string, newName: string) => void;
  onChangeObjectColor: (id: string, color: string) => void;
  onUndoSvgs: () => boolean;
  onRedoSvgs: () => boolean;
  onWorkspaceContextMenu: (selectedObjectCount?: number) => void;
  onSvgTransformsCommit: (updates: Array<{ id: string; transform: WorkspaceItemTransform }>) => void;
  onPrepareImportedPlan: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onGenerateSamplePlan: () => void;
  onStartCut: () => void;
  onContinueCut: () => void;
  onStopCut: () => void;
  hasActiveAiKey: boolean;
  onOpenSettings: () => void;
  onOpenAiGenerate: () => void;
  onAiGenerateSvg: (input: Omit<AiSvgInput, "settings">) => Promise<string>;
  imageLibrary: LibraryImage[];
  imageLibraryLoading: boolean;
  onLoadImageLibrary: () => void;
  onDeleteLibraryImage: (path: string) => void;
  onAddLibraryImageToWorkspace: (img: LibraryImage) => void;
  onAddText: () => void;
  editingTextId: string | null;
  onEnterTextEdit: (id: string) => void;
  onExitTextEdit: (id: string) => void;
  onTextContentChange: (id: string, patch: Partial<WorkspaceTextContent>) => void;
}) {
  const { t } = createTranslator(language);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState<Point>({ x: 260, y: 90 });
  const [shapeDrawerOpen, setShapeDrawerOpen] = useState(false);
  const [imageDrawerOpen, setImageDrawerOpen] = useState(false);
  const drawerOpen = imageDrawerOpen || shapeDrawerOpen;

  function openImageDrawer() {
    setImageDrawerOpen(true);
    setShapeDrawerOpen(false);
    onLoadImageLibrary();
  }
  function openShapeDrawer() {
    setShapeDrawerOpen(true);
    setImageDrawerOpen(false);
  }
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const pendingRenameRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const workpieceTransformRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<null | { pointerId: number; pointer: Point; pan: Point }>(null);
  const recentScrollRef = useRef(false);
  const recentScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directItemDragStart = useRef<null | {
    pointerId: number;
    id: string;
    pointer: Point;
    transform: WorkspaceItemTransform;
    moved: boolean;
  }>(null);
  const moveableTransformStart = useRef(new Map<string, WorkspaceItemTransform>());
  const moveableGroupCenterStart = useRef<Point | null>(null);
  const latestMoveableTransforms = useRef(new Map<string, WorkspaceItemTransform>());
  const moveableRef = useRef<Moveable | null>(null);
  const [moveableTargets, setMoveableTargets] = useState<HTMLElement[]>([]);
  const [isDirectItemDragging, setIsDirectItemDragging] = useState(false);
  const matDimensions = getMatDimensionsInches(selectedMatPreset);
  const materialName =
    getMaterialName(selectedMaterialId, language) ??
    MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.name ??
    "Material";
  const matName = getMatName(selectedMatPreset, language) ?? MAT_PRESETS.find((mat) => mat.id === selectedMatPreset)?.name ?? "Mat";
  const workpieceWidth = matDimensions.width * WORKSPACE_PIXELS_PER_INCH;
  const workpieceHeight = matDimensions.height * WORKSPACE_PIXELS_PER_INCH;
  const xTicks = getMeasurementTicks({
    axis: "x",
    lengthInches: matDimensions.width,
    unit: measurementUnit,
    zoom,
    pan,
    pixelsPerInch: WORKSPACE_PIXELS_PER_INCH,
  });
  const yTicks = getMeasurementTicks({
    axis: "y",
    lengthInches: matDimensions.height,
    unit: measurementUnit,
    zoom,
    pan,
    pixelsPerInch: WORKSPACE_PIXELS_PER_INCH,
  });
  const canPrepare = Boolean(importedSvg) && !importedPlanLoading;
  const canCut = importedSvgs.length > 0 && !importedPlanLoading && !cutBusy;
  const selectedSvgIdSet = useMemo(() => new Set(selectedSvgIds), [selectedSvgIds]);
  const lastPointerDownItemId = useRef<{ id: string; time: number } | null>(null);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  useEffect(() => {
    void window.cricutCompanion?.system?.getFonts().then((fonts) => {
      if (fonts && fonts.length > 0) setSystemFonts(fonts.sort());
    });
  }, []);
  const selectedItems = useMemo(() => importedSvgs.filter((item) => selectedSvgIdSet.has(item.id)), [importedSvgs, selectedSvgIdSet]);
  const selectedGroup = selectedItems.length === 1 && selectedItems[0]?.type === "group" ? selectedItems[0] : null;

  useEffect(() => {
    const root = workpieceTransformRef.current;
    if (!root || selectedItems.length === 0) {
      setMoveableTargets([]);
      return;
    }
    setMoveableTargets(
      selectedItems
        .map((item) => root.querySelector<HTMLElement>(`[data-workspace-item-id="${cssEscape(item.id)}"]`))
        .filter((target): target is HTMLElement => Boolean(target)),
    );
  }, [selectedItems]);

  useEffect(() => {
    requestAnimationFrame(() => { moveableRef.current?.updateRect(); });
  }, [importedSvgs]);

  useEffect(() => {
    if (pendingRenameRef.current) {
      clearTimeout(pendingRenameRef.current.timer);
      pendingRenameRef.current = null;
    }
  }, [selectedSvgIds]);

  function clampZoom(nextZoom: number) {
    return Math.min(WORKSPACE_MAX_ZOOM, Math.max(WORKSPACE_MIN_ZOOM, nextZoom));
  }

  function resetZoomToActualSize() {
    const rect = viewportRef.current?.getBoundingClientRect();
    const viewportWidth = rect?.width ?? workpieceWidth + WORKSPACE_STAGE_LEFT_OFFSET * 2;
    const viewportHeight = rect?.height ?? workpieceHeight + WORKSPACE_STAGE_TOP_OFFSET * 2;
    setZoom(1);
    setPan({
      x: (viewportWidth - workpieceWidth) / 2 - WORKSPACE_STAGE_LEFT_OFFSET,
      y: (viewportHeight - workpieceHeight) / 2 - WORKSPACE_STAGE_TOP_OFFSET,
    });
  }

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const sensitivity = event.deltaMode === 0 ? 0.01 : 0.005;
      const nextZoom = clampZoom(zoom - event.deltaY * sensitivity);
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const worldX = (cx - pan.x) / zoom;
      const worldY = (cy - pan.y) / zoom;
      setZoom(nextZoom);
      setPan({ x: cx - worldX * nextZoom, y: cy - worldY * nextZoom });
      return;
    }
    recentScrollRef.current = true;
    if (recentScrollTimerRef.current) clearTimeout(recentScrollTimerRef.current);
    recentScrollTimerRef.current = setTimeout(() => { recentScrollRef.current = false; }, 300);
    setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".moveable-control-box")) {
      return;
    }
    if (selectedSvgId && !target.closest(".workspace-image-item")) {
      onSelectSvg(null);
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerId: event.pointerId, pointer: { x: event.clientX, y: event.clientY }, pan };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - dragStart.current.pointer.x;
    const deltaY = event.clientY - dragStart.current.pointer.y;
    setPan({ x: dragStart.current.pan.x + deltaX, y: dragStart.current.pan.y + deltaY });
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current?.pointerId === event.pointerId) {
      dragStart.current = null;
    }
  }

  function handleItemPointerDown(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    // Double-click detection → enter text edit mode
    if (item.textContent) {
      const now = Date.now();
      const last = lastPointerDownItemId.current;
      if (last && last.id === item.id && now - last.time < 400) {
        lastPointerDownItemId.current = null;
        onEnterTextEdit(item.id);
        return;
      }
      lastPointerDownItemId.current = { id: item.id, time: now };
    }

    if ((event.metaKey || event.ctrlKey || event.shiftKey) && selectedSvgIdSet.has(item.id) && selectedItems.length > 1) {
      onSelectSvgGroup(selectedSvgIds.filter((id) => id !== item.id));
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      onSelectSvgGroup([...selectedSvgIds, item.id]);
      return;
    }
    if (!selectedSvgIdSet.has(item.id) || selectedItems.length <= 1) {
      onSelectSvg(item.id);
    }
    if (!selectedSvgIdSet.has(item.id)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      directItemDragStart.current = {
        pointerId: event.pointerId,
        id: item.id,
        pointer: { x: event.clientX, y: event.clientY },
        transform: item.transform,
        moved: false,
      };
      setIsDirectItemDragging(true);
    }
  }

  function handleItemPointerMove(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    const drag = directItemDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== item.id) {
      return;
    }
    const deltaX = (event.clientX - drag.pointer.x) / zoom;
    const deltaY = (event.clientY - drag.pointer.y) / zoom;
    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      drag.moved = true;
    }
    const next = normalizeWorkspaceItemTransform({
      ...drag.transform,
      x: drag.transform.x + deltaX,
      y: drag.transform.y + deltaY,
    });
    event.currentTarget.style.transform = getWorkspaceItemTransform(next);
  }

  function stopDirectItemDrag(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    const drag = directItemDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== item.id) {
      return;
    }
    directItemDragStart.current = null;
    setIsDirectItemDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const deltaX = (event.clientX - drag.pointer.x) / zoom;
    const deltaY = (event.clientY - drag.pointer.y) / zoom;
    const next = normalizeWorkspaceItemTransform({
      ...drag.transform,
      x: drag.transform.x + deltaX,
      y: drag.transform.y + deltaY,
    });
    event.currentTarget.style.transform = getWorkspaceItemTransform(next);
    if (drag.moved) {
      onSvgTransformsCommit([{ id: item.id, transform: next }]);
    }
  }

  function handleItemContextMenu(event: MouseEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    event.stopPropagation();
    if (!selectedSvgIdSet.has(item.id)) {
      onSelectSvg(item.id);
    }
    onWorkspaceContextMenu(selectedSvgIdSet.has(item.id) ? selectedSvgIds.length : 1);
  }

  function beginMoveableTransform(targets: Array<HTMLElement | SVGElement>) {
    const startEntries = targets.flatMap((target) => {
      const item = getWorkspaceItemFromTarget(target);
      return item ? [[item.id, item.transform] as const] : [];
    });
    moveableTransformStart.current = new Map(startEntries);
    latestMoveableTransforms.current = new Map(moveableTransformStart.current);
    const startItems = startEntries.flatMap(([id, transform]) => {
      const item = importedSvgs.find((candidate) => candidate.id === id);
      return item ? [{ frame: item.frame, transform }] : [];
    });
    moveableGroupCenterStart.current = getWorkspaceSelectionBounds(startItems)?.center ?? null;
  }

  function handleMoveableDragStart(event: OnDragStart) {
    beginMoveableTransform([event.target]);
    const item = getWorkspaceItemFromTarget(event.target);
    if (item) {
      event.set([item.transform.x, item.transform.y]);
    }
  }

  function handleMoveableDragGroupStart(event: OnDragGroupStart) {
    beginMoveableTransform(event.targets);
    event.events.forEach((childEvent) => {
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set([item.transform.x, item.transform.y]);
      }
    });
  }

  function handleMoveableDrag(event: OnDrag) {
    updateMoveableTargetTransform(event.target, { x: event.beforeTranslate[0], y: event.beforeTranslate[1] });
  }

  function handleMoveableDragGroup(event: OnDragGroup) {
    event.events.forEach(handleMoveableDrag);
  }

  function handleMoveableScaleStart(event: OnScaleStart) {
    beginMoveableTransform([event.target]);
    const item = getWorkspaceItemFromTarget(event.target);
    if (item) {
      event.set([item.transform.scaleX, item.transform.scaleY]);
      event.setTransform(getWorkspaceItemTransform(item.transform));
      if (isCornerScaleDirection(event.direction)) {
        event.setRatio(item.frame.width / item.frame.height);
      }
      event.setFixedDirection(getScaleFixedDirection(event.direction, isCenterScaleModifier(event.inputEvent)));
    }
  }

  function handleMoveableScaleGroupStart(event: OnScaleGroupStart) {
    beginMoveableTransform(event.targets);
    if (isCornerScaleDirection(event.direction)) {
      const bounds = getWorkspaceSelectionBounds(selectedItems);
      if (bounds?.height) {
        event.setRatio(bounds.width / bounds.height);
      }
    }
    event.setFixedDirection(getScaleFixedDirection(event.direction, isCenterScaleModifier(event.inputEvent)));
    event.events.forEach((childEvent) => {
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set([item.transform.scaleX, item.transform.scaleY]);
        childEvent.setTransform(getWorkspaceItemTransform(item.transform));
        if (isCornerScaleDirection(childEvent.direction)) {
          childEvent.setRatio(item.frame.width / item.frame.height);
        }
        childEvent.setFixedDirection(getScaleFixedDirection(childEvent.direction, isCenterScaleModifier(childEvent.inputEvent)));
      }
    });
  }

  function handleMoveableScale(event: OnScale) {
    updateMoveableTargetScale(
      event.target,
      event.scale[0] ?? 1,
      event.scale[1] ?? 1,
      event.direction,
      isCenterScaleModifier(event.inputEvent),
      null,
    );
  }

  function handleMoveableScaleGroup(event: OnScaleGroup) {
    const groupBounds = getMoveableStartBounds();
    event.events.forEach((childEvent) => {
      updateMoveableTargetScale(
        childEvent.target,
        childEvent.scale[0] ?? 1,
        childEvent.scale[1] ?? 1,
        childEvent.direction,
        isCenterScaleModifier(childEvent.inputEvent),
        groupBounds,
      );
    });
  }

  function handleMoveableRotateStart(event: OnRotateStart) {
    beginMoveableTransform([event.target]);
    setMoveableRotationCenter(event);
    const item = getWorkspaceItemFromTarget(event.target);
    if (item) {
      event.set(item.transform.rotation);
      event.setTransform(getWorkspaceItemTransform(item.transform));
    }
  }

  function handleMoveableRotateGroupStart(event: OnRotateGroupStart) {
    beginMoveableTransform(event.targets);
    setMoveableRotationCenter(event);
    event.events.forEach((childEvent) => {
      setMoveableRotationCenter(childEvent);
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set(item.transform.rotation);
        childEvent.setTransform(getWorkspaceItemTransform(item.transform));
      }
    });
  }

  function handleMoveableRotate(event: OnRotate) {
    updateMoveableTargetRotation(event.target, event.rotation, isPreciseRotationModifier(event.inputEvent), null);
  }

  function handleMoveableRotateGroup(event: OnRotateGroup) {
    const groupCenter = moveableGroupCenterStart.current;
    event.events.forEach((childEvent) => {
      updateMoveableTargetRotation(
        childEvent.target,
        childEvent.rotation,
        isPreciseRotationModifier(childEvent.inputEvent),
        groupCenter,
      );
    });
  }

  function updateMoveableTargetTransform(
    target: HTMLElement | SVGElement,
    transformPart: Partial<WorkspaceItemTransform>,
  ) {
    const item = getWorkspaceItemFromTarget(target);
    if (!item) {
      return;
    }
    const start = moveableTransformStart.current.get(item.id) ?? item.transform;
    applyMoveableTargetTransform(target, item.id, normalizeWorkspaceItemTransform({ ...start, ...transformPart }));
  }

  function updateMoveableTargetScale(
    target: HTMLElement | SVGElement,
    absoluteScaleX: number,
    absoluteScaleY: number,
    direction: number[],
    fromCenter: boolean,
    groupBounds: ReturnType<typeof getMoveableStartBounds>,
  ) {
    const item = getWorkspaceItemFromTarget(target);
    if (!item) {
      return;
    }
    const start = moveableTransformStart.current.get(item.id) ?? item.transform;
    let scaleFactorX = absoluteScaleX / Math.max(0.001, start.scaleX);
    let scaleFactorY = absoluteScaleY / Math.max(0.001, start.scaleY);
    if (isCornerScaleDirection(direction)) {
      const uniformScale = Math.max(scaleFactorX, scaleFactorY);
      scaleFactorX = uniformScale;
      scaleFactorY = uniformScale;
    } else if (direction[0] === 0) {
      scaleFactorX = 1;
    } else if (direction[1] === 0) {
      scaleFactorY = 1;
    }
    const anchor = groupBounds
      ? getScaleAnchorForBounds(groupBounds, direction, fromCenter)
      : getScaleAnchorForItem(start, item.frame, direction, fromCenter);
    const next = scaleWorkspaceItemTransformFromAnchor(start, item.frame, anchor, scaleFactorX, scaleFactorY);
    applyMoveableTargetTransform(target, item.id, next);
  }

  function updateMoveableTargetRotation(
    target: HTMLElement | SVGElement,
    absoluteRotation: number,
    preciseRotation: boolean,
    groupCenter: Point | null,
  ) {
    const item = getWorkspaceItemFromTarget(target);
    if (!item) {
      return;
    }
    const start = moveableTransformStart.current.get(item.id) ?? item.transform;
    const anchor = groupCenter ?? getWorkspaceItemCenterPoint(start, item.frame);
    const rotationDelta = groupCenter
      ? getSnappedRotation(absoluteRotation - start.rotation, preciseRotation)
      : getSnappedRotation(absoluteRotation, preciseRotation) - start.rotation;
    const next = rotateWorkspaceItemTransformAroundPoint(start, item.frame, anchor, rotationDelta);
    applyMoveableTargetTransform(target, item.id, next);
  }

  function applyMoveableTargetTransform(target: HTMLElement | SVGElement, id: string, transform: WorkspaceItemTransform) {
    latestMoveableTransforms.current.set(id, transform);
    if (target instanceof HTMLElement) {
      target.style.transform = getWorkspaceItemTransform(transform);
      const frame = importedSvgs.find((item) => item.id === id)?.frame;
      if (frame) {
        const size = getWorkspaceItemVisualSize(frame, transform);
        target.style.width = `${size.width}px`;
        target.style.height = `${size.height}px`;
      }
    }
  }

  function commitMoveableTransforms() {
    const updates = Array.from(latestMoveableTransforms.current, ([id, transform]) => ({ id, transform }));
    moveableTransformStart.current = new Map();
    moveableGroupCenterStart.current = null;
    latestMoveableTransforms.current = new Map();
    onSvgTransformsCommit(updates);
  }

  function getWorkspaceItemFromTarget(target: HTMLElement | SVGElement): WorkspaceSvgItem | null {
    const id = target instanceof HTMLElement ? target.dataset.workspaceItemId : undefined;
    return id ? importedSvgs.find((item) => item.id === id) ?? null : null;
  }

  function getWorkspaceItemCenterPoint(transform: WorkspaceItemTransform, frame: { width: number; height: number }): Point {
    const centerOffset = rotatePoint(
      { x: (frame.width * transform.scaleX) / 2, y: (frame.height * transform.scaleY) / 2 },
      transform.rotation,
    );
    return { x: transform.x + centerOffset.x, y: transform.y + centerOffset.y };
  }

  function getMoveableStartBounds() {
    const startItems = Array.from(moveableTransformStart.current, ([id, transform]) => {
      const item = importedSvgs.find((candidate) => candidate.id === id);
      return item ? { frame: item.frame, transform } : null;
    }).filter((item): item is { frame: { width: number; height: number }; transform: WorkspaceItemTransform } => Boolean(item));
    return getWorkspaceSelectionBounds(startItems);
  }

  function getScaleAnchorForItem(
    transform: WorkspaceItemTransform,
    frame: { width: number; height: number },
    direction: number[],
    fromCenter: boolean,
  ): Point {
    if (fromCenter) {
      return getWorkspaceItemCenterPoint(transform, frame);
    }
    const width = frame.width * transform.scaleX;
    const height = frame.height * transform.scaleY;
    const localAnchor = {
      x: direction[0] === -1 ? width : direction[0] === 1 ? 0 : width / 2,
      y: direction[1] === -1 ? height : direction[1] === 1 ? 0 : height / 2,
    };
    const rotatedAnchor = rotatePoint(localAnchor, transform.rotation);
    return { x: transform.x + rotatedAnchor.x, y: transform.y + rotatedAnchor.y };
  }

  function getScaleAnchorForBounds(
    bounds: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>,
    direction: number[],
    fromCenter: boolean,
  ): Point {
    if (fromCenter) {
      return bounds.center;
    }
    return {
      x: direction[0] === -1 ? bounds.right : direction[0] === 1 ? bounds.left : bounds.center.x,
      y: direction[1] === -1 ? bounds.bottom : direction[1] === 1 ? bounds.top : bounds.center.y,
    };
  }

  function getScaleFixedDirection(direction: number[], fromCenter: boolean): number[] {
    return fromCenter ? [0, 0] : [-(direction[0] ?? 0), -(direction[1] ?? 0)];
  }

  function isCornerScaleDirection(direction: number[]): boolean {
    return (direction[0] ?? 0) !== 0 && (direction[1] ?? 0) !== 0;
  }

  function isCenterScaleModifier(inputEvent: { altKey?: boolean } | null | undefined): boolean {
    return Boolean(inputEvent?.altKey);
  }

  function isPreciseRotationModifier(inputEvent: { altKey?: boolean } | null | undefined): boolean {
    return Boolean(inputEvent?.altKey);
  }

  function setMoveableRotationCenter(event: OnRotateStart) {
    event.setFixedDirection([...MOVEABLE_CENTER_DIRECTION]);
  }

  function getSnappedRotation(rotation: number, preciseRotation: boolean): number {
    if (preciseRotation) {
      return rotation;
    }
    const snapped = Math.round(rotation / ROTATION_SNAP_INTERVAL_DEGREES) * ROTATION_SNAP_INTERVAL_DEGREES;
    return Math.abs(rotation - snapped) <= ROTATION_SNAP_THRESHOLD_DEGREES ? snapped : rotation;
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const usesModifier = event.metaKey || event.ctrlKey;
      if (usesModifier && event.key.toLowerCase() === "z") {
        const handled = event.shiftKey ? onRedoSvgs() : onUndoSvgs();
        if (handled) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "y") {
        if (onRedoSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        onSelectAllSvgs();
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "c") {
        if (onCopySvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "v") {
        if (onPasteSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "x") {
        if (onCutSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (onDeleteSvgs()) {
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCopySvgs, onCutSvgs, onDeleteSvgs, onPasteSvgs, onRedoSvgs, onSelectAllSvgs, onUndoSvgs]);

  return (
    <main className="app-shell design-shell">
      <div className="native-window-drag-zone app-drag" aria-hidden="true" />
      <header className="design-topbar">
        <div className="design-brand">
          <button
            className="workspace-home-button no-drag"
            type="button"
            onClick={onBackWelcome}
            aria-label={language === "nl" ? "Terug naar projectstart" : "Back to project start"}
            title={language === "nl" ? "Projectstart" : "Project start"}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5 10 3l7 6.5"/><path d="M5 8v8a1 1 0 0 0 1 1h3v-4h2v4h3a1 1 0 0 0 1-1V8"/></svg>
          </button>
          <div>
            <p className="eyebrow">{language === "nl" ? "Werkruimte" : "Workspace"}</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <WorkspaceToolbar
          language={language}
          canCopy={selectedSvgIds.length > 0}
          canCut={selectedSvgIds.length > 0}
          canPaste={canPaste}
          canDelete={selectedSvgIds.length > 0}
          canGroup={selectedSvgIds.length >= 2}
          canUngroup={selectedGroup !== null}
          canFlip={selectedSvgIds.length > 0}
          projectSaving={projectSaving}
          projectOpening={projectOpening}
          onOpen={onOpenProject}
          onSave={onSaveProject}
          onCopy={onCopySvgs}
          onCut={onCutSvgs}
          onPaste={onPasteSvgs}
          onDelete={onDeleteSvgs}
          onGroup={onGroupSvgs}
          onUngroup={onUngroupSvg}
          onFlipX={onFlipX}
          onFlipY={onFlipY}
        />

        <div className="design-topbar__controls no-drag">
          <button
            className="workspace-home-button no-drag"
            type="button"
            onClick={onOpenSettings}
            aria-label={language === "nl" ? "Instellingen" : "Settings"}
            title={language === "nl" ? "Instellingen" : "Settings"}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="2.5"/>
              <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.22 4.22l1.06 1.06M14.72 14.72l1.06 1.06M4.22 15.78l1.06-1.06M14.72 5.28l1.06-1.06"/>
            </svg>
          </button>
          <button className="cut-button" type="button" disabled={!canCut} onClick={onStartCut}>
            <span aria-hidden="true">▶</span>
            {cutBusy ? t("buttons.starting") : t("buttons.startCut")}
          </button>
        </div>
      </header>

      <section
        className={drawerOpen ? "design-frame design-frame--shape-drawer" : "design-frame"}
        aria-label={language === "nl" ? "Ontwerpwerkruimte" : "Design workspace"}
      >
        <aside className="tool-rail no-drag" aria-label={language === "nl" ? "Gereedschappen" : "Tools"}>
          <button
            className={imageDrawerOpen ? "tool-button tool-button--active" : "tool-button"}
            type="button"
            onClick={() => { imageDrawerOpen ? setImageDrawerOpen(false) : openImageDrawer(); }}
            aria-expanded={imageDrawerOpen}
          >
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="16" height="16" rx="2.5"/><path d="M3 14.5 7.5 10l3.5 3.5 2.5-2.5 5.5 5.5"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>
            {language === "nl" ? "Beeld" : "Image"}
          </button>
          <button className="tool-button" type="button" onClick={onAddText}>
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 5h10M11 5v12M8 17h6"/></svg>
            {language === "nl" ? "Tekst" : "Text"}
          </button>
          <button
            className={shapeDrawerOpen ? "tool-button tool-button--active" : "tool-button"}
            type="button"
            onClick={() => { shapeDrawerOpen ? setShapeDrawerOpen(false) : openShapeDrawer(); }}
            aria-expanded={shapeDrawerOpen}
            aria-controls="shape-library-panel"
          >
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="11" width="9" height="9" rx="1.5"/><circle cx="15.5" cy="6.5" r="4.5"/></svg>
            {language === "nl" ? "Vormen" : "Shapes"}
          </button>
        </aside>

        {imageDrawerOpen ? (
          <ImageLibraryPanel
            language={language}
            hasActiveAiKey={hasActiveAiKey}
            images={imageLibrary}
            loading={imageLibraryLoading}
            onAskAi={() => { onOpenAiGenerate(); }}
            onFileImport={onSvgFileChange}
            onUseImage={(img) => { onAddLibraryImageToWorkspace(img); setImageDrawerOpen(false); }}
            onDeleteImage={onDeleteLibraryImage}
          />
        ) : null}

        {shapeDrawerOpen ? (
          <ShapeLibraryPanel
            language={language}
            onAddShape={(shapeKind) => {
              onAddShape(shapeKind);
              setShapeDrawerOpen(false);
            }}
          />
        ) : null}

        <section className="workspace-stage no-drag">
          <div className="stage-statusbar">
            <strong>{matName}</strong>
            <span>{materialName}</span>
            <span>{matDimensions.width} × {matDimensions.height} in</span>
          </div>
          <div className="ruler-corner">0</div>
          <Ruler axis="x" ticks={xTicks} unit={measurementUnit} />
          <Ruler axis="y" ticks={yTicks} unit={measurementUnit} />
          <div
            ref={viewportRef}
            className="viewport"
            onWheel={handleViewportWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onContextMenu={(e) => { if (recentScrollRef.current) { e.preventDefault(); return; } onWorkspaceContextMenu(); }}
          >
            <div className="infinite-grid" />
            <div
              ref={workpieceTransformRef}
              className="workpiece-transform"
              style={{ transform: getViewportTransform({ zoom, pan }) }}
            >
              <div
                className="workpiece-paper"
                style={{
                  width: workpieceWidth,
                  height: workpieceHeight,
                  // Grid size = 1 ruler subdivision in workspace pixels (unit-dependent).
                  // in: 0.25in = 20px  |  cm: 0.5cm ≈ 15.75px  |  mm: 5mm ≈ 15.75px
                  // Parent workpiece-transform applies zoom so no multiplication needed.
                  backgroundImage: "linear-gradient(rgba(127,96,66,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(127,96,66,0.08) 1px,transparent 1px)",
                  ...(() => {
                    const gridPx = measurementUnit === "in"
                      ? WORKSPACE_PIXELS_PER_INCH * 0.25
                      : measurementUnit === "cm"
                        ? WORKSPACE_PIXELS_PER_INCH * 0.5 / 2.54
                        : WORKSPACE_PIXELS_PER_INCH * 5 / 25.4;
                    // The mat has border: 1px which shifts the CSS background inward by 1px.
                    // Compensate so grid line 0 is exactly at the mat's visual edge (= ruler 0).
                    return { backgroundSize: `${gridPx}px ${gridPx}px`, backgroundPosition: "-1px -1px" };
                  })(),
                }}
              >
                {importedSvgs.length === 0 ? (
                  <div className="empty-workpiece">
                    <strong>{language === "nl" ? "Leeg project" : "Blank project"}</strong>
                    <span>{language === "nl" ? "Kies een vorm of voeg een eigen ontwerp toe." : "Choose a shape or add your own design."}</span>
                  </div>
                ) : null}
              </div>
              <div
                className="workspace-image-layer"
                style={{ width: workpieceWidth, height: workpieceHeight }}
                aria-label={language === "nl" ? "Afbeeldingslaag" : "Image layer"}
              >
                {importedSvgs.length > 0
                  ? (
                  importedSvgs.map((item) => (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      data-workspace-item-id={item.id}
                      className={`workspace-image-item${selectedSvgIdSet.has(item.id) ? " workspace-image-item--selected" : ""}${item.id === selectedSvgId ? " workspace-image-item--primary-selected" : ""}${editingTextId === item.id ? " workspace-image-item--text-editing" : ""}`}
                      style={{
                        width: getWorkspaceItemVisualSize(item.frame, item.transform).width,
                        height: getWorkspaceItemVisualSize(item.frame, item.transform).height,
                        transform: getWorkspaceItemTransform(item.transform),
                      }}
                      aria-label={
                        language === "nl"
                          ? `${item.fileName} kiezen en verplaatsen`
                          : `Select and move ${item.fileName}`
                      }
                      onPointerDown={(event) => handleItemPointerDown(event, item)}
                      onPointerMove={(event) => handleItemPointerMove(event, item)}
                      onPointerUp={(event) => stopDirectItemDrag(event, item)}
                      onPointerCancel={(event) => stopDirectItemDrag(event, item)}
                      onContextMenu={(event) => handleItemContextMenu(event, item)}
                    >
                      {editingTextId === item.id && item.textContent ? (
                        <TextEditOverlay
                          item={item}
                          onCommit={(text) => {
                            onTextContentChange(item.id, { text });
                            onExitTextEdit(item.id);
                          }}
                          onCancel={() => onExitTextEdit(item.id)}
                        />
                      ) : (
                        <WorkspaceObjectArtwork item={item} tools={tools} />
                      )}
                    </div>
                  ))
                    )
                  : null}
                {moveableTargets.length > 0 && !isDirectItemDragging ? (
                  <Moveable
                    ref={moveableRef}
                    target={moveableTargets.length === 1 ? moveableTargets[0] : moveableTargets}
                    draggable
                    scalable
                    rotatable
                    groupable={moveableTargets.length > 1}
                    origin={false}
                    keepRatio={false}
                    throttleDrag={0}
                    throttleScale={0}
                    throttleRotate={0}
                    zoom={1 / Math.max(0.01, zoom)}
                    renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
                    onDragStart={handleMoveableDragStart}
                    onDrag={handleMoveableDrag}
                    onDragEnd={commitMoveableTransforms}
                    onDragGroupStart={handleMoveableDragGroupStart}
                    onDragGroup={handleMoveableDragGroup}
                    onDragGroupEnd={commitMoveableTransforms}
                    onScaleStart={handleMoveableScaleStart}
                    onScale={handleMoveableScale}
                    onScaleEnd={commitMoveableTransforms}
                    onScaleGroupStart={handleMoveableScaleGroupStart}
                    onScaleGroup={handleMoveableScaleGroup}
                    onScaleGroupEnd={commitMoveableTransforms}
                    onRotateStart={handleMoveableRotateStart}
                    onRotate={handleMoveableRotate}
                    onRotateEnd={commitMoveableTransforms}
                    onRotateGroupStart={handleMoveableRotateGroupStart}
                    onRotateGroup={handleMoveableRotateGroup}
                    onRotateGroupEnd={commitMoveableTransforms}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div className="zoom-controls no-drag" aria-label={language === "nl" ? "Zoom" : "Zoom"}>
            <button type="button" onClick={() => setZoom((current) => clampZoom(current - 0.1))}>−</button>
            <button type="button" onClick={resetZoomToActualSize}>{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom((current) => clampZoom(current + 0.1))}>＋</button>
          </div>
        </section>

        <aside className="project-drawer no-drag">
          {projectMessage ? <p className="ok project-message">{projectMessage}</p> : null}
          {importMessage ? <p className="warn">{importMessage}</p> : null}

          <div className="drawer-section">
            {(() => {
              const nl = language === "nl";
              const sel = selectedSvgId ? importedSvgs.find((x) => x.id === selectedSvgId) ?? null : null;

              if (!sel) return (
                <>
                  <p className="drawer-section__title">{nl ? "Werkstuk" : "Workpiece"}</p>
                  <div className="object-settings">
                    <div className="object-settings__row object-settings__row--first">
                      <label className="object-settings__label" htmlFor="wp-material">{nl ? "Materiaal" : "Material"}</label>
                      <select id="wp-material" className="object-settings__select" value={selectedMaterialId} onChange={(e) => onMaterialChange(Number(e.target.value))}>
                        {MATERIAL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{getMaterialName(m.id, language) ?? m.name}</option>)}
                      </select>
                    </div>
                    <div className="object-settings__row">
                      <label className="object-settings__label" htmlFor="wp-mat">{nl ? "Mat" : "Mat"}</label>
                      <select id="wp-mat" className="object-settings__select" value={selectedMatPreset} onChange={(e) => onMatChange(e.target.value)}>
                        {MAT_PRESETS.map((m) => <option key={m.id} value={m.id}>{getMatName(m.id, language) ?? m.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <p className="drawer-section__title" style={{ marginTop: 16 }}>{nl ? "Gereedschappen" : "Tools"}</p>
                  <div className="tool-list">
                    {tools.map((tool, idx) => {
                      const dupColor = tools.some((t, i) => i !== idx && t.color.toLowerCase() === tool.color.toLowerCase());
                      return (
                        <div key={tool.id} className="tool-list__item">
                          <input
                            type="color"
                            className="tool-list__color"
                            value={tool.color}
                            onChange={(e) => {
                              const newColor = e.target.value;
                              onToolsChange(tools.map((t) => t.id === tool.id ? { ...t, color: newColor } : t));
                              onChangeObjectColor !== undefined && importedSvgs.forEach((obj) => {
                                if (obj.paths.some((p) => p.stroke.toLowerCase() === tool.color.toLowerCase())) {
                                  onChangeObjectColor(obj.id, newColor);
                                }
                              });
                            }}
                            title={nl ? "Verander kleur" : "Change color"}
                          />
                          <select
                            className="tool-list__type"
                            value={tool.type}
                            onChange={(e) => onToolsChange(tools.map((t) => t.id === tool.id ? { ...t, type: e.target.value as "pen" | "cut" } : t))}
                          >
                            <option value="pen">{nl ? "Pen" : "Pen"}</option>
                            <option value="cut">{nl ? "Snijden" : "Cut"}</option>
                          </select>
                          {dupColor && <span className="tool-list__warn" title={nl ? "Dubbele kleur" : "Duplicate color"}>⚠</span>}
                          <button
                            type="button"
                            className="tool-list__delete"
                            onClick={() => onToolsChange(tools.filter((t) => t.id !== tool.id))}
                            aria-label={nl ? "Verwijder" : "Delete"}
                          >
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 4h10M8 4V2.5h-2V4M3.5 4l.5 7.5h6l.5-7.5"/></svg>
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="tool-list__add"
                      onClick={() => {
                        const id = `tool-${Date.now()}`;
                        onToolsChange([...tools, { id, color: "#000000", type: "pen" }]);
                      }}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
                      {nl ? "Gereedschap toevoegen" : "Add tool"}
                    </button>
                  </div>
                </>
              );

              // Text object selected — show text controls + tool picker
              if (sel.textContent) {
                const tc = sel.textContent;
                const color = tc.color;
                const matchedTool = tools.find((t) => t.color.toLowerCase() === color.toLowerCase()) ?? null;
                return (
                  <>
                    <p className="drawer-section__title">{nl ? "Tekst" : "Text"}</p>
                    <div className="object-settings">
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-tool">{nl ? "Gereedschap" : "Tool"}</label>
                        <select id="txt-tool" className="object-settings__select"
                          value={matchedTool?.id ?? ""}
                          onChange={(e) => { const p = tools.find((t) => t.id === e.target.value); if (p) onTextContentChange(sel.id, { color: p.color }); }}
                        >
                          {tools.map((t) => (
                            <option key={t.id} value={t.id}>{t.color.toUpperCase()} — {t.type === "pen" ? "Pen" : (nl ? "Snijden" : "Cut")}</option>
                          ))}
                          {!matchedTool && <option value="">— {nl ? "Geen" : "None"} —</option>}
                        </select>
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-font">{nl ? "Lettertype" : "Font"}</label>
                        <select id="txt-font" className="object-settings__select"
                          value={tc.fontFamily}
                          onChange={(e) => onTextContentChange(sel.id, { fontFamily: e.target.value })}
                        >
                          <optgroup label={nl ? "Generiek" : "Generic"}>
                            {["sans-serif","serif","monospace","cursive","fantasy"].map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </optgroup>
                          {systemFonts.length > 0 ? (
                            <optgroup label={nl ? "Systeemlettertypen" : "System fonts"}>
                              {systemFonts.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </optgroup>
                          ) : (
                            <optgroup label={nl ? "Veelgebruikt" : "Common"}>
                              {["Arial","Arial Black","Helvetica","Helvetica Neue","Verdana","Tahoma","Trebuchet MS","Georgia","Times New Roman","Palatino","Garamond","Courier New","Lucida Console","Monaco","Menlo","Impact","Comic Sans MS","Gill Sans","Optima","Futura","Century Gothic","Calibri","Cambria","Segoe UI","Franklin Gothic Medium"].map((f) => (
                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label">{nl ? "Stijl" : "Style"}</label>
                        <div className="text-style-btns">
                          <button type="button" className={`text-style-btn${tc.fontWeight === "bold" ? " text-style-btn--active" : ""}`}
                            onClick={() => onTextContentChange(sel.id, { fontWeight: tc.fontWeight === "bold" ? "normal" : "bold" })}
                          ><strong>B</strong></button>
                          <button type="button" className={`text-style-btn${tc.fontStyle === "italic" ? " text-style-btn--active" : ""}`}
                            onClick={() => onTextContentChange(sel.id, { fontStyle: tc.fontStyle === "italic" ? "normal" : "italic" })}
                          ><em>I</em></button>
                          <button type="button" className={`text-style-btn${tc.textDecoration === "underline" ? " text-style-btn--active" : ""}`}
                            onClick={() => onTextContentChange(sel.id, { textDecoration: tc.textDecoration === "underline" ? "none" : "underline" })}
                          ><span style={{ textDecoration: "underline" }}>U</span></button>
                          <span className="text-style-divider"/>
                          {(["left","center","right"] as const).map((align) => (
                            <button key={align} type="button" className={`text-style-btn${(tc.textAlign ?? "left") === align ? " text-style-btn--active" : ""}`}
                              onClick={() => onTextContentChange(sel.id, { textAlign: align })}
                              title={align}
                            >
                              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                {align === "left"   && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="6" x2="9" y2="6"/><line x1="2" y1="9" x2="11" y2="9"/><line x1="2" y1="12" x2="7" y2="12"/></>}
                                {align === "center" && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="4" y1="6" x2="10" y2="6"/><line x1="3" y1="9" x2="11" y2="9"/><line x1="5" y1="12" x2="9" y2="12"/></>}
                                {align === "right"  && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="5" y1="6" x2="12" y2="6"/><line x1="3" y1="9" x2="12" y2="9"/><line x1="7" y1="12" x2="12" y2="12"/></>}
                              </svg>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-size">{nl ? "Grootte" : "Size"} <em>{tc.fontSize}px</em></label>
                        <input id="txt-size" type="range" min={10} max={200} step={1} value={tc.fontSize}
                          onChange={(e) => onTextContentChange(sel.id, { fontSize: Number(e.target.value) })}
                          className="text-slider"
                        />
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-ls">{nl ? "Letterafstand" : "Letter spacing"} <em>{tc.letterSpacing}px</em></label>
                        <input id="txt-ls" type="range" min={-5} max={30} step={0.5} value={tc.letterSpacing}
                          onChange={(e) => onTextContentChange(sel.id, { letterSpacing: Number(e.target.value) })}
                          className="text-slider"
                        />
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-lh">{nl ? "Regelafstand" : "Line height"} <em>{tc.lineHeight.toFixed(2)}×</em></label>
                        <input id="txt-lh" type="range" min={0.8} max={3} step={0.05} value={tc.lineHeight}
                          onChange={(e) => onTextContentChange(sel.id, { lineHeight: Number(e.target.value) })}
                          className="text-slider"
                        />
                      </div>
                      <button type="button" className="object-settings__edit-btn"
                        onClick={() => onEnterTextEdit(sel.id)}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M11 2l3 3-8 8H3v-3z"/></svg>
                        {nl ? "Tekst bewerken" : "Edit text"}
                      </button>
                    </div>
                  </>
                );
              }

              // SVG/shape object selected — show name + tool picker
              const color = sel.paths[0]?.stroke ?? "#000000";
              const matchedTool = tools.find((t) => t.color.toLowerCase() === color.toLowerCase()) ?? null;
              const noToolWarning = !matchedTool;
              return (
                <>
                  <p className="drawer-section__title">{nl ? "Geselecteerd" : "Selection"}</p>
                  <div className="object-settings">
                    <p className="object-settings__name">{sel.fileName}</p>
                    <div className="object-settings__row">
                      <label className="object-settings__label" htmlFor="obj-tool">{nl ? "Gereedschap" : "Tool"}</label>
                      <select
                        id="obj-tool"
                        className="object-settings__select"
                        value={matchedTool?.id ?? ""}
                        onChange={(e) => {
                          const picked = tools.find((t) => t.id === e.target.value);
                          if (picked) onChangeObjectColor(sel.id, picked.color);
                        }}
                      >
                        {tools.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.color.toUpperCase()} — {t.type === "pen" ? (nl ? "Pen" : "Pen") : (nl ? "Snijden" : "Cut")}
                          </option>
                        ))}
                        {noToolWarning && <option value="">— {nl ? "Geen gereedschap" : "No tool"} —</option>}
                      </select>
                    </div>
                    {noToolWarning && (
                      <p className="object-settings__tool-warn">
                        ⚠ {nl ? "Geen gereedschap voor kleur " : "No tool for color "}<code>{color.toUpperCase()}</code>
                      </p>
                    )}
                  </div>
                </>
              );
            })()}
          </div>

          <div className="drawer-section">
            <p className="drawer-section__title">{language === "nl" ? "Lagen" : "Layers"}</p>
          {importedSvgs.length > 0 ? (
            <>
              <div className="workspace-item-list" aria-label={language === "nl" ? "Onderdelen in dit project" : "Items in this project"}>
                {importedSvgs.map((item) => {
                  const isSelected = selectedSvgIdSet.has(item.id);
                  const isExpanded = expandedGroups.has(item.id);
                  const isRenaming = renamingId === item.id;
                  return (
                    <div key={item.id} className="workspace-item-list__row">
                      <div
                        className={`workspace-item-list__item${isSelected ? " workspace-item-list__item--selected" : ""}`}
                      >
                        {item.type === "group" ? (
                          <button
                            type="button"
                            className="workspace-item-list__expand"
                            aria-label={isExpanded ? "Collapse group" : "Expand group"}
                            onClick={() => setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                              return next;
                            })}
                          >
                            {isExpanded ? "▾" : "▸"}
                          </button>
                        ) : (
                          <span className="workspace-item-list__icon">◈</span>
                        )}
                        <button
                          type="button"
                          className="workspace-item-list__select"
                          onClick={() => {
                            if (pendingRenameRef.current) {
                              clearTimeout(pendingRenameRef.current.timer);
                              pendingRenameRef.current = null;
                            }
                            if (isSelected && selectedSvgIds.length === 1 && renamingId !== item.id) {
                              const timer = setTimeout(() => {
                                setRenamingId(item.id);
                                pendingRenameRef.current = null;
                              }, 500);
                              pendingRenameRef.current = { id: item.id, timer };
                            } else {
                              onSelectSvg(item.id);
                            }
                          }}
                          aria-pressed={isSelected}
                        >
                          {isRenaming ? (
                            <input
                              className="workspace-item-list__rename-input"
                              defaultValue={item.fileName}
                              autoFocus
                              onBlur={(e) => { onRenameObject(item.id, e.currentTarget.value); setRenamingId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { onRenameObject(item.id, e.currentTarget.value); setRenamingId(null); }
                                if (e.key === "Escape") { setRenamingId(null); }
                                e.stopPropagation();
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span>
                              {item.fileName}
                              {(() => {
                                const stroke = item.paths[0]?.stroke ?? "";
                                const hasMatch = tools.some((t) => t.color.toLowerCase() === stroke.toLowerCase());
                                return !hasMatch && stroke ? <span className="workspace-item-list__warn" title={language === "nl" ? "Geen gereedschap voor deze kleur" : "No tool for this color"}>⚠</span> : null;
                              })()}
                            </span>
                          )}
                        </button>
                      </div>
                      {item.type === "group" && isExpanded ? (
                        <div className="workspace-item-list__children">
                          {item.paths.map((path, i) => (
                            <div key={path.id} className="workspace-item-list__child">
                              <span className="workspace-item-list__icon">◈</span>
                              <span>{path.sourceLabel ?? (language === "nl" ? `Pad ${i + 1}` : `Path ${i + 1}`)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyImportState language={language} />
          )}
          </div>
        </aside>
      </section>
    </main>
  );
}

function SettingsModal({
  language,
  settings,
  onSave,
  onClose,
}: {
  language: Language;
  settings: AiProviderSettings;
  onSave: (settings: AiProviderSettings) => void;
  onClose: () => void;
}) {
  const nl = language === "nl";
  const [draft, setDraft] = useState<AiProviderSettings>(settings);

  return (
    <div className="cut-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cut-modal cut-modal--narrow" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "Instellingen" : "Settings"}</h2>
          <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>
        <div className="cut-modal__body cut-modal__body--col">
          <p className="settings-modal__label">{nl ? "AI-dienst" : "AI service"}</p>
          <p className="settings-modal__hint">
            {nl
              ? "OpenAI: genereert een PNG en vectoriseert automatisch. Recraft: genereert direct een SVG."
              : "OpenAI: generates a PNG and auto-vectorises. Recraft: generates SVG directly."}
          </p>
          <select
            className="settings-modal__input settings-modal__select"
            value={draft.activeProvider}
            onChange={(e) => setDraft((d) => ({ ...d, activeProvider: e.target.value as AiProvider }))}
          >
            <option value="openai">OpenAI — GPT Image → vectortrace</option>
            <option value="recraft">Recraft — native SVG (recraftv4_1_vector)</option>
          </select>

          <p className="settings-modal__label settings-modal__label--mt">OpenAI API key</p>
          <p className="settings-modal__hint">
            {nl ? "Vereist voor OpenAI. Alleen lokaal opgeslagen." : "Required for OpenAI. Stored locally only."}
          </p>
          <input
            type="password"
            className="settings-modal__input"
            value={draft.openaiKey}
            onChange={(e) => setDraft((d) => ({ ...d, openaiKey: e.target.value }))}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
          />

          {draft.activeProvider === "openai" && (
            <>
              <p className="settings-modal__label settings-modal__label--mt">
                {nl ? "Afbeeldingsmodel" : "Image model"}
              </p>
              <p className="settings-modal__hint">
                {nl
                  ? "GPT Image genereert een PNG die automatisch wordt gevectoriseerd. Alle complexiteitsniveaus gebruiken dit model."
                  : "GPT Image generates a PNG that is automatically vectorised. All complexity levels use this model."}
              </p>
              <select
                className="settings-modal__input settings-modal__select"
                value={draft.openaiImageModel ?? "gpt-image-2"}
                onChange={(e) => setDraft((d) => ({ ...d, openaiImageModel: e.target.value as OpenAiImageModel }))}
              >
                <option value="gpt-image-2">GPT Image 2 — {nl ? "nieuwste" : "latest"}</option>
                <option value="gpt-image-1.5">GPT Image 1.5</option>
                <option value="gpt-image-1">GPT Image 1</option>
              </select>
            </>
          )}

          <p className="settings-modal__label settings-modal__label--mt">Recraft API key</p>
          <p className="settings-modal__hint">
            {nl
              ? "Vereist voor Recraft. Gespecialiseerde vector-AI. Alleen lokaal opgeslagen."
              : "Required for Recraft. Dedicated vector AI. Stored locally only."}
          </p>
          <input
            type="password"
            className="settings-modal__input"
            value={draft.recraftKey}
            onChange={(e) => setDraft((d) => ({ ...d, recraftKey: e.target.value }))}
            placeholder="recraft_..."
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="cut-modal__footer">
          <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onClose}>
            {nl ? "Annuleren" : "Cancel"}
          </button>
          <button type="button" className="cut-modal__btn cut-modal__btn--primary" onClick={() => onSave(draft)}>
            {nl ? "Opslaan" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Three dog SVG icons illustrating each complexity level
function ComplexityDogIcon({ level }: { level: 1 | 2 | 3 }) {
  const fill = "currentColor";
  if (level === 1) {
    // Pure silhouette — one single solid filled shape
    return (
      <svg viewBox="0 0 64 72" aria-hidden="true">
        {/* Sitting dog: head+ears+body merged into one shape */}
        <path fill={fill} d="
          M22 6 C18 3 12 6 12 12 C12 16 14 18 17 19
          L16 22 C12 25 10 31 10 38
          L10 58 C10 61 13 64 16 64
          L24 64 L24 58 L40 58 L40 64 L48 64
          C51 64 54 61 54 58 L54 38
          C54 31 52 25 48 22 L47 19
          C50 18 52 16 52 12
          C52 6 46 3 42 6
          L38 4 C35 1 29 1 26 4 Z
        "/>
      </svg>
    );
  }
  if (level === 2) {
    // Stencil — one connected piece, detail is part of the outer edge (nose/ear bumps), no holes
    return (
      <svg viewBox="0 0 64 72" aria-hidden="true">
        <path fill={fill} d="
          M22 6 C18 3 12 6 12 12 C12 16 14 18 17 19
          L16 22 C12 25 10 31 10 38
          L10 58 C10 61 13 64 16 64
          L24 64 L24 58 L40 58 L40 64 L48 64
          C51 64 54 61 54 58 L54 38
          C54 31 52 25 48 22 L47 19
          C50 18 52 16 52 12
          C52 6 46 3 42 6
          L38 4 C35 1 29 1 26 4 Z
        "/>
        {/* Muzzle bump — protrudes from body outline, not a hole */}
        <path fill={fill} d="M26 36 C26 34 28 32 32 32 C36 32 38 34 38 36 C38 40 36 42 32 43 C28 42 26 40 26 36 Z"/>
        {/* Tail curl — separate connected bump */}
        <path fill={fill} d="M54 42 C58 38 62 40 62 46 C62 50 60 53 56 52 C58 50 58 46 54 42 Z"/>
      </svg>
    );
  }
  // level === 3 — Multi-shape: head, body, tail as distinct separate pieces
  return (
    <svg viewBox="0 0 64 72" aria-hidden="true">
      {/* Body */}
      <ellipse fill={fill} cx="32" cy="50" rx="20" ry="16"/>
      {/* Head */}
      <circle fill={fill} cx="32" cy="22" r="16"/>
      {/* Left ear */}
      <ellipse fill={fill} cx="22" cy="10" rx="7" ry="9"/>
      {/* Right ear */}
      <ellipse fill={fill} cx="42" cy="10" rx="7" ry="9"/>
      {/* Tail */}
      <path fill={fill} d="M50 48 C56 42 62 44 60 52 C58 58 52 58 50 54 Z"/>
    </svg>
  );
}

function aiSvgPreviewSrc(svg: string): string {
  const c = "#5a3a1a";
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(
    svg
      .replace(/\sfill="[^"]*"/gi, ` fill="${c}"`)
      .replace(/\sfill='[^']*'/gi, ` fill='${c}'`)
      .replace(/\sstroke="[^"]*"/gi, ' stroke="none"')
      .replace(/\sstroke='[^']*'/gi, " stroke='none'")
      .replace(/\sstroke-width="[^"]*"/gi, "")
      .replace(/\sstroke-width='[^']*'/gi, ""),
  )))}`;
}

type AiPhase =
  | { type: "idle" }
  | { type: "generating"; statusLabel: string }
  | { type: "png-ready"; pngBase64: string }
  | { type: "tracing"; pngBase64: string }
  | { type: "ready"; pngBase64: string; svg: string }
  | { type: "error"; message: string };

function AiGenerateModal({
  language,
  hasApiKey,
  onGenerate,
  onImport,
  onOpenSettings,
  onClose,
}: {
  language: Language;
  hasApiKey: boolean;
  onGenerate: (input: Omit<AiSvgInput, "settings">) => Promise<string>;
  onImport: (svg: string, prompt: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const nl = language === "nl";
  const [prompt, setPrompt] = useState("");
  const [cutterProof, setCutterProof] = useState(true);
  const [complexity, setComplexity] = useState<1 | 2 | 3>(1);
  const [phase, setPhase] = useState<AiPhase>({ type: "idle" });
  // displayPct is the visual progress bar percentage (0-100), driven by timers
  const [displayPct, setDisplayPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const complexityLabels = nl
    ? ["Silhouet", "Stencil", "Multi-vorm"]
    : ["Silhouette", "Stencil", "Multi-shape"];
  const complexityDescs = nl
    ? ["Één gevulde vorm", "Één stuk, weedbaar detail", "2-4 losse vormen"]
    : ["One filled shape", "One piece, weedable detail", "2-4 separate shapes"];

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  // Smoothly animate displayPct toward a target value over duration ms
  function animateTo(target: number, durationMs: number) {
    clearTimer();
    const INTERVAL = 80;
    const steps = Math.max(1, Math.round(durationMs / INTERVAL));
    let step = 0;
    setDisplayPct((current) => {
      const start = current;
      const increment = (target - start) / steps;
      clearTimer();
      timerRef.current = setInterval(() => {
        step++;
        setDisplayPct(start + increment * step);
        if (step >= steps) { clearTimer(); setDisplayPct(target); }
      }, INTERVAL);
      return current;
    });
  }

  async function handleGenerate() {
    if (!prompt.trim() || !hasApiKey) return;
    clearTimer();
    setDisplayPct(0);

    // Fake progress: 0 → 79% over 30 seconds while GPT Image API runs
    const FAKE_DURATION = 30000;
    const FAKE_TARGET = 79;
    const INTERVAL = 200;
    const steps = FAKE_DURATION / INTERVAL;
    const inc = FAKE_TARGET / steps;
    let fakeStep = 0;
    timerRef.current = setInterval(() => {
      fakeStep++;
      setDisplayPct(Math.min(FAKE_TARGET, fakeStep * inc));
      if (fakeStep >= steps) clearTimer();
    }, INTERVAL);

    const modelLabel = nl ? "Afbeelding genereren…" : "Generating image…";
    setPhase({ type: "generating", statusLabel: modelLabel });

    let pngBase64Captured = "";

    try {
      const svg = await onGenerate({
        prompt: prompt.trim(),
        cutterProof,
        complexity,
        language,
        onPreview: (png) => {
          // PNG received — stop fake timer, animate to 80% over 1s, then show PNG for 2s
          clearTimer();
          pngBase64Captured = png;
          animateTo(80, 1000);
          setTimeout(() => {
            setPhase({ type: "png-ready", pngBase64: png });
            // Tracing starts immediately after (it's already done by now since onPreview
            // is called from ai-svg-generate right before the SVG return)
          }, 1000);
        },
      });

      // Potrace is done — animate to 90% over 2s, then show both previews
      clearTimer();
      setPhase({ type: "tracing", pngBase64: pngBase64Captured });
      animateTo(100, 2000);
      setTimeout(() => {
        setDisplayPct(100);
        setPhase({ type: "ready", pngBase64: pngBase64Captured, svg });
      }, 2000);

    } catch (e) {
      clearTimer();
      setPhase({ type: "error", message: e instanceof Error ? e.message : String(e) });
      setDisplayPct(0);
    }
  }

  function handleImport(svg: string) {
    onImport(svg, prompt.trim());
    onClose();
  }

  function handleRegenerate() {
    clearTimer();
    setPhase({ type: "idle" });
    setDisplayPct(0);
    void handleGenerate();
  }

  const isGenerating = phase.type === "generating" || phase.type === "png-ready" || phase.type === "tracing";
  const showBar = phase.type !== "idle" && phase.type !== "error";
  const isReady = phase.type === "ready";

  const statusLabel = (() => {
    if (phase.type === "generating") return phase.statusLabel;
    if (phase.type === "png-ready") return nl ? "Afbeelding ontvangen — vectorpaden traceren…" : "Image received — tracing vector paths…";
    if (phase.type === "tracing") return nl ? "Vectorpaden traceren…" : "Tracing vector paths…";
    if (phase.type === "ready") return nl ? "Klaar — bekijk en importeer het ontwerp" : "Ready — review and import the design";
    return "";
  })();

  return (
    <div
      className="cut-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget && !isGenerating) onClose(); }}
    >
      <div className="cut-modal cut-modal--narrow" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "AI-ontwerp genereren" : "Generate AI design"}</h2>
          {!isGenerating && (
            <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          )}
        </div>

        <div className="cut-modal__body cut-modal__body--col">
          {!hasApiKey && (
            <div className="ai-modal__no-key">
              <p>{nl ? "Geen API-sleutel ingesteld." : "No API key configured."}</p>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onOpenSettings}>
                {nl ? "Instellingen openen" : "Open settings"}
              </button>
            </div>
          )}

          <label className="settings-modal__label" htmlFor="ai-prompt">
            {nl ? "Beschrijving" : "Description"}
          </label>
          <textarea
            id="ai-prompt"
            className="ai-modal__prompt"
            rows={3}
            placeholder={nl ? "Blije hond…" : "Happy dog…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isGenerating) void handleGenerate();
              e.stopPropagation();
            }}
            autoFocus={!isGenerating}
          />

          <div className="ai-modal__complexity">
            <span className="settings-modal__label">{nl ? "Complexiteit" : "Complexity"}</span>
            <div className="ai-modal__complexity-toggles">
              {([1, 2, 3] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  disabled={isGenerating}
                  className={`ai-modal__complexity-btn${complexity === lvl ? " ai-modal__complexity-btn--active" : ""}`}
                  onClick={() => setComplexity(lvl)}
                  title={`${complexityLabels[lvl - 1]} — ${complexityDescs[lvl - 1]}`}
                >
                  <ComplexityDogIcon level={lvl} />
                  <span className="ai-modal__complexity-btn-label">{complexityLabels[lvl - 1]}</span>
                  <span className="ai-modal__complexity-btn-desc">{complexityDescs[lvl - 1]}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="ai-modal__checkbox-label">
            <input type="checkbox" checked={cutterProof} onChange={(e) => setCutterProof(e.target.checked)} disabled={isGenerating} />
            <span>
              {nl ? "Snijveilig" : "Cutter-proof"}
              <em>{nl ? " — ontwerp blijft in één stuk" : " — design stays in one piece"}</em>
            </span>
          </label>

          {/* Progress bar */}
          {showBar && (
            <div className="ai-modal__progress">
              <div className="ai-modal__progress-label">
                {isGenerating && <span className="ai-modal__spinner" aria-hidden="true" />}
                <span>{statusLabel}</span>
              </div>
              <div className="ai-modal__progress-bar-track">
                <div className="ai-modal__progress-bar-fill" style={{ width: `${displayPct}%`, transition: "width 0.4s ease" }} />
              </div>
              <div className="ai-modal__progress-pct">{Math.round(displayPct)}%</div>
            </div>
          )}

          {/* Previews — PNG and/or SVG side by side */}
          {(phase.type === "png-ready" || phase.type === "tracing" || phase.type === "ready") && (
            <div className={`ai-modal__previews${phase.type === "ready" ? " ai-modal__previews--dual" : ""}`}>
              <div className="ai-modal__preview-col">
                <img
                  src={`data:image/png;base64,${(phase as { pngBase64: string }).pngBase64}`}
                  className="ai-modal__preview-img"
                  alt={nl ? "AI afbeelding" : "AI image"}
                />
                <span className="ai-modal__preview-label">
                  {nl ? "AI afbeelding" : "AI image"}
                </span>
              </div>
              {phase.type === "ready" && (
                <div className="ai-modal__preview-col">
                  <img
                    src={aiSvgPreviewSrc(phase.svg)}
                    className="ai-modal__preview-img"
                    alt={nl ? "Vectortracering" : "Vector trace"}
                  />
                  <span className="ai-modal__preview-label">
                    {nl ? "Vector tracering" : "Vector trace"}
                  </span>
                </div>
              )}
            </div>
          )}

          {phase.type === "error" && <p className="ai-modal__error">{phase.message}</p>}
        </div>

        <div className="cut-modal__footer">
          {isReady ? (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onClose}>
                {nl ? "Annuleren" : "Cancel"}
              </button>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={handleRegenerate}>
                {nl ? "Opnieuw" : "Regenerate"}
              </button>
              <button type="button" className="cut-modal__btn cut-modal__btn--primary" onClick={() => handleImport((phase as { svg: string }).svg)}>
                {nl ? "Importeren" : "Import"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={isGenerating} onClick={onClose}>
                {nl ? "Annuleren" : "Cancel"}
              </button>
              <button
                type="button"
                className="cut-modal__btn cut-modal__btn--primary"
                disabled={isGenerating || !prompt.trim() || !hasApiKey}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? (nl ? "Bezig…" : "Working…") : (nl ? "Genereren" : "Generate")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CutPreviewModal({
  language,
  preview,
  cutBusy,
  cutSession,
  onClose,
  onConfirmCut,
  onContinueCut,
  onStopCut,
}: {
  language: Language;
  preview: { plan: SlicebugPlanResult; svg: string; matPreset: string };
  cutBusy: boolean;
  cutSession: CutSessionSnapshot | null;
  onClose: () => void;
  onConfirmCut: () => void;
  onContinueCut: () => void;
  onStopCut: () => void;
}) {
  const nl = language === "nl";
  const { plan, svg, matPreset } = preview;
  const matDims = getMatDimensionsInches(matPreset);
  const aspectRatio = matDims.width / matDims.height;
  const previewH = 320;
  const previewW = Math.round(previewH * aspectRatio);

  const isCutting = cutSession !== null && cutSession.status !== "finished" && cutSession.status !== "error" && cutSession.status !== "stopped";
  const isFinished = cutSession?.status === "finished";
  const isError = cutSession?.status === "error";
  const needsContinue = cutSession?.action.requiresContinue ?? false;

  return (
    <div className="cut-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !isCutting) onClose(); }}>
      <div className="cut-modal" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "Snijden voorbereiden" : "Prepare cut"}</h2>
          {!isCutting && (
            <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 3l10 10M13 3L3 13"/>
              </svg>
            </button>
          )}
        </div>

        <div className="cut-modal__body">
          <div className="cut-modal__preview-area">
            <div
              className="cut-modal__mat"
              style={{ width: previewW, height: previewH }}
              aria-label={nl ? "Matvoorbeeld" : "Mat preview"}
            >
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                width={previewW}
                height={previewH}
                alt=""
                style={{ width: previewW, height: previewH, display: "block" }}
              />
            </div>
            <p className="cut-modal__mat-label">{matDims.width} × {matDims.height} in · {getMatName(matPreset, language)}</p>
          </div>

          <div className="cut-modal__info">
            {plan.ok && plan.plan ? (
              <div className="cut-modal__plan-summary">
                <div className="cut-modal__plan-row">
                  <span>{nl ? "Materiaal" : "Material"}</span>
                  <strong>{MATERIAL_OPTIONS.find((m) => m.id === plan.plan!.material.type)?.name ?? `ID ${plan.plan.material.type}`}</strong>
                </div>
                <div className="cut-modal__plan-row">
                  <span>{nl ? "Paden" : "Paths"}</span>
                  <strong>{plan.plan.pathCount}</strong>
                </div>
                {plan.plan.tools.length > 0 && (
                  <div className="cut-modal__plan-row">
                    <span>{nl ? "Gereedschap" : "Tools"}</span>
                    <strong>{plan.plan.tools.join(", ")}</strong>
                  </div>
                )}
              </div>
            ) : (
              <p className="cut-modal__plan-error">{plan.message}</p>
            )}

            {cutSession && (
              <div className={`cut-modal__status cut-modal__status--${cutSession.action.tone}`}>
                <p className="cut-modal__status-title">{cutSession.action.title}</p>
                {cutSession.action.message && <p className="cut-modal__status-message">{cutSession.action.message}</p>}
                {cutSession.transcript && (
                  <pre className="cut-modal__transcript">{cutSession.transcript}</pre>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="cut-modal__footer">
          {!isCutting && !isFinished && (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onClose}>
                {nl ? "Annuleren" : "Cancel"}
              </button>
              <button
                type="button"
                className="cut-modal__btn cut-modal__btn--primary"
                disabled={!plan.ok || !plan.plan || cutBusy}
                onClick={onConfirmCut}
              >
                {cutBusy ? (nl ? "Bezig…" : "Working…") : (nl ? "Start snijden" : "Start cutting")}
              </button>
            </>
          )}
          {isCutting && (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={cutBusy} onClick={onStopCut}>
                {nl ? "Stop" : "Stop"}
              </button>
              {needsContinue && (
                <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={cutBusy} onClick={onContinueCut}>
                  {nl ? "Doorgaan" : "Continue"}
                </button>
              )}
            </>
          )}
          {(isFinished || isError) && (
            <button type="button" className="cut-modal__btn cut-modal__btn--primary" onClick={onClose}>
              {nl ? "Sluiten" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Ruler({ axis, ticks, unit }: { axis: "x" | "y"; ticks: ReturnType<typeof getMeasurementTicks>; unit: MeasurementUnit }) {
  return (
    <div className={`ruler ruler--${axis}`} aria-label={`${axis.toUpperCase()} ruler in ${unit}`}>
      <span className="ruler__unit">{unit}</span>
      {ticks.map((tick) => (
        <span
          key={`${axis}-${tick.value}`}
          className={tick.major ? "ruler__tick ruler__tick--major" : "ruler__tick"}
          style={axis === "x" ? { left: tick.position } : { top: tick.position }}
        >
          {tick.label ? <em>{tick.label}</em> : null}
        </span>
      ))}
    </div>
  );
}

function ImageLibraryPanel({
  language,
  hasActiveAiKey,
  images,
  loading,
  onAskAi,
  onFileImport,
  onUseImage,
  onDeleteImage,
}: {
  language: Language;
  hasActiveAiKey: boolean;
  images: LibraryImage[];
  loading: boolean;
  onAskAi: () => void;
  onFileImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onUseImage: (img: LibraryImage) => void;
  onDeleteImage: (path: string) => void;
}) {
  const nl = language === "nl";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "ai" | "uploaded">("all");
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const filtered = images.filter((img) => {
    if (filter === "ai" && !img.isAi) return false;
    if (filter === "uploaded" && img.isAi) return false;
    if (search.trim()) {
      return img.name.toLowerCase().includes(search.trim().toLowerCase());
    }
    return true;
  });

  function svgPreviewSrc(svg: string): string {
    try {
      // Render the thumbnail filled with the app brown (#5a3a1a) and no stroke,
      // respecting fill-rule so compound paths (e.g. eyes as holes) display correctly.
      const PREVIEW_COLOR = "#5a3a1a";
      // Replace ALL fill values (including "none") with the preview colour.
      // Holes in compound paths are transparent via fill-rule="evenodd", not via fill="none".
      // Stroke-based (older) images also become visible this way.
      const styled = svg
        .replace(/\sfill="[^"]*"/gi, ` fill="${PREVIEW_COLOR}"`)
        .replace(/\sfill='[^']*'/gi, ` fill='${PREVIEW_COLOR}'`)
        .replace(/\sstroke="[^"]*"/gi, ' stroke="none"')
        .replace(/\sstroke='[^']*'/gi, " stroke='none'")
        .replace(/\sstroke-width="[^"]*"/gi, "")
        .replace(/\sstroke-width='[^']*'/gi, "");
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(styled)))}`;
    } catch {
      return "";
    }
  }

  return (
    <aside className="image-library no-drag" aria-label={nl ? "Afbeeldingsbibliotheek" : "Image library"}>
      <div className="image-library__actions">
        <button
          type="button"
          className={`image-library__action-btn${hasActiveAiKey ? "" : " image-library__action-btn--warn"}`}
          onClick={onAskAi}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 1L9.5 5.5H14L10.5 8.5L12 13L8 10.5L4 13L5.5 8.5L2 5.5H6.5Z"/></svg>
          {nl ? "AI genereren" : "Ask AI"}
        </button>
        <label className="image-library__action-btn">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M2 10.5 5.5 7l2.5 2.5 2-2 4 4"/><circle cx="10.5" cy="5.5" r="1.2" fill="currentColor" stroke="none"/></svg>
          {nl ? "Van PC" : "Open from PC"}
          <input type="file" accept=".svg,image/svg+xml" multiple onChange={onFileImport} />
        </label>
      </div>

      <input
        type="search"
        className="image-library__search"
        placeholder={nl ? "Zoeken…" : "Search…"}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="image-library__filters">
        {(["all", "ai", "uploaded"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`image-library__filter${filter === f ? " image-library__filter--active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? (nl ? "Alle" : "All") : f === "ai" ? "AI" : (nl ? "Upload" : "Upload")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="image-library__empty">{nl ? "Laden…" : "Loading…"}</div>
      ) : filtered.length === 0 ? (
        <div className="image-library__empty">
          {search.trim()
            ? (nl ? "Geen resultaten" : "No results")
            : (nl ? "Bibliotheek is leeg" : "Library is empty")}
        </div>
      ) : (
        <div className="image-library__grid">
          {filtered.map((img) => (
            <div key={img.path} className="image-tile" onClick={() => { if (confirmDeletePath !== img.path) onUseImage(img); }}>
              <img
                className="image-tile__preview"
                src={svgPreviewSrc(img.svg)}
                alt={img.name}
                draggable={false}
              />
              <span className="image-tile__badge">
                {img.isAi
                  ? <svg viewBox="0 0 12 12" fill="currentColor" aria-label="AI"><path d="M6 0l1.2 3.8H11L7.9 6.2l1.2 3.8L6 7.8 2.9 10l1.2-3.8L1 3.8h3.8Z"/></svg>
                  : <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-label="Uploaded"><circle cx="6" cy="4" r="2.5"/><path d="M1.5 11c0-2.5 9-2.5 9 0"/></svg>
                }
              </span>
              {confirmDeletePath === img.path ? (
                <div className="image-tile__confirm" onClick={(e) => e.stopPropagation()}>
                  <span>{nl ? "Verwijderen?" : "Delete?"}</span>
                  <button type="button" className="image-tile__confirm-yes" onClick={(e) => { e.stopPropagation(); onDeleteImage(img.path); setConfirmDeletePath(null); }}>
                    {nl ? "Ja" : "Yes"}
                  </button>
                  <button type="button" className="image-tile__confirm-no" onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(null); }}>
                    {nl ? "Nee" : "No"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="image-tile__delete"
                  title={nl ? "Verwijderen" : "Delete"}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(img.path); }}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 3.5h10M5.5 3.5V2.5h3v1M4 3.5l.7 8h4.6l.7-8"/></svg>
                </button>
              )}
              <span className="image-tile__name">{img.name}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function ShapeLibraryPanel({
  language,
  onAddShape,
}: {
  language: Language;
  onAddShape: (shapeKind: WorkspaceShapeKind) => void;
}) {
  return (
    <aside
      id="shape-library-panel"
      className="shape-library no-drag"
      aria-label={language === "nl" ? "Vormenbibliotheek" : "Shape library"}
    >
      <p className="panel-label">{language === "nl" ? "Vormen" : "Shapes"}</p>
      <h2>{language === "nl" ? "Kies een basisvorm" : "Choose a basic shape"}</h2>
      <p>{language === "nl" ? "Plaats een vorm op de mat. Daarna kun je hem slepen, vergroten, draaien of kopieren." : "Place a shape on the mat. Then move, resize, rotate, or copy it."}</p>
      <div className="shape-library__grid">
        {WORKSPACE_SHAPES.map((shape) => {
          const label = language === "nl" ? shape.labelNl : shape.labelEn;
          return (
            <button key={shape.kind} type="button" className="shape-tile" onClick={() => onAddShape(shape.kind)}>
              <span aria-hidden="true">{shape.icon}</span>
              <strong>{label}</strong>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function TextEditOverlay({
  item,
  onCommit,
  onCancel,
}: {
  item: WorkspaceObject;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const tc = item.textContent!;
  const [value, setValue] = useState(tc.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Font size in CSS pixels: item div is sized to frame*scaleX, so fontSize*scaleX matches SVG.
  const scaledFontSize = tc.fontSize * item.transform.scaleX;

  // Click anywhere outside the overlay commits and exits edit mode
  useEffect(() => {
    function handleGlobalDown(e: globalThis.PointerEvent) {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        onCommit(value);
      }
    }
    document.addEventListener("pointerdown", handleGlobalDown, { capture: true });
    return () => document.removeEventListener("pointerdown", handleGlobalDown, { capture: true });
  }, [value, onCommit]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === "Escape") { onCancel(); }
  }

  return (
    <textarea
      ref={textareaRef}
      autoFocus
      className="text-edit-overlay"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      style={{
        fontFamily: tc.fontFamily,
        fontSize: scaledFontSize,
        fontWeight: tc.fontWeight,
        fontStyle: tc.fontStyle,
        textDecoration: tc.textDecoration,
        textAlign: tc.textAlign ?? "left",
        letterSpacing: (tc.letterSpacing * item.transform.scaleX) + "px",
        lineHeight: tc.lineHeight,
        color: tc.color,
        width: "100%",
        height: "100%",
      }}
    />
  );
}

function WorkspaceObjectArtwork({ item, tools }: { item: WorkspaceObject; tools?: WorkspaceTool[] }) {
  // Text items: render using SVG <text> elements for live display
  if (item.textContent && item.paths.length === 0) {
    const tc = item.textContent;
    const lineH = tc.fontSize * tc.lineHeight;
    const matchedTool = tools?.find((t) => t.color.toLowerCase() === tc.color.toLowerCase());
    const displayColor = matchedTool ? matchedTool.color : tc.color;
    const anchorX = tc.textAlign === "center" ? item.frame.width / 2 : tc.textAlign === "right" ? item.frame.width - 1 : 1;
    const textAnchor = tc.textAlign === "center" ? "middle" : tc.textAlign === "right" ? "end" : "start";
    return (
      <svg aria-hidden="true" focusable="false" width="100%" height="100%"
        viewBox={`0 0 ${item.frame.width} ${item.frame.height}`} preserveAspectRatio="xMinYMin meet"
      >
        {tc.text.split("\n").map((line, i) => (
          <text key={i} x={anchorX} y={tc.fontSize + i * lineH}
            fontFamily={tc.fontFamily} fontSize={tc.fontSize}
            fontWeight={tc.fontWeight} fontStyle={tc.fontStyle}
            textDecoration={tc.textDecoration} textAnchor={textAnchor}
            fill={displayColor} letterSpacing={tc.letterSpacing}
          >{line || " "}</text>
        ))}
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="100%"
      viewBox={`0 0 ${item.frame.width} ${item.frame.height}`}
      preserveAspectRatio="none"
    >
      {item.paths.map((path) => {
        const matchedTool = tools?.find((t) => t.color.toLowerCase() === (path.stroke ?? "").toLowerCase());
        const isPen = matchedTool?.type === "pen";
        // For pen: no fill. For cut (or unmatched): use the tool's color as fill so the
        // silhouette is visible. Fall back to path.fill if it's a non-none value (manually
        // imported SVGs may carry their own fill), otherwise use stroke color at low opacity.
        let effectiveFill: string;
        if (isPen) {
          effectiveFill = "none";
        } else if (matchedTool) {
          effectiveFill = matchedTool.color;
        } else if (path.fill && path.fill !== "none") {
          effectiveFill = path.fill;
        } else {
          effectiveFill = path.stroke ?? "#000000";
        }
        return (
          <path
            key={path.id}
            d={path.d}
            fill={effectiveFill}
            fillRule={path.fillRule as "evenodd" | "nonzero" | undefined}
            stroke={path.stroke}
            strokeWidth={path.strokeWidth}
            strokeLinecap={path.strokeLinecap as "butt" | "round" | "square" | "inherit" | undefined}
            strokeLinejoin={path.strokeLinejoin as "miter" | "round" | "bevel" | "inherit" | undefined}
            transform={path.pathTransform}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

function ToolbarBtn({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toolbar-btn"
      aria-label={label}
      data-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

function WorkspaceToolbar({
  language,
  canCopy,
  canCut,
  canPaste,
  canDelete,
  canGroup,
  canUngroup,
  canFlip,
  projectSaving,
  projectOpening,
  onOpen,
  onSave,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onGroup,
  onUngroup,
  onFlipX,
  onFlipY,
}: {
  language: Language;
  canCopy: boolean;
  canCut: boolean;
  canPaste: boolean;
  canDelete: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canFlip: boolean;
  projectSaving: boolean;
  projectOpening: boolean;
  onOpen: () => void;
  onSave: () => void;
  onCopy: () => boolean;
  onCut: () => boolean;
  onPaste: () => boolean;
  onDelete: () => boolean;
  onGroup: () => boolean;
  onUngroup: () => boolean;
  onFlipX: () => boolean;
  onFlipY: () => boolean;
}) {
  const nl = language === "nl";
  return (
    <nav className="workspace-toolbar no-drag" role="toolbar" aria-label={nl ? "Werkbalk" : "Toolbar"}>
      <div className="toolbar-group">
        {/* Open — folder */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.586a1 1 0 0 1 .707.293L10.5 6.5H15.5A1.5 1.5 0 0 1 17 8v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14V6.5z"/></svg>}
          label={nl ? "Open" : "Open"}
          onClick={onOpen}
          disabled={projectOpening || projectSaving}
        />
        {/* Save — floppy disk */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><rect x="7" y="3" width="6" height="5" rx="0.5" fill="currentColor" stroke="none"/><rect x="6" y="11" width="8" height="5" rx="1"/></svg>}
          label={nl ? "Opslaan" : "Save"}
          onClick={onSave}
          disabled={projectOpening || projectSaving}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Copy — two overlapping pages */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="7" width="9" height="10" rx="1.5"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 5v7.5A1.5 1.5 0 0 0 4 14h3"/></svg>}
          label={nl ? "Kopieer" : "Copy"}
          onClick={onCopy}
          disabled={!canCopy}
        />
        {/* Cut — scissors */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="4.5" cy="6" r="2"/><circle cx="4.5" cy="14" r="2"/><path d="M6.5 7.5 17 13"/><path d="M6.5 12.5 17 7"/></svg>}
          label={nl ? "Knippen" : "Cut"}
          onClick={onCut}
          disabled={!canCut}
        />
        {/* Paste — clipboard */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="11" height="12" rx="1.5"/><path d="M8 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/><path d="M8 10h5M8 13h3"/></svg>}
          label={nl ? "Plakken" : "Paste"}
          onClick={onPaste}
          disabled={!canPaste}
        />
        {/* Delete — trash */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.75 10a1.5 1.5 0 0 0 1.5 1.5h4.5a1.5 1.5 0 0 0 1.5-1.5l.75-10"/><path d="M8.5 9v4M11.5 9v4"/></svg>}
          label={nl ? "Verwijder" : "Delete"}
          onClick={onDelete}
          disabled={!canDelete}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Group — dashed bounding box with two rects inside */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="2" strokeDasharray="3 2"/><rect x="4" y="4" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/></svg>}
          label={nl ? "Groeperen" : "Group"}
          onClick={onGroup}
          disabled={!canGroup}
        />
        {/* Ungroup — two rects pulling apart */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="7" height="7" rx="1.5"/><rect x="11" y="8" width="7" height="7" rx="1.5"/><path d="M9 8.5l2 1.5M9 10l2-1" strokeWidth="1" strokeDasharray="2 1.5"/></svg>}
          label={nl ? "Groep opheffen" : "Ungroup"}
          onClick={onUngroup}
          disabled={!canUngroup}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Flip horizontal — vertical axis, triangles pointing left and right (Tabler pattern) */}
        <ToolbarBtn
          icon={
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              {/* Vertical dashed axis */}
              <line x1="10" y1="2" x2="10" y2="18" strokeDasharray="2 1.5" strokeWidth="1.2"/>
              {/* Left triangle — flat base on axis, tip pointing left */}
              <path d="M9 5 L9 15 L3 10 Z" fill="currentColor" stroke="none"/>
              {/* Right triangle — flat base on axis, tip pointing right (reflection) */}
              <path d="M11 5 L11 15 L17 10 Z" fill="currentColor" stroke="none" fillOpacity="0.35"/>
            </svg>
          }
          label={nl ? "Spiegelen horizontaal" : "Flip horizontal"}
          onClick={onFlipX}
          disabled={!canFlip}
        />
        {/* Flip vertical — horizontal axis, triangles pointing up and down */}
        <ToolbarBtn
          icon={
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              {/* Horizontal dashed axis */}
              <line x1="2" y1="10" x2="18" y2="10" strokeDasharray="2 1.5" strokeWidth="1.2"/>
              {/* Top triangle — flat base on axis, tip pointing up */}
              <path d="M5 9 L15 9 L10 3 Z" fill="currentColor" stroke="none"/>
              {/* Bottom triangle — flat base on axis, tip pointing down (reflection) */}
              <path d="M5 11 L15 11 L10 17 Z" fill="currentColor" stroke="none" fillOpacity="0.35"/>
            </svg>
          }
          label={nl ? "Spiegelen verticaal" : "Flip vertical"}
          onClick={onFlipY}
          disabled={!canFlip}
        />
      </div>
    </nav>
  );
}

function getSandboxedSvgPreview(svg: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        display: grid;
        place-items: center;
        background: #fffdf9;
      }

      svg {
        max-width: 92%;
        max-height: 92%;
        overflow: visible;
      }

      svg [stroke]:not([stroke="none"]) {
        vector-effect: non-scaling-stroke;
      }
    </style>
  </head>
  <body>${svg}</body>
</html>`;
}

function WelcomeScreen({
  language,
  statusCopy,
  statusDetailsLabel,
  samplePlanLoading,
  slicebugLoading,
  onLanguageChange,
  onNewProject,
  onOpenProject,
  onExampleProject,
  onCheckSetup,
}: {
  language: Language;
  statusCopy: ReturnType<typeof getFriendlySlicebugStatusCopy>;
  statusDetailsLabel: string;
  samplePlanLoading: boolean;
  slicebugLoading: boolean;
  onLanguageChange: (language: Language) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onExampleProject: () => void;
  onCheckSetup: () => void;
}) {
  const { t } = createTranslator(language);

  return (
    <main className="app-shell welcome-shell">
      <div className="native-window-drag-zone app-drag" aria-hidden="true" />
      <section className="welcome-screen" aria-label={t("welcome.eyebrow")}>
        <div className="welcome-screen__top no-drag">
          <p className="eyebrow">{t("welcome.eyebrow")}</p>
          <LanguageSelector language={language} onLanguageChange={onLanguageChange} />
        </div>

        <div className="welcome-hero">
          <div>
            <h1>{APP_NAME}</h1>
            <p className="lede">{t("welcome.lede")}</p>
          </div>
          <div className="welcome-card-stack" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="welcome-project-actions no-drag">
          <button className="project-choice project-choice--primary" type="button" onClick={onNewProject}>
            <span>{t("welcome.newProject")}</span>
            <small>{t("welcome.newProjectCopy")}</small>
          </button>
          <button className="project-choice" type="button" onClick={onOpenProject}>
            <span>{t("welcome.openProject")}</span>
            <small>{t("welcome.openProjectCopy")}</small>
          </button>
          <button className="project-choice" type="button" onClick={onExampleProject} disabled={samplePlanLoading}>
            <span>{samplePlanLoading ? t("buttons.preparingPreview") : t("welcome.exampleProject")}</span>
            <small>{t("welcome.exampleProjectCopy")}</small>
          </button>
        </div>

        <aside className={`setup-panel setup-panel--${statusCopy.tone} no-drag`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <p className="panel-label">{t("status.panelLabel")}</p>
            <h2>{statusCopy.title}</h2>
            <p>{statusCopy.message}</p>
            <button className="secondary-button" type="button" onClick={onCheckSetup} disabled={slicebugLoading}>
              {slicebugLoading ? t("buttons.checking") : t("buttons.checkSetupAgain")}
            </button>
            {statusCopy.details.length > 0 ? (
              <details>
                <summary>{statusDetailsLabel}</summary>
                <pre>{statusCopy.details.join("\n")}</pre>
              </details>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}

function LanguageSelector({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const { t } = createTranslator(language);

  return (
    <label className="language-selector">
      <span>{t("language.label")}</span>
      <select value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
        {LANGUAGES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {t(candidate === "nl" ? "language.nl" : "language.en")}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyImportState({ language }: { language: Language }) {
  const { t } = createTranslator(language);

  return (
    <div className="import-empty">
      <div className="paper-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{t("import.empty")}</p>
    </div>
  );
}

function ImportedSvgPreview({ importedSvg, language }: { importedSvg: WorkspaceSvgItem; language: Language }) {
  const { t } = createTranslator(language);
  const svg = buildWorkspaceObjectSvg(importedSvg);
  const preflight = preflightSvg(svg);
  const friendlyMessages = getFriendlySvgMessages(preflight, language);
  const isReady = preflight.ok && preflight.warnings.length === 0;

  return (
    <div className="import-preview-grid">
      <div className="svg-preview-frame">
        <iframe title={t("import.previewTitle", { fileName: importedSvg.fileName })} sandbox="" srcDoc={getSandboxedSvgPreview(svg)} />
      </div>

      <div className="import-summary">
        <p className="panel-label">{t("import.chosenFile")}</p>
        <h3>{importedSvg.fileName}</h3>
        <dl className="friendly-list compact-list">
          <dt>{t("import.file")}</dt>
          <dd>{importedSvg.fileSize}</dd>
          <dt>{t("import.artwork")}</dt>
          <dd>{importedSvg.sizeCopy}</dd>
        </dl>

        <div className={`svg-check svg-check--${isReady ? "ready" : "warning"}`}>
          <h3>{isReady ? t("import.readyTitle") : t("import.warningTitle")}</h3>
          {friendlyMessages.length > 0 ? (
            <ul className="plain-list">
              {friendlyMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : (
            <p>{t("import.readyMessage")}</p>
          )}
        </div>

        <details>
          <summary>{t("details.svgCheck")}</summary>
          <pre>
            {[
              preflight.issues.length > 0
                ? `Issues:\n${preflight.issues.join("\n")}`
                : "Issues: none",
              preflight.warnings.length > 0
                ? `Warnings:\n${preflight.warnings.join("\n")}`
                : "Warnings: none",
            ].join("\n\n")}
          </pre>
        </details>

        <details>
          <summary>{t("details.rawSvg")}</summary>
          <pre>{svg}</pre>
        </details>
      </div>
    </div>
  );
}

function MaterialMatChooser({
  language,
  selectedMaterialId,
  selectedMatPreset,
  onMaterialChange,
  onMatChange,
}: {
  language: Language;
  selectedMaterialId: number;
  selectedMatPreset: string;
  onMaterialChange: (materialId: number) => void;
  onMatChange: (matPreset: string) => void;
}) {
  const { t } = createTranslator(language);
  const materialCopy = getMaterialBeginnerCopy(selectedMaterialId, language);
  const matCopy = getMatBeginnerCopy(selectedMatPreset, language);

  return (
    <div className="choice-panel" aria-label={t("choice.aria")}>
      <label>
        {t("choice.material")}
        <select value={selectedMaterialId} onChange={(event) => onMaterialChange(Number(event.target.value))}>
          {MATERIAL_OPTIONS.map((material) => (
            <option key={material.id} value={material.id}>
              {getMaterialName(material.id, language) ?? material.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("choice.mat")}
        <select value={selectedMatPreset} onChange={(event) => onMatChange(event.target.value)}>
          {MAT_PRESETS.map((mat) => (
            <option key={mat.id} value={mat.id}>
              {getMatName(mat.id, language) ?? mat.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        {materialCopy ?? MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.beginnerCopy}{" "}
        {matCopy ?? MAT_PRESETS.find((mat) => mat.id === selectedMatPreset)?.beginnerCopy}
      </p>
    </div>
  );
}

function PlanAndCutMonitor({
  result,
  planLabel,
  language,
  cutSession,
  cutBusy,
  onStart,
  onContinue,
  onStop,
}: {
  result: SlicebugPlanResult;
  planLabel: string;
  language: Language;
  cutSession: CutSessionSnapshot | null;
  cutBusy: boolean;
  onStart: () => void;
  onContinue: () => void;
  onStop: () => void;
}) {
  const { t } = createTranslator(language);
  const copy = getFriendlyPlanResultCopy(result, language);
  const canStart = result.ok && result.plan && !cutSession;
  const cutActionCopy = cutSession ? getCutActionCopy(cutSession.action, language) : null;

  return (
    <div className={`sample-result sample-result--${copy.tone}`}>
      <p className="panel-label">{t("plan.importedPanelLabel")}</p>
      <h3>{result.ok ? t("plan.readyToSendTitle") : copy.title}</h3>
      <p>
        {t("plan.currentPlan")} <strong>{planLabel}</strong>. {copy.message}
      </p>
      {result.plan ? (
        <dl className="friendly-list compact-list">
          <dt>{t("plan.layers")}</dt>
          <dd>{result.plan.pathCount}</dd>
          <dt>{t("plan.tools")}</dt>
          <dd>{result.plan.tools.map((tool) => formatToolName(tool, language)).join(", ") || t("plan.noTools")}</dd>
        </dl>
      ) : null}

      {canStart ? (
        <div className="cut-start">
          <button type="button" onClick={onStart} disabled={cutBusy}>
            {cutBusy ? t("buttons.starting") : t("buttons.startCut")}
          </button>
          <p>{t("plan.startCutNote")}</p>
        </div>
      ) : null}

      {cutSession && cutActionCopy ? (
        <div className={`cut-monitor cut-monitor--${cutSession.action.tone}`} aria-live="polite">
          <p className="panel-label">{t("cut.panelLabel")}</p>
          <h3>{cutActionCopy.title}</h3>
          <p>{cutActionCopy.message}</p>
          <ol className="cut-progress" aria-label={t("cut.progressLabel")}>
            <li className="cut-progress__done">{t("cut.preparePlan")}</li>
            <li className={cutSession.action.kind === "load-tools" ? "cut-progress__active" : ""}>{t("cut.loadTool")}</li>
            <li className={cutSession.action.kind === "load-mat" ? "cut-progress__active" : ""}>{t("cut.loadMat")}</li>
            <li className={cutSession.action.kind === "running" ? "cut-progress__active" : ""}>{t("cut.cutDraw")}</li>
            <li className={cutSession.action.kind === "finished" ? "cut-progress__active" : ""}>{t("cut.finish")}</li>
          </ol>
          <div className="cut-actions">
            {cutSession.action.requiresContinue ? (
              <button type="button" onClick={onContinue} disabled={cutBusy}>
                {t("buttons.continue")}
              </button>
            ) : null}
            {cutSession.action.canStop ? (
              <button className="secondary-button" type="button" onClick={onStop} disabled={cutBusy}>
                {t("buttons.stop")}
              </button>
            ) : null}
          </div>
          <details>
            <summary>{t("details.cut")}</summary>
            <pre>
              {[
                `${cutSession.command} ${cutSession.args.join(" ")}`,
                cutSession.transcript.trim() || t("cut.noMessages"),
              ].join("\n\n")}
            </pre>
          </details>
        </div>
      ) : null}

      {copy.details.length > 0 ? (
        <details>
          <summary>{t("details.plan")}</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}

function getCutActionCopy(
  action: CutSessionSnapshot["action"],
  language: Language,
): { title: string; message: string } {
  const { t } = createTranslator(language);

  switch (action.kind) {
    case "finished":
      return { title: t("cutAction.finished.title"), message: t("cutAction.finished.message") };
    case "load-mat":
      return { title: t("cutAction.load-mat.title"), message: t("cutAction.load-mat.message") };
    case "load-tools":
      return { title: t("cutAction.load-tools.title"), message: t("cutAction.load-tools.message") };
    case "press-go":
      return { title: t("cutAction.press-go.title"), message: t("cutAction.press-go.message") };
    case "replace-tool":
      return { title: t("cutAction.replace-tool.title"), message: t("cutAction.replace-tool.message") };
    case "running":
      return { title: t("cutAction.running.title"), message: t("cutAction.running.message") };
    case "error":
      return { title: t("cutAction.error.title"), message: t("cutAction.error.message") };
    default:
      return { title: t("cutAction.idle.title"), message: t("cutAction.idle.message") };
  }
}

function EmptyPreviewState({ language }: { language: Language }) {
  const { t } = createTranslator(language);

  return (
    <div className="empty-preview">
      <div className="mat-preview" aria-hidden="true">
        <div className="card-preview">
          <span className="cut-line" />
          <span className="pen-line pen-line--short" />
          <span className="pen-line" />
        </div>
      </div>
      <p>{t("practice.empty")}</p>
    </div>
  );
}

function SamplePlanResult({ result, language }: { result: SlicebugPlanResult; language: Language }) {
  const { t } = createTranslator(language);
  const copy = getFriendlyPlanResultCopy(result, language);

  return (
    <div className={`sample-result sample-result--${copy.tone}`}>
      <h3>{copy.title}</h3>
      <p>{copy.message}</p>
      {result.plan ? (
        <dl className="friendly-list compact-list">
          <dt>{t("plan.layers")}</dt>
          <dd>{result.plan.pathCount}</dd>
          <dt>{t("plan.tools")}</dt>
          <dd>{result.plan.tools.map((tool) => formatToolName(tool, language)).join(", ") || t("plan.noTools")}</dd>
        </dl>
      ) : null}
      {copy.details.length > 0 ? (
        <details>
          <summary>{t("details.advanced")}</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}
