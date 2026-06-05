import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { buildBeginnerProject, joyStandardMat, validateProject } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "@cricut-companion/ai-designer";
import { MAT_PRESETS, MATERIAL_OPTIONS, buildPlanCommand } from "@cricut-companion/slicebug-bridge";
import { preflightSvg } from "@cricut-companion/svg-preflight";
import {
  APP_NAME,
  getFriendlySlicebugStatusCopy,
} from "./onboarding-copy";
import {
  type KindCutProjectFile,
  type WorkspaceTool,
  DEFAULT_PAPER_COLOR,
  DEFAULT_TOOLS,
  buildProjectFile,
  getBehindColor,
  getSafeProjectFileName,
  parseProjectFile,
  serializeProjectFile,
} from "./project-file";
import { formatFileSize } from "./svg-import";
import {
  type WorkspaceObject,
  type WorkspacePathData,
  type WorkspaceSvgItem,
  type WorkspaceTextContent,
  buildWorkspaceObjectsSvg,
  buildWorkspaceCutSvg,
} from "./workspace-objects";
import { clearCenterlineCache, traceCenterlinePathD } from "./centerline-trace";
import { googleFontsHref } from "./font-catalog";
import { extractWorkspacePathsFromSvg } from "./workspace-svg-import";
import {
  type WorkspaceClipboardSvgItem,
  createPastedWorkspaceSvgInputs,
  getSelectedWorkspaceClipboardItems,
} from "./workspace-clipboard";
import {
  type Language,
  createTranslator,
  loadLanguagePreference,
  saveLanguagePreference,
} from "./i18n";
import {
  WORKSPACE_HISTORY_LIMIT,
  WORKSPACE_PIXELS_PER_INCH,
  type MeasurementUnit,
  type WorkspaceItemTransform,
  getMatDimensionsInches,
  loadMeasurementUnitPreference,
  normalizeWorkspaceItemTransform,
  rotatePoint,
  saveMeasurementUnitPreference,
} from "./workspace-utils";
import {
  computeSnugFrame,
  computePathBBoxInDOM,
  parseGroupedPathTransform,
  reframeUngroupedChild,
} from "./utils/workspace-geometry";
import {
  cloneWorkspaceSvgItems,
  createWorkspaceObjectItem,
  createWorkspaceShapeItem,
  createWorkspaceSvgItem,
  workspaceTransformsEqual,
} from "./utils/workspace-factory";
import { normalizeAiSvg } from "./utils/svg-normalize";
import { isEditableKeyboardTarget } from "./utils/dom-utils";
import { type WorkspaceShapeKind } from "./workspace-shapes";
import { createWorkspaceGroup, ungroupWorkspaceObject } from "./workspace-grouping";
import {
  type AiProgressStep,
  type AiProviderSettings,
  type AiSvgInput,
  generateAiSvg,
  hasActiveApiKey,
  loadAiSettings,
  saveAiSettings,
} from "./ai-svg-generate";
import type { CutSessionSnapshot, LibraryImage, SlicebugPlanResult } from "./app-types";
import { DesignWorkspace } from "./components/workspace/DesignWorkspace";
import { WelcomeScreen } from "./components/screens/WelcomeScreen";
import { SettingsModal } from "./components/modals/SettingsModal";
import { AiGenerateModal } from "./components/modals/AiGenerateModal";
import { CutPreviewModal } from "./components/modals/CutPreviewModal";

type SlicebugStatus = {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
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
    | "edit-flip-y"
    | "edit-bring-forward"
    | "edit-send-backward"
    | "edit-bring-to-front"
    | "edit-send-to-back";
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
  const [paperColor, setPaperColor] = useState<string>(DEFAULT_PAPER_COLOR);
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>(() => loadMeasurementUnitPreference());
  const [importedPlan, setImportedPlan] = useState<SlicebugPlanResult | null>(null);
  const [importedPlanLoading, setImportedPlanLoading] = useState(false);
  const [cutPreview, setCutPreview] = useState<{ plan: SlicebugPlanResult; svg: string; matPreset: string; paperColor: string } | null>(null);
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
    setTools(DEFAULT_TOOLS);
    setPaperColor(DEFAULT_PAPER_COLOR);
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
      paperColor,
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
    setPaperColor(projectFile.workspace.paperColor);
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
        textContent: item.textContent,
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

  // ── Layer order ───────────────────────────────────────────────────────────
  // The array order IS the z-order: index 0 = back/bottom, last = front/top.
  // The Layers pane shows it reversed (front on top), so reorder math is done in
  // that reversed "display" space and flipped back to the stored array.

  type LayerMove = "forward" | "backward" | "front" | "back";

  function moveLayer(id: string, mode: LayerMove): boolean {
    const display = [...importedSvgs].reverse();
    const idx = display.findIndex((item) => item.id === id);
    if (idx < 0) return false;
    const target = mode === "front" ? 0 : mode === "back" ? display.length - 1 : mode === "forward" ? idx - 1 : idx + 1;
    const clamped = Math.max(0, Math.min(display.length - 1, target));
    if (clamped === idx) return false;
    const [item] = display.splice(idx, 1);
    display.splice(clamped, 0, item!);
    pushWorkspaceHistorySnapshot();
    setImportedSvgs([...display].reverse());
    setImportedPlan(null);
    return true;
  }

  // Move the (single) selected layer; used by toolbar + right-click menu.
  function handleMoveSelectedLayer(mode: LayerMove): boolean {
    const id = selectedSvgId ?? (selectedSvgIds.length === 1 ? selectedSvgIds[0] : null);
    return id ? moveLayer(id, mode) : false;
  }

  // Drag-to-reorder in the Layers pane: drop `draggedId` onto `targetId`'s row.
  function handleReorderLayerToTarget(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const display = [...importedSvgs].reverse();
    const from = display.findIndex((item) => item.id === draggedId);
    const to = display.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = display.splice(from, 1);
    const targetIdx = display.findIndex((entry) => entry.id === targetId);
    display.splice(from < to ? targetIdx + 1 : targetIdx, 0, item!);
    pushWorkspaceHistorySnapshot();
    setImportedSvgs([...display].reverse());
    setImportedPlan(null);
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
    const item = recolorItem(
      createWorkspaceShapeItem({
        shapeKind,
        language,
        index: importedSvgs.length,
        timestamp: Date.now(),
      }),
      getBehindColor(tools),
    );
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
    // New artwork defaults to "Cut" — shown filled in the behind colour.
    const cutItem = recolorItem(item, getBehindColor(tools));
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current, cutItem]);
    setSelectedSvgId(item.id);
    setSelectedSvgIds([item.id]);
    setImportedPlan(null);
    setCutSession(null);
  }

  // ── Text ────────────────────────────────────────────────────────────────────

  function measureTextFrame(tc: WorkspaceTextContent): { width: number; height: number } {
    // Single-line text is centerline-traced from the *real* font, so it measures with
    // the normal font-metrics path below (no special-casing needed).
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
      // Single-line text: emit the Hershey stroke polylines directly as open paths
      // (no fill) — bypassing the canvas→Potrace outline trace entirely.
      if (item.textContent.singleLine) {
        const color = item.textContent.color;
        const d = traceCenterlinePathD(item.textContent, item.frame);
        if (!d) return item;
        const strokePath: WorkspacePathData = {
          id: `${item.id}-stroke`,
          d,
          fill: "none",
          stroke: color,
          strokeWidth: "1.5",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        };
        return { ...item, paths: [strokePath] as unknown as [WorkspacePathData] };
      }
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

  // Recolour every path of an item to a single colour (used to make new artwork
  // default to the "Cut" / behind colour).
  function recolorItem(item: WorkspaceSvgItem, color: string): WorkspaceSvgItem {
    return { ...item, paths: item.paths.map((p) => ({ ...p, stroke: color })) } as WorkspaceSvgItem;
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
      // New text defaults to Cut (the behind colour) so placed text is cut by default.
      color: getBehindColor(tools),
    };
    const item = createTextItem(defaultContent, importedSvgs.length);
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => [...current, item]);
    setSelectedSvgId(item.id);
    setSelectedSvgIds([item.id]);
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
        case "edit-paste":
          // execCommand("paste") is blocked by Chromium; read the clipboard and insert.
          void navigator.clipboard.readText()
            .then((text) => { if (text) document.execCommand("insertText", false, text); })
            .catch(() => {});
          break;
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
      case "edit-bring-forward":
        handleMoveSelectedLayer("forward");
        break;
      case "edit-send-backward":
        handleMoveSelectedLayer("backward");
        break;
      case "edit-bring-to-front":
        handleMoveSelectedLayer("front");
        break;
      case "edit-send-to-back":
        handleMoveSelectedLayer("back");
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
    // Clear any finished/stopped/errored session so reopening starts a fresh cut.
    setCutSession(null);
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
        paperColor,
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
      setCutPreview({ plan, svg, matPreset: selectedMatPreset, paperColor });
    } catch (error) {
      const plan: SlicebugPlanResult = { ok: false, executable: "", inputSvgPath: "", outputPlanPath: "", stdout: "", stderr: "", message: error instanceof Error ? error.message : "Plan failed", plan: null };
      setCutPreview({ plan, svg, matPreset: selectedMatPreset, paperColor });
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

  // Load the curated Google Fonts catalog once (card-making fonts, by category).
  useEffect(() => {
    const id = "kindcut-google-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = googleFontsHref();
    document.head.appendChild(link);
  }, []);

  // When a (web) font finishes loading, re-measure text frames and drop cached
  // centerline traces so glyphs that were laid out against a fallback font snap to the
  // real one.
  useEffect(() => {
    function handleFontsLoaded() {
      clearCenterlineCache();
      setImportedSvgs((current) =>
        current.map((item) => (item.textContent ? { ...item, frame: measureTextFrame(item.textContent) } : item)),
      );
    }
    document.fonts.addEventListener("loadingdone", handleFontsLoaded);
    return () => document.fonts.removeEventListener("loadingdone", handleFontsLoaded);
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
        canReorder: selCount === 1 && importedSvgs.length > 1,
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
      paperColor={paperColor}
      onPaperColorChange={setPaperColor}
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
      onMoveLayer={handleMoveSelectedLayer}
      onReorderLayerToTarget={handleReorderLayerToTarget}
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
        onClose={() => { setCutPreview(null); setCutSession(null); }}
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

