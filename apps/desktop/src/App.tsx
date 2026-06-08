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
import { DEBUG } from "./dev-flags";
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
  type CardSize,
  CARD_SIZES,
  buildInsertSlotsPaths,
  isCardSize,
  getMatDimensionsInches,
  loadMeasurementUnitPreference,
  normalizeWorkspaceItemTransform,
  rotatePoint,
  saveMeasurementUnitPreference,
  type WorkspaceItemFrame,
} from "./workspace-utils";
import {
  computeSnugFrame,
  computePathBBoxInDOM,
  parseGroupedPathTransform,
  isUngroupablePath,
  reframeUngroupedChild,
  splitCompoundPathByContainment,
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
import { type WorkspaceShapeKind, buildShapePath } from "./workspace-shapes";
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
import { UnsavedChangesModal } from "./components/modals/UnsavedChangesModal";

type SlicebugStatus = {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
};

type SlicebugSetupStatus = {
  bootstrapped: boolean;
  hasKeys: boolean;
  hasProfiles: boolean;
  hasDevicePlugin: boolean;
  hasUsvg: boolean;
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
    | "save-project-as"
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
    | "edit-send-to-back"
    | "close-window";
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

const MATERIAL_INSERT_ID = 535;

export function App() {
  const [screen, setScreen] = useState<AppScreen>("welcome");
  const [language, setLanguage] = useState<Language>(() => loadLanguagePreference());
  const [slicebugStatus, setSlicebugStatus] = useState<SlicebugStatus | null>(null);
  const [slicebugSetupStatus, setSlicebugSetupStatus] = useState<SlicebugSetupStatus | null>(null);
  const [slicebugLoading, setSlicebugLoading] = useState(false);
  const [slicebugBootstrapLoading, setSlicebugBootstrapLoading] = useState(false);
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
  // Bumped on each successful save; used as a key to replay the "Saved!" fly-in toast.
  const [savedToast, setSavedToast] = useState(0);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectOpening, setProjectOpening] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState(218);
  const [selectedMatPreset, setSelectedMatPreset] = useState("joy-standard");
  // Insert-card sub-options (only meaningful for the insert-card material).
  const [cardSize, setCardSize] = useState<CardSize | null>(null);
  const [insertSlots, setInsertSlots] = useState(false);
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

  const statusCopy = useMemo(() => {
    if (slicebugBootstrapLoading) {
      return {
        tone: "checking" as const,
        title: t("status.bootstrapLoadingTitle"),
        message: t("status.bootstrapLoadingMessage"),
        details: [],
      };
    }
    if (slicebugStatus?.ok && slicebugSetupStatus && !slicebugSetupStatus.bootstrapped) {
      return {
        tone: "warning" as const,
        title: t("status.bootstrapTitle"),
        message: t("status.bootstrapMessage"),
        details: [
          `SliceBug message: ${slicebugStatus.message}`,
          slicebugStatus.version ? `SliceBug version: ${slicebugStatus.version}` : null,
          slicebugStatus.executable ? `Executable: ${slicebugStatus.executable}` : null,
          `Keys: ${slicebugSetupStatus.hasKeys ? "yes" : "no"}`,
          `Profiles: ${slicebugSetupStatus.hasProfiles ? "yes" : "no"}`,
          `Device plugin: ${slicebugSetupStatus.hasDevicePlugin ? "yes" : "no"}`,
          `usvg: ${slicebugSetupStatus.hasUsvg ? "yes" : "no"}`,
        ].filter((detail): detail is string => Boolean(detail)),
      };
    }
    return getFriendlySlicebugStatusCopy(slicebugStatus, slicebugLoading, language);
  }, [language, slicebugBootstrapLoading, slicebugLoading, slicebugSetupStatus, slicebugStatus, t]);

  // --- Unsaved-changes tracking ---------------------------------------------
  // A signature of the persisted project content (objects + settings, ignoring which item is
  // selected). When it differs from the baseline taken at the last save/open/new, there are
  // unsaved changes. Used to guard reload / Home / open / new with a Save prompt.
  const currentSignature = useMemo(
    () =>
      JSON.stringify({
        m: selectedMaterialId,
        mat: selectedMatPreset,
        unit: measurementUnit,
        tools,
        paper: paperColor,
        card: cardSize,
        slots: insertSlots,
        objects: importedSvgs.map((o) => ({
          id: o.id,
          type: o.type,
          kind: o.kind,
          shapeKind: o.shapeKind,
          fileName: o.fileName,
          paths: o.paths,
          frame: o.frame,
          transform: o.transform,
          textContent: o.textContent,
          cornerRadius: o.cornerRadius,
        })),
      }),
    [importedSvgs, selectedMaterialId, selectedMatPreset, measurementUnit, tools, paperColor, cardSize, insertSlots],
  );
  const [savedSignature, setSavedSignature] = useState("");
  const [rebaseline, setRebaseline] = useState(0);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const signatureRef = useRef(currentSignature);
  signatureRef.current = currentSignature;
  // Re-baseline on mount and whenever a save/open/new declares "this is the clean state now".
  useEffect(() => {
    setSavedSignature(signatureRef.current);
  }, [rebaseline]);
  const hasUnsavedChanges = currentSignature !== savedSignature;

  // If there are unsaved changes, route the navigation through a Save / Don't save / Cancel
  // prompt; otherwise run it straight away.
  function guardNavigation(action: () => void) {
    if (hasUnsavedChanges) {
      setPendingNav(() => action);
    } else {
      action();
    }
  }

  // Ctrl/Cmd+R passes through the unsaved-changes guard. Native window close is
  // intercepted in Electron main and sent back as the "close-window" app action.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        guardNavigation(() => window.location.reload());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges]);

  function handleUnsavedSave() {
    void handleSaveProject().then((saved) => {
      const next = pendingNav;
      setPendingNav(null);
      if (saved) next?.();
    });
  }

  function handleUnsavedDiscard() {
    const next = pendingNav;
    setPendingNav(null);
    next?.();
  }

  function handleUnsavedCancel() {
    setPendingNav(null);
  }

  async function loadImageLibrary() {
    if (!window.cricutCompanion?.imageLibrary) {
      if (DEBUG) console.warn("[ImageLibrary] IPC bridge not available — shell may need rebuilding");
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
      if (DEBUG) console.warn("[ImageLibrary] IPC bridge not available — shell may need rebuilding");
      return;
    }
    try {
      const savedPath = await window.cricutCompanion.imageLibrary.save({ name, svg, isAi });
      if (DEBUG) console.log("[ImageLibrary] Saved:", savedPath);
    } catch (err) {
      if (DEBUG) console.error("[ImageLibrary] Failed to save:", err);
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
    guardNavigation(doNewProject);
  }

  function doNewProject() {
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
    setRebaseline((n) => n + 1); // fresh project = clean
    enterWorkspace();
  }

  function handleOpenProject() {
    guardNavigation(() => void doOpenProject());
  }

  async function doOpenProject() {
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
      setProjectMessage(DEBUG ? t("project.opened", { path: result.path }) : null);
      enterWorkspace();
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : t("project.openError"));
      enterWorkspace();
    } finally {
      setProjectOpening(false);
    }
  }

  async function handleSaveProject(options: { saveAs?: boolean } = {}): Promise<boolean> {
    if (!window.cricutCompanion?.project) {
      setProjectMessage(t("project.saveInDesktop"));
      enterWorkspace();
      return false;
    }

    const projectFile = createCurrentProjectFile();
    setProjectSaving(true);
    try {
      const result = await window.cricutCompanion.project.save({
        content: serializeProjectFile(projectFile),
        defaultFileName: `${getSafeProjectFileName(projectFile.name)}.kindcut`,
        // "Save as" always asks for a new location; a plain save reuses the known path.
        currentPath: options.saveAs ? null : currentProjectPath,
      });
      if (result.canceled) {
        return false;
      }
      setCurrentProjectPath(result.path);
      setProjectMessage(DEBUG ? t("project.saved", { path: result.path }) : null);
      setSavedToast((n) => n + 1); // cute fly-in confirmation
      setRebaseline((n) => n + 1); // saved = clean
      enterWorkspace();
      return true;
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : t("project.saveError"));
      enterWorkspace();
      return false;
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
      cardSize,
      insertSlots,
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
        cornerRadius: item.cornerRadius,
      })),
      selectedObjectId: selectedSvgId,
      selectedSvgId: null,
    });
  }

  function applyProjectFile(projectFile: KindCutProjectFile, projectPath: string) {
    setSelectedMaterialId(projectFile.workspace.selectedMaterialId);
    setSelectedMatPreset(projectFile.workspace.selectedMatPreset);
    setCardSize(isCardSize(projectFile.workspace.cardSize) ? projectFile.workspace.cardSize : null);
    setInsertSlots(Boolean(projectFile.workspace.insertSlots));
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
        cornerRadius: item.cornerRadius,
      });
      if (item.textContent) base.textContent = item.textContent;
      return base;
    });
    setImportedSvgs(restoredItems);
    const restoredSelectedId = projectFile.selectedObjectId ?? projectFile.selectedSvgId ?? restoredItems[0]?.id ?? null;
    setSelectedSvgId(restoredSelectedId);
    setSelectedSvgIds(restoredSelectedId ? [restoredSelectedId] : []);
    resetWorkspaceHistory();
    setRebaseline((n) => n + 1); // just-opened project = clean
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
    // Text renders live from its content (no paths), so it can't be flattened into a
    // path-based group without disappearing — don't group when text is selected.
    if (selectedObjects.some((item) => item.textContent)) {
      return false;
    }
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
    const sel = importedSvgs.find((item) => item.id === selectedSvgId);
    if (!sel) {
      return false;
    }
    const labelForIndex = (index: number) =>
      language === "nl" ? `${sel.fileName} onderdeel ${index + 1}` : `${sel.fileName} part ${index + 1}`;
    const idPrefix = `${sel.id}-part-${Date.now()}`;

    let children: WorkspaceSvgItem[] = [];
    if (sel.type === "group") {
      children = ungroupWorkspaceObject({ group: sel, idPrefix, labelForIndex }).map((child) =>
        reframeUngroupedChild(child, sel.transform),
      );
    } else if (sel.type === "path") {
      // Traced/AI compound path → one object per top-level shape (subpaths contained
      // inside another stay attached as holes, keeping their fill rule). A single shape
      // yields < 2 pieces and is left untouched below.
      children = splitCompoundPathByContainment({ item: sel, idPrefix, labelForIndex });
    }
    if (children.length < 2) {
      return false;
    }
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) => current.flatMap((item) => (item.id === sel.id ? children : [item])));
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

  // Render text into the item's frame coordinate space (scaled up for clean Potrace input),
  // using the SAME baseline (alphabetic, y = fontSize + i·lineH) and horizontal anchor as the
  // workspace <text> render in buildTextContentSvg. The returned canvas maps 1:1 (× SCALE) onto
  // the frame, so the traced paths land exactly where the on-screen text sits — no ink-bbox
  // renormalisation, which is what used to shift/stretch the cut text relative to the preview.
  function renderTextToCanvas(tc: WorkspaceTextContent, frame: WorkspaceItemFrame): { base64: string; width: number; height: number } {
    const SCALE = 3;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const fontStr = `${tc.fontStyle === "italic" ? "italic " : ""}${tc.fontWeight === "bold" ? "bold " : ""}${tc.fontSize * SCALE}px ${tc.fontFamily}`;
    canvas.width = Math.max(1, Math.ceil(frame.width * SCALE));
    canvas.height = Math.max(1, Math.ceil(frame.height * SCALE));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontStr;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "alphabetic";

    const lines = tc.text.split("\n");
    const lineH = tc.fontSize * SCALE * tc.lineHeight;
    const letterSpacing = tc.letterSpacing * SCALE;
    lines.forEach((line, i) => {
      const chars = [...line];
      const lineW = chars.length === 0
        ? 0
        : chars.reduce((w, c) => w + ctx.measureText(c).width, 0) + Math.max(0, chars.length - 1) * letterSpacing;
      // Mirror buildTextContentSvg anchors: center → width/2, right → width-1, left → 1.
      const xStart = tc.textAlign === "center"
        ? (frame.width * SCALE - lineW) / 2
        : tc.textAlign === "right"
          ? (frame.width - 1) * SCALE - lineW
          : 1 * SCALE;
      const baselineY = (tc.fontSize + i * lineH / SCALE) * SCALE; // = (fontSize + i·lineH)·SCALE
      let x = xStart;
      for (const char of chars) {
        ctx.fillText(char, x, baselineY);
        x += ctx.measureText(char).width + letterSpacing;
      }
      if (tc.textDecoration === "underline") {
        ctx.fillRect(xStart, baselineY + 2 * SCALE, lineW, Math.max(2, tc.fontSize * SCALE * 0.06));
      }
    });
    return {
      base64: canvas.toDataURL("image/png").replace("data:image/png;base64,", ""),
      width: canvas.width,
      height: canvas.height,
    };
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
        const rendered = renderTextToCanvas(item.textContent, item.frame);
        const rawSvg = await window.cricutCompanion?.ai?.tracePngToSvg(rendered.base64);
        if (!rawSvg) return item;
        const svg = normalizeAiSvg(rawSvg);
        const extracted = extractWorkspacePathsFromSvg(svg);
        // The canvas is the frame coordinate space × SCALE, so the traced paths already sit
        // where the on-screen text does — just scale the whole canvas back down to the frame
        // (NOT the ink bounding box, which would drop the baseline/line-height offset).
        const scaleX = item.frame.width / rendered.width;
        const scaleY = item.frame.height / rendered.height;
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

  function handleTextContentChange(ids: string | string[], patch: Partial<WorkspaceTextContent>) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    setImportedSvgs((current) =>
      current.map((item) => {
        if (!idSet.has(item.id) || !item.textContent) return item;
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

  function handleShapeCornerRadiusChange(ids: string | string[], radius: number) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    pushWorkspaceHistorySnapshot();
    setImportedSvgs((current) =>
      current.map((item) => {
        if (!idSet.has(item.id) || !item.shapeKind) return item;
        const clamped = Math.max(0, Math.min(radius, Math.min(item.frame.width, item.frame.height) / 2));
        // Keep the stored path in sync (scale-1 baseline); the render/cut regenerate
        // scale-aware on top of this.
        const d = buildShapePath(item.shapeKind, item.frame.width, item.frame.height, clamped);
        const paths = item.paths.map((p, i) => (i === 0 ? { ...p, d, pathTransform: undefined } : p));
        return { ...item, cornerRadius: clamped, paths } as WorkspaceSvgItem;
      }),
    );
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

  function handleChangeObjectColor(ids: string | string[], color: string) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    setImportedSvgs((current) =>
      current.map((item): WorkspaceObject => {
        if (!idSet.has(item.id)) return item;
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
    // Open the native workspace menu now (on right-click release). A frame later so any
    // selection change from the right-click has flushed before the menu reads edit state.
    requestAnimationFrame(() => { void window.cricutCompanion?.showWorkspaceContextMenu?.(); });
  }

  // Card-size + insert-slot options only apply to the insert-card material; clear them
  // when switching to another material.
  function handleMaterialChange(materialId: number) {
    setSelectedMaterialId(materialId);
    if (materialId !== MATERIAL_INSERT_ID) {
      setCardSize(null);
      setInsertSlots(false);
    }
  }

  function handleCardSizeChange(size: CardSize) {
    setCardSize((current) => (current === size ? null : size)); // clicking the active one turns it off
  }

  function handleExampleProject() {
    guardNavigation(() => void doExampleProject());
  }

  async function doExampleProject() {
    enterWorkspace();
    await generateSamplePlan();
    setRebaseline((n) => n + 1); // example loaded = clean starting point
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
      case "save-project-as":
        void handleSaveProject({ saveAs: true });
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
      case "close-window":
        guardNavigation(() => {
          void window.cricutCompanion?.appWindow?.closeConfirmed();
        });
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
      const [status, setup] = await Promise.all([
        window.cricutCompanion.slicebug.getStatus(),
        window.cricutCompanion.slicebug.getSetupStatus?.(),
      ]);
      setSlicebugStatus(status);
      setSlicebugSetupStatus(setup ?? null);
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

  async function runSlicebugBootstrap() {
    if (!window.cricutCompanion?.slicebug?.bootstrap) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message:
          language === "nl"
            ? "Open dit scherm in de Electron-desktopapp om SliceBug in te stellen."
            : "Open this screen in the Electron desktop shell to set up SliceBug.",
      });
      return;
    }

    setSlicebugBootstrapLoading(true);
    try {
      const result = await window.cricutCompanion.slicebug.bootstrap();
      if (!result.ok) {
        setSlicebugStatus({
          ok: false,
          executable: result.executable,
          version: null,
          message: result.message,
        });
      }
      await refreshSlicebugStatus();
    } catch (error) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message: error instanceof Error ? error.message : "SliceBug setup failed.",
      });
    } finally {
      setSlicebugBootstrapLoading(false);
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

  // The tools actually used by the design (matched to path/text colours), in the order
  // they run: pens draw first, the blade cuts last. Drives the visual cut steps.
  const usedCutTools = useMemo(() => {
    const used = new Set<string>();
    for (const item of importedSvgs) {
      if (item.textContent) used.add(item.textContent.color.toLowerCase());
      for (const path of item.paths) if (path.stroke) used.add(path.stroke.toLowerCase());
    }
    if (selectedMaterialId === MATERIAL_INSERT_ID && insertSlots) used.add(getBehindColor(tools).toLowerCase());
    const list = tools
      .filter((tool) => used.has(tool.color.toLowerCase()))
      .map((tool) => ({ tool: (tool.type === "pen" ? "pen" : "fine_point_blade") as "pen" | "fine_point_blade", color: tool.color }));
    return [...list.filter((t) => t.tool === "pen"), ...list.filter((t) => t.tool !== "pen")];
  }, [importedSvgs, tools, selectedMaterialId, insertSlots]);

  async function handleOpenCutPreview() {
    if (importedSvgs.length === 0) return;
    // Clear any finished/stopped/errored session so reopening starts a fresh cut.
    setCutSession(null);
    const matDims = getMatDimensionsInches(selectedMatPreset);
    const matW = matDims.width * WORKSPACE_PIXELS_PER_INCH;
    const matH = matDims.height * WORKSPACE_PIXELS_PER_INCH;
    // Convert any text items to traced paths so slicebug can cut them
    const resolvedItems = await resolveTextItemsForCutting(importedSvgs);
    // Insert-card corner slots (cut in the behind colour) sit at the active card area.
    const slotsSvg = selectedMaterialId === MATERIAL_INSERT_ID && insertSlots
      ? (() => {
          const dims = cardSize ? CARD_SIZES[cardSize] : matDims;
          return buildInsertSlotsPaths(dims.width * WORKSPACE_PIXELS_PER_INCH, dims.height * WORKSPACE_PIXELS_PER_INCH, getBehindColor(tools));
        })()
      : "";
    const svg = buildWorkspaceCutSvg(resolvedItems, matW, matH, tools, WORKSPACE_PIXELS_PER_INCH, slotsSvg);
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
        canGroup: selCount >= 2 && !selectedObjects.some((item) => item.textContent),
        canUngroup: selectedObjects.some((item) => item.type === "group" || isUngroupablePath(item)),
        canReorder: selCount === 1 && importedSvgs.length > 1,
      };
    });
  }, [importedSvgs, screen, selectedSvgIds]);

  useEffect(() => {
    return window.cricutCompanion?.projectState?.setProvider(() => ({
      hasOpenProject: screen !== "welcome",
      hasUnsavedChanges,
    }));
  }, [hasUnsavedChanges, screen]);

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
        slicebugBootstrapLoading={slicebugBootstrapLoading}
        showBootstrapSetup={Boolean(slicebugStatus?.ok && slicebugSetupStatus && !slicebugSetupStatus.bootstrapped)}
        onLanguageChange={handleLanguageChange}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProject}
        onExampleProject={() => void handleExampleProject()}
        onCheckSetup={() => void refreshSlicebugStatus()}
        onBootstrapSetup={() => void runSlicebugBootstrap()}
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
      cardSize={cardSize}
      insertSlots={insertSlots}
      onCardSizeChange={handleCardSizeChange}
      onInsertSlotsChange={setInsertSlots}
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
      onBackWelcome={() => guardNavigation(() => setScreen("welcome"))}
      onMaterialChange={handleMaterialChange}
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
      onShapeCornerRadiusChange={handleShapeCornerRadiusChange}
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
      onSaveProjectAs={() => void handleSaveProject({ saveAs: true })}
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
        materialId={selectedMaterialId}
        cutTools={usedCutTools}
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
    {pendingNav ? (
      <UnsavedChangesModal
        language={language}
        neverSaved={currentProjectPath === null}
        busy={projectSaving}
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
      />
    ) : null}
    {savedToast > 0 ? (
      <div className="save-toast" key={savedToast} role="status" aria-live="polite">
        <span className="save-toast__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </span>
        {t("project.savedToast")}
      </div>
    ) : null}
    </>
  );
}
