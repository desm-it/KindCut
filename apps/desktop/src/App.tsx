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
  type WorkspaceSvgItem,
  buildWorkspaceObjectsSvg,
  buildWorkspaceObjectSvg,
  buildWorkspaceCutSvg,
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
    | "edit-ungroup";
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
  const { t } = useMemo(() => createTranslator(language), [language]);
  const importedSvg = useMemo(
    () => importedSvgs.find((item) => item.id === selectedSvgId) ?? importedSvgs[0] ?? null,
    [importedSvgs, selectedSvgId],
  );

  const statusCopy = useMemo(
    () => getFriendlySlicebugStatusCopy(slicebugStatus, slicebugLoading, language),
    [language, slicebugLoading, slicebugStatus],
  );

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

    const restoredItems = projectFile.workspaceObjects.map((item, index) =>
      createWorkspaceObjectItem({
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
      }),
    );
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

  function handleUngroupSvg(): boolean {
    const group = importedSvgs.find((item) => item.id === selectedSvgId && item.type === "group");
    if (!group) {
      return false;
    }
    const children = ungroupWorkspaceObject({
      group,
      idPrefix: `${group.id}-part-${Date.now()}`,
      labelForIndex: (index) => language === "nl" ? `${group.fileName} onderdeel ${index + 1}` : `${group.fileName} part ${index + 1}`,
    });
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
    if ((payload.action === "edit-undo" || payload.action === "edit-redo") && isEditableKeyboardTarget(document.activeElement)) {
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
    const svg = buildWorkspaceCutSvg(importedSvgs, matW, matH);
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
      const newItems = await Promise.all(
        svgFiles.map(async (file, fileIndex) =>
          createWorkspaceSvgItem({
            id: `svg-${Date.now()}-${startIndex + fileIndex}`,
            fileName: file.name,
            fileSize: formatFileSize(file.size),
            svg: await file.text(),
            language,
            index: startIndex + fileIndex,
          }),
        ),
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
    />
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
const WORKSPACE_STAGE_LEFT_OFFSET = 42;
const WORKSPACE_STAGE_TOP_OFFSET = 74;
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
  if (extracted.paths.length === 1) {
    return { ...base, type: "path", paths: [extracted.paths[0]!] };
  }
  return {
    ...base,
    type: "group",
    paths: extracted.paths,
  };
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
  kind?: "image" | "shape";
  sourceKind?: "image" | "shape";
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
  onSelectSvg,
  onSelectSvgGroup,
  onSelectAllSvgs,
  onCopySvgs,
  onPasteSvgs,
  onCutSvgs,
  onDeleteSvgs,
  onGroupSvgs,
  onUngroupSvg,
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
}) {
  const { t } = createTranslator(language);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState<Point>({ x: 260, y: 90 });
  const [shapeDrawerOpen, setShapeDrawerOpen] = useState(false);
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
        />

        <div className="design-topbar__controls no-drag">
          <button className="cut-button" type="button" disabled={!canCut} onClick={onStartCut}>
            <span aria-hidden="true">▶</span>
            {cutBusy ? t("buttons.starting") : t("buttons.startCut")}
          </button>
        </div>
      </header>

      <section
        className={shapeDrawerOpen ? "design-frame design-frame--shape-drawer" : "design-frame"}
        aria-label={language === "nl" ? "Ontwerpwerkruimte" : "Design workspace"}
      >
        <aside className="tool-rail no-drag" aria-label={language === "nl" ? "Gereedschappen" : "Tools"}>
          <label className="tool-button tool-button--primary">
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="16" height="16" rx="2.5"/><path d="M3 14.5 7.5 10l3.5 3.5 2.5-2.5 5.5 5.5"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><path d="M8 3v1M14 3v1" strokeWidth="1.2"/><line x1="11" y1="3" x2="11" y2="4" strokeWidth="1.2"/></svg>
            {language === "nl" ? "Afbeelding" : "Image"}
            <input type="file" accept=".svg,image/svg+xml" multiple onChange={onSvgFileChange} />
          </label>
          <button className="tool-button" type="button" onClick={onGenerateSamplePlan} disabled={samplePlanLoading}>
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2v2M11 18v2M2 11h2M18 11h2M4.93 4.93l1.41 1.41M15.66 15.66l1.41 1.41M4.93 17.07l1.41-1.41M15.66 6.34l1.41-1.41"/><circle cx="11" cy="11" r="3.5"/></svg>
            {language === "nl" ? "Voorbeeld" : "Sample"}
          </button>
          <button className="tool-button" type="button" disabled>
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 5h10M11 5v12M8 17h6"/></svg>
            {language === "nl" ? "Tekst" : "Text"}
          </button>
          <button
            className={shapeDrawerOpen ? "tool-button tool-button--active" : "tool-button"}
            type="button"
            onClick={() => setShapeDrawerOpen((current) => !current)}
            aria-expanded={shapeDrawerOpen}
            aria-controls="shape-library-panel"
          >
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="11" width="9" height="9" rx="1.5"/><circle cx="15.5" cy="6.5" r="4.5"/></svg>
            {language === "nl" ? "Vorm" : "Shape"}
          </button>
        </aside>

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
                style={{ width: workpieceWidth, height: workpieceHeight }}
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
                      className={`workspace-image-item${selectedSvgIdSet.has(item.id) ? " workspace-image-item--selected" : ""}${item.id === selectedSvgId ? " workspace-image-item--primary-selected" : ""}`}
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
                      <WorkspaceObjectArtwork item={item} />
                    </div>
                  ))
                    )
                  : null}
                {moveableTargets.length > 0 && !isDirectItemDragging ? (
                  <Moveable
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

              // Object selected — show name + tool picker
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
      <div className="cut-modal">
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

function WorkspaceObjectArtwork({ item }: { item: WorkspaceObject }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="100%"
      viewBox={`0 0 ${item.frame.width} ${item.frame.height}`}
      preserveAspectRatio="none"
    >
      {item.paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          fill={path.fill}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          strokeLinecap={path.strokeLinecap as "butt" | "round" | "square" | "inherit" | undefined}
          strokeLinejoin={path.strokeLinejoin as "miter" | "round" | "bevel" | "inherit" | undefined}
          transform={path.pathTransform}
          vectorEffect="non-scaling-stroke"
        />
      ))}
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
}: {
  language: Language;
  canCopy: boolean;
  canCut: boolean;
  canPaste: boolean;
  canDelete: boolean;
  canGroup: boolean;
  canUngroup: boolean;
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
