import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent, PointerEvent, RefObject, WheelEvent } from "react";
import { buildBeginnerProject, joyStandardMat, validateProject } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "@cricut-companion/ai-designer";
import { MAT_PRESETS, MATERIAL_OPTIONS, buildPlanCommand } from "@cricut-companion/slicebug-bridge";
import { preflightSvg } from "@cricut-companion/svg-preflight";
import {
  APP_NAME,
  formatToolName,
  getFriendlyPlanResultCopy,
  getFriendlySlicebugStatusCopy,
} from "./onboarding-copy";
import {
  type KindCutProjectFile,
  buildProjectFile,
  parseProjectFile,
  serializeProjectFile,
} from "./project-file";
import { formatFileSize, getFriendlySvgMessages, getSvgSizeCopy, getSvgSizeInfo } from "./svg-import";
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
  addPoint,
  getMatDimensionsInches,
  getMeasurementTicks,
  getWorkspaceSelectionBounds,
  getViewportTransform,
  getWorkspaceItemTransform,
  normalizeWorkspaceItemTransform,
  rotatePoint,
  rotateWorkspaceItemTransformAroundPoint,
  scaleWorkspaceItemTransformFromAnchor,
} from "./workspace-utils";
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

type ImportedSvg = {
  fileName: string;
  fileSize: string;
  svg: string;
  sizeCopy: string;
  previewHtml: string;
  preflight: ReturnType<typeof preflightSvg>;
};

type WorkspaceSvgItem = ImportedSvg & {
  id: string;
  transform: WorkspaceItemTransform;
  frame: {
    width: number;
    height: number;
  };
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
    | "edit-select-all";
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
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>(() => loadMeasurementUnitPreference());
  const [importedPlan, setImportedPlan] = useState<SlicebugPlanResult | null>(null);
  const [importedPlanLoading, setImportedPlanLoading] = useState(false);
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

  function enterWorkspace() {
    setScreen("workspace");
  }

  function handleNewProject() {
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
      importedSvg: importedSvg
        ? {
            id: importedSvg.id,
            fileName: importedSvg.fileName,
            fileSize: importedSvg.fileSize,
            svg: importedSvg.svg,
            transform: importedSvg.transform,
          }
        : null,
      importedSvgs: importedSvgs.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        svg: item.svg,
        transform: item.transform,
      })),
      selectedSvgId,
    });
  }

  function applyProjectFile(projectFile: KindCutProjectFile, projectPath: string) {
    setSelectedMaterialId(projectFile.workspace.selectedMaterialId);
    setSelectedMatPreset(projectFile.workspace.selectedMatPreset);
    setMeasurementUnit(projectFile.workspace.measurementUnit);
    saveMeasurementUnitPreference(projectFile.workspace.measurementUnit);
    setCurrentProjectPath(projectPath);
    setImportedPlan(null);
    setSamplePlan(null);
    setCutSession(null);
    setImportMessage(null);

    const restoredItems = projectFile.importedSvgs.map((item, index) =>
      createWorkspaceSvgItem({
        id: item.id ?? `svg-${index + 1}`,
        fileName: item.fileName,
        fileSize: item.fileSize,
        svg: item.svg,
        language,
        index,
        transform: item.transform,
      }),
    );
    setImportedSvgs(restoredItems);
    const restoredSelectedId = projectFile.selectedSvgId ?? restoredItems[0]?.id ?? null;
    setSelectedSvgId(restoredSelectedId);
    setSelectedSvgIds(restoredSelectedId ? [restoredSelectedId] : []);
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
      createWorkspaceSvgItem({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        svg: item.svg,
        language,
        index: item.index,
        transform: item.transform,
      }),
    );
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
    setImportedSvgs((current) => current.filter((item) => !idsToDelete.has(item.id)));
    setSelectedSvgId(null);
    setSelectedSvgIds([]);
    setImportedPlan(null);
    setCutSession(null);
    return true;
  }

  function handleCutSvgs(): boolean {
    if (!handleCopySvgs()) {
      return false;
    }
    return handleDeleteSvgs();
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
          svg: importedSvg.svg,
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

  function handleSvgTransformChange(id: string, transform: WorkspaceItemTransform) {
    setImportedSvgs((current) => current.map((item) => (item.id === id ? { ...item, transform } : item)));
  }

  useEffect(() => {
    void refreshSlicebugStatus();
  }, []);

  useEffect(() => window.cricutCompanion?.onAppAction?.(handleDesktopAction));

  useEffect(() => {
    return window.cricutCompanion?.workspaceEditState?.setProvider(() => ({
      isWorkspaceContextTarget: screen === "workspace" && Date.now() - lastWorkspaceContextMenuAt.current < 500,
      selectedObjectCount: lastWorkspaceContextSelectionCount.current ?? selectedSvgIds.length,
      objectCount: importedSvgs.length,
      hasInternalClipboard: workspaceClipboard.current.length > 0,
    }));
  }, [importedSvgs.length, screen, selectedSvgIds.length]);

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
      onSvgFileChange={(event) => void handleSvgFileChange(event)}
      onSelectSvg={selectSingleSvg}
      onSelectSvgGroup={selectSvgGroup}
      onSelectAllSvgs={handleSelectAllSvgs}
      onCopySvgs={handleCopySvgs}
      onPasteSvgs={handlePasteSvgs}
      onCutSvgs={handleCutSvgs}
      onDeleteSvgs={handleDeleteSvgs}
      onWorkspaceContextMenu={markWorkspaceContextMenuTarget}
      onSvgTransformChange={handleSvgTransformChange}
      onPrepareImportedPlan={() => void prepareImportedPlan()}
      onOpenProject={() => void handleOpenProject()}
      onSaveProject={() => void handleSaveProject()}
      onGenerateSamplePlan={() => void generateSamplePlan()}
      onStartCut={() => {
        if (importedPlan?.outputPlanPath) {
          void startCutSession(importedPlan.outputPlanPath);
        }
      }}
      onContinueCut={() => void continueCutSession()}
      onStopCut={() => void stopCutSession()}
    />
  );
}


const MEASUREMENT_UNIT_STORAGE_KEY = "kindcutMeasurementUnit";
const WORKSPACE_PIXELS_PER_INCH = 80;
const WORKSPACE_MIN_ZOOM = 0.45;
const WORKSPACE_MAX_ZOOM = 3;
const DEFAULT_SVG_FRAME_SIZE = 180;
const MIN_IMAGE_SIZE = 18;
const WORKSPACE_STAGE_LEFT_OFFSET = 42;
const WORKSPACE_STAGE_TOP_OFFSET = 74;
const ROTATION_SNAP_INTERVAL_DEGREES = 45;
const ROTATION_SNAP_THRESHOLD_DEGREES = 4;

type TransformControlCssVars = Record<`--${string}`, string>;

function buildTransformControlCssVars(zoom: number, transform: WorkspaceItemTransform): TransformControlCssVars {
  const effectiveScaleX = Math.max(0.01, zoom * transform.scaleX);
  const effectiveScaleY = Math.max(0.01, zoom * transform.scaleY);
  const averageScale = Math.max(0.01, (effectiveScaleX + effectiveScaleY) / 2);
  return {
    "--transform-box-outset-x": `${7 / effectiveScaleX}px`,
    "--transform-box-outset-y": `${7 / effectiveScaleY}px`,
    "--transform-border-width": `${1 / averageScale}px`,
    "--transform-handle-width": `${11 / effectiveScaleX}px`,
    "--transform-handle-height": `${11 / effectiveScaleY}px`,
    "--transform-handle-border-width": `${2 / averageScale}px`,
    "--transform-rotate-width": `${19 / effectiveScaleX}px`,
    "--transform-rotate-height": `${19 / effectiveScaleY}px`,
    "--transform-rotate-top": `${-31 / effectiveScaleY}px`,
    "--transform-rotate-right": `${-7 / effectiveScaleX}px`,
    "--transform-rotate-font-size": `${12 / averageScale}px`,
  };
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function createWorkspaceSvgItem({
  id,
  fileName,
  fileSize,
  svg,
  language,
  index,
  transform,
}: {
  id: string;
  fileName: string;
  fileSize: string;
  svg: string;
  language: Language;
  index: number;
  transform?: WorkspaceItemTransform;
}): WorkspaceSvgItem {
  const sizeInfo = getSvgSizeInfo(svg);
  const frame = getSvgFrame(sizeInfo);
  return {
    id,
    fileName,
    fileSize,
    svg,
    sizeCopy: getSvgSizeCopy(sizeInfo, language),
    previewHtml: getSandboxedSvgPreview(svg),
    preflight: preflightSvg(svg),
    frame,
    transform: transform ?? { x: 32 + index * 24, y: 32 + index * 24, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

function getSvgFrame(sizeInfo: ReturnType<typeof getSvgSizeInfo>): { width: number; height: number } {
  if (!sizeInfo) {
    return { width: DEFAULT_SVG_FRAME_SIZE, height: DEFAULT_SVG_FRAME_SIZE };
  }
  if (sizeInfo.unit === "in") {
    return {
      width: Math.max(40, sizeInfo.width * WORKSPACE_PIXELS_PER_INCH),
      height: Math.max(40, sizeInfo.height * WORKSPACE_PIXELS_PER_INCH),
    };
  }
  const aspectRatio = sizeInfo.width / sizeInfo.height;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { width: DEFAULT_SVG_FRAME_SIZE, height: DEFAULT_SVG_FRAME_SIZE };
  }
  return aspectRatio >= 1
    ? { width: DEFAULT_SVG_FRAME_SIZE, height: DEFAULT_SVG_FRAME_SIZE / aspectRatio }
    : { width: DEFAULT_SVG_FRAME_SIZE * aspectRatio, height: DEFAULT_SVG_FRAME_SIZE };
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
  onBackWelcome,
  onMaterialChange,
  onMatChange,
  onSvgFileChange,
  onSelectSvg,
  onSelectSvgGroup,
  onSelectAllSvgs,
  onCopySvgs,
  onPasteSvgs,
  onCutSvgs,
  onDeleteSvgs,
  onWorkspaceContextMenu,
  onSvgTransformChange,
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
  importedSvg: ImportedSvg | null;
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
  onBackWelcome: () => void;
  onMaterialChange: (materialId: number) => void;
  onMatChange: (matPreset: string) => void;
  onSvgFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectSvg: (id: string | null) => void;
  onSelectSvgGroup: (ids: string[]) => void;
  onSelectAllSvgs: () => void;
  onCopySvgs: () => boolean;
  onPasteSvgs: () => boolean;
  onCutSvgs: () => boolean;
  onDeleteSvgs: () => boolean;
  onWorkspaceContextMenu: (selectedObjectCount?: number) => void;
  onSvgTransformChange: (id: string, transform: WorkspaceItemTransform) => void;
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const workpieceTransformRef = useRef<HTMLDivElement | null>(null);
  const selectionTransformBoxRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<null | { pointerId: number; pointer: Point; pan: Point }>(null);
  const itemTransformStart = useRef<null | {
    pointerId: number;
    id: string;
    mode: ImageTransformMode;
    handle?: ResizeHandle;
    pointer: Point;
    transform: WorkspaceItemTransform;
    latestTransform: WorkspaceItemTransform;
    frame: { width: number; height: number };
    element: HTMLDivElement;
    selectionElement?: HTMLDivElement | null;
    groupItems?: Array<{ id: string; transform: WorkspaceItemTransform; frame: { width: number; height: number } }>;
    latestGroupTransforms?: Map<string, WorkspaceItemTransform>;
    groupBounds?: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>;
    rotationStart?: { center: Point; angle: number };
  }>(null);
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
  const canCut = Boolean(importedPlan?.ok && importedPlan.plan) && !cutBusy;
  const selectedSvgIdSet = useMemo(() => new Set(selectedSvgIds), [selectedSvgIds]);
  const selectedItems = useMemo(() => importedSvgs.filter((item) => selectedSvgIdSet.has(item.id)), [importedSvgs, selectedSvgIdSet]);
  const selectionBounds = selectedItems.length > 1 ? getWorkspaceSelectionBounds(selectedItems) : null;

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
      const nextZoom = clampZoom(zoom - event.deltaY * 0.0018);
      setZoom(nextZoom);
      return;
    }
    setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (selectedSvgId && !(event.target as HTMLElement).closest(".workspace-image-item")) {
      onSelectSvg(null);
    }
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

  function workspacePointFromEvent(event: PointerEvent<HTMLElement>): Point {
    const rect = workpieceTransformRef.current?.getBoundingClientRect();
    return rect
      ? { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }
      : { x: event.clientX / zoom, y: event.clientY / zoom };
  }

  function handleItemPointerDown(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    if (event.button !== 0) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const isExistingMultiSelectionDrag = selectedSvgIdSet.has(item.id) && selectedItems.length > 1;
    if (!selectedSvgIdSet.has(item.id)) {
      onSelectSvg(item.id);
    }
    const groupItems = isExistingMultiSelectionDrag
      ? selectedItems.map((selected) => ({ id: selected.id, transform: selected.transform, frame: selected.frame }))
      : undefined;
    itemTransformStart.current = {
      pointerId: event.pointerId,
      id: item.id,
      mode: "move",
      pointer: workspacePointFromEvent(event),
      transform: item.transform,
      latestTransform: item.transform,
      frame: item.frame,
      element: event.currentTarget,
      selectionElement: groupItems ? selectionTransformBoxRef.current : null,
      groupItems,
      latestGroupTransforms: groupItems ? new Map(groupItems.map((selected) => [selected.id, selected.transform])) : undefined,
      groupBounds: groupItems ? getWorkspaceSelectionBounds(groupItems) ?? undefined : undefined,
    };
  }

  function handleItemPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = itemTransformStart.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    updateActiveTransformSession(drag, workspacePointFromEvent(event), event.altKey);
  }

  function stopItemDragging(event: PointerEvent<HTMLDivElement>) {
    const drag = itemTransformStart.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      if (drag.latestGroupTransforms) {
        for (const [id, transform] of drag.latestGroupTransforms) {
          onSvgTransformChange(id, transform);
        }
      } else {
        onSvgTransformChange(drag.id, drag.latestTransform);
      }
      itemTransformStart.current = null;
    }
  }

  function handleTransformHandlePointerDown(
    event: PointerEvent<HTMLSpanElement>,
    item: WorkspaceSvgItem,
    mode: ImageTransformMode,
    handle?: ResizeHandle,
  ) {
    if (event.button !== 0) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const imageElement = event.currentTarget.closest<HTMLDivElement>(".workspace-image-item");
    if (!imageElement) {
      return;
    }
    imageElement.setPointerCapture(event.pointerId);
    if (selectedSvgId !== item.id) {
      onSelectSvg(item.id);
    }
    const pointer = workspacePointFromEvent(event);
    const startWidth = item.frame.width * item.transform.scaleX;
    const startHeight = item.frame.height * item.transform.scaleY;
    const center = addPoint(
      { x: item.transform.x, y: item.transform.y },
      rotatePoint({ x: startWidth / 2, y: startHeight / 2 }, item.transform.rotation),
    );
    itemTransformStart.current = {
      pointerId: event.pointerId,
      id: item.id,
      mode,
      handle,
      pointer,
      transform: item.transform,
      latestTransform: item.transform,
      frame: item.frame,
      element: imageElement,
      rotationStart:
        mode === "rotate"
          ? {
              center,
              angle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
            }
          : undefined,
    };
  }

  function handleSelectionHandlePointerDown(
    event: PointerEvent<HTMLSpanElement>,
    mode: ImageTransformMode,
    handle?: ResizeHandle,
  ) {
    if (event.button !== 0 || !selectionBounds || selectedItems.length < 2) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selectionElement = event.currentTarget.closest<HTMLDivElement>(".multi-transform-box");
    if (!selectionElement) {
      return;
    }
    selectionElement.setPointerCapture(event.pointerId);
    const pointer = workspacePointFromEvent(event);
    const groupItems = selectedItems.map((item) => ({ id: item.id, transform: item.transform, frame: item.frame }));
    itemTransformStart.current = {
      pointerId: event.pointerId,
      id: selectedSvgId ?? groupItems[0]?.id ?? "selection",
      mode,
      handle,
      pointer,
      transform: { x: selectionBounds.left, y: selectionBounds.top, scaleX: 1, scaleY: 1, rotation: 0 },
      latestTransform: { x: selectionBounds.left, y: selectionBounds.top, scaleX: 1, scaleY: 1, rotation: 0 },
      frame: { width: selectionBounds.width, height: selectionBounds.height },
      element: selectionElement,
      selectionElement,
      groupItems,
      latestGroupTransforms: new Map(groupItems.map((item) => [item.id, item.transform])),
      groupBounds: selectionBounds,
      rotationStart:
        mode === "rotate"
          ? {
              center: selectionBounds.center,
              angle: Math.atan2(pointer.y - selectionBounds.center.y, pointer.x - selectionBounds.center.x),
            }
          : undefined,
    };
  }

  function getTransformControlStyle(item: WorkspaceSvgItem): CSSProperties {
    return buildTransformControlCssVars(zoom, item.transform) as CSSProperties;
  }

  function applyTransformControlStyle(element: HTMLElement, transform: WorkspaceItemTransform) {
    const vars = buildTransformControlCssVars(zoom, transform);
    for (const [name, value] of Object.entries(vars)) {
      element.style.setProperty(name, value);
    }
  }

  function updateActiveTransformSession(
    drag: NonNullable<typeof itemTransformStart.current>,
    pointer: Point,
    preciseRotation: boolean,
  ) {
    if (drag.groupItems && drag.latestGroupTransforms && drag.groupBounds) {
      const groupSession = { ...drag, groupItems: drag.groupItems, groupBounds: drag.groupBounds };
      const nextTransforms = getNextGroupTransforms(groupSession, pointer, { preciseRotation });
      drag.latestGroupTransforms = nextTransforms;
      for (const [id, transform] of nextTransforms) {
        const element = workpieceTransformRef.current?.querySelector<HTMLElement>(`[data-workspace-item-id="${cssEscape(id)}"]`);
        if (element) {
          element.style.transform = getWorkspaceItemTransform(transform);
        }
      }
      const nextBounds = getWorkspaceSelectionBounds(
        drag.groupItems.map((item) => ({ ...item, transform: nextTransforms.get(item.id) ?? item.transform })),
      );
      if (nextBounds && drag.selectionElement) {
        applySelectionBoxStyle(drag.selectionElement, nextBounds);
      }
      return;
    }

    const latestTransform = getNextImageTransform(drag, pointer, { preciseRotation });
    drag.latestTransform = latestTransform;
    drag.element.style.transform = getWorkspaceItemTransform(latestTransform);
    applyTransformControlStyle(drag.element, latestTransform);
  }

  function applySelectionBoxStyle(element: HTMLElement, bounds: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>) {
    element.style.left = `${bounds.left}px`;
    element.style.top = `${bounds.top}px`;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
  }

  function handleItemContextMenu(event: MouseEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    event.stopPropagation();
    if (!selectedSvgIdSet.has(item.id)) {
      onSelectSvg(item.id);
    }
    onWorkspaceContextMenu(selectedSvgIdSet.has(item.id) ? selectedSvgIds.length : 1);
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const usesModifier = event.metaKey || event.ctrlKey;
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
  }, [onCopySvgs, onCutSvgs, onDeleteSvgs, onPasteSvgs, onSelectAllSvgs]);

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
            <span aria-hidden="true">⌂</span>
          </button>
          <div>
            <p className="eyebrow">{language === "nl" ? "Werkruimte" : "Workspace"}</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <div className="design-topbar__controls no-drag">
          <div className="project-action-group" aria-label={language === "nl" ? "Projectbestanden" : "Project files"}>
            <button className="small-secondary-button" type="button" onClick={onOpenProject} disabled={projectOpening || projectSaving}>
              {projectOpening ? (language === "nl" ? "Openen..." : "Opening...") : language === "nl" ? "Open" : "Open"}
            </button>
            <button className="small-secondary-button" type="button" onClick={onSaveProject} disabled={projectOpening || projectSaving}>
              {projectSaving ? (language === "nl" ? "Bewaren..." : "Saving...") : language === "nl" ? "Bewaar" : "Save"}
            </button>
          </div>
          <MaterialMatChooser
            language={language}
            selectedMaterialId={selectedMaterialId}
            selectedMatPreset={selectedMatPreset}
            onMaterialChange={onMaterialChange}
            onMatChange={onMatChange}
          />
          <button className="cut-button" type="button" disabled={!canCut} onClick={onStartCut}>
            <span aria-hidden="true">▶</span>
            {cutBusy ? t("buttons.starting") : t("buttons.startCut")}
          </button>
        </div>
      </header>

      <section className="design-frame" aria-label={language === "nl" ? "Ontwerpwerkruimte" : "Design workspace"}>
        <aside className="tool-rail no-drag" aria-label={language === "nl" ? "Gereedschappen" : "Tools"}>
          <label className="tool-button tool-button--primary">
            <span>＋</span>
            {language === "nl" ? "Afbeelding" : "Image"}
            <input type="file" accept=".svg,image/svg+xml" multiple onChange={onSvgFileChange} />
          </label>
          <button className="tool-button" type="button" onClick={onGenerateSamplePlan} disabled={samplePlanLoading}>
            <span>✦</span>
            {language === "nl" ? "Voorbeeld" : "Sample"}
          </button>
          <button className="tool-button" type="button" disabled>
            <span>T</span>
            {language === "nl" ? "Tekst" : "Text"}
          </button>
          <button className="tool-button" type="button" disabled>
            <span>□</span>
            {language === "nl" ? "Vorm" : "Shape"}
          </button>
        </aside>

        <section className="workspace-stage no-drag">
          <div className="stage-statusbar">
            <strong>{matName}</strong>
            <span>{materialName}</span>
            <span>{matDimensions.width} × {matDimensions.height} in</span>
            <span>{Math.round(zoom * 100)}%</span>
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
            onContextMenu={() => onWorkspaceContextMenu()}
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
                <span className="origin-marker">0,0</span>
                {importedSvgs.length === 0 ? (
                  <div className="empty-workpiece">
                    <strong>{language === "nl" ? "Leeg project" : "Blank project"}</strong>
                    <span>{language === "nl" ? "Importeer een afbeelding of plaats straks tekst/vormen op deze mat." : "Import an image or place text/shapes on this mat later."}</span>
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
                        width: item.frame.width,
                        height: item.frame.height,
                        transform: getWorkspaceItemTransform(item.transform),
                        ...getTransformControlStyle(item),
                      }}
                      aria-label={
                        language === "nl"
                          ? `${item.fileName} selecteren en verplaatsen`
                          : `Select and move ${item.fileName}`
                      }
                      onPointerDown={(event) => handleItemPointerDown(event, item)}
                      onContextMenu={(event) => handleItemContextMenu(event, item)}
                      onPointerMove={handleItemPointerMove}
                      onPointerUp={stopItemDragging}
                      onPointerCancel={stopItemDragging}
                    >
                      <img alt="" draggable={false} src={getSvgDataUrl(item.svg)} />
                      {item.id === selectedSvgId && selectedItems.length === 1 ? (
                        <ImageTransformControls item={item} language={language} onHandlePointerDown={handleTransformHandlePointerDown} />
                      ) : null}
                    </div>
                  ))
                    )
                  : null}
                {selectionBounds ? (
                  <MultiSelectionTransformControls
                    bounds={selectionBounds}
                    language={language}
                    zoom={zoom}
                    selectionBoxRef={selectionTransformBoxRef}
                    onHandlePointerDown={handleSelectionHandlePointerDown}
                    onPointerMove={handleItemPointerMove}
                    onPointerUp={stopItemDragging}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div className="zoom-controls no-drag" aria-label={language === "nl" ? "Zoom" : "Zoom"}>
            <button type="button" onClick={() => setZoom((current) => clampZoom(current - 0.1))}>−</button>
            <button type="button" onClick={resetZoomToActualSize}>100%</button>
            <button type="button" onClick={() => setZoom((current) => clampZoom(current + 0.1))}>＋</button>
          </div>
        </section>

        <aside className="project-drawer no-drag">
          <p className="panel-label">{language === "nl" ? "Project" : "Project"}</p>
          <h2>{importedSvg ? importedSvg.fileName : language === "nl" ? "Nieuw leeg ontwerp" : "New blank design"}</h2>
          {currentProjectPath ? <p className="project-path">{currentProjectPath}</p> : null}
          {projectMessage ? <p className="ok project-message">{projectMessage}</p> : null}
          {importMessage ? <p className="warn">{importMessage}</p> : null}
          <p className={validationOk ? "ok" : "warn"}>
            {validationOk
              ? language === "nl" ? "Werkruimte klaar. De linialen starten linksboven op de mat." : "Workspace ready. Rulers start at the mat’s top-left."
              : t("projectCheck.warningMessage")}
          </p>
          {importedSvgs.length > 0 ? (
            <>
              <div className="workspace-item-list" aria-label={language === "nl" ? "Afbeeldingen in dit project" : "Images in this project"}>
                {importedSvgs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selectedSvgIdSet.has(item.id) ? "workspace-item-list__item workspace-item-list__item--selected" : "workspace-item-list__item"}
                    onClick={() => onSelectSvg(item.id)}
                  >
                    <span>{item.fileName}</span>
                    <small>{Math.round(item.transform.scaleX * 100)}% × {Math.round(item.transform.scaleY * 100)}%</small>
                  </button>
                ))}
              </div>
              {importedSvg ? <ImportedSvgPreview importedSvg={importedSvg} language={language} /> : null}
            </>
          ) : (
            <EmptyImportState language={language} />
          )}
          <div className="prepare-row">
            <button type="button" onClick={onPrepareImportedPlan} disabled={!canPrepare}>
              {importedPlanLoading ? t("buttons.preparing") : t("buttons.prepareHandoff")}
            </button>
          </div>
          {importedPlan ? (
            <PlanAndCutMonitor
              result={importedPlan}
              planLabel={importedSvg?.fileName ?? (language === "nl" ? "Geimporteerd ontwerp" : "Imported design")}
              language={language}
              cutSession={cutSession}
              cutBusy={cutBusy}
              onStart={onStartCut}
              onContinue={onContinueCut}
              onStop={onStopCut}
            />
          ) : null}
          {samplePlan ? <SamplePlanResult result={samplePlan} language={language} /> : null}
          <details>
            <summary>{t("details.handoffCommand")}</summary>
            <pre>
              {planCommand.command} {planCommand.args.join(" ")}
            </pre>
          </details>
        </aside>
      </section>
    </main>
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

type ImageTransformMode = "move" | "resize" | "rotate";
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type ImageTransformSession = {
  mode: ImageTransformMode;
  handle?: ResizeHandle;
  pointer: Point;
  transform: WorkspaceItemTransform;
  frame: { width: number; height: number };
  rotationStart?: { center: Point; angle: number };
};

function ImageTransformControls({
  item,
  language,
  onHandlePointerDown,
}: {
  item: WorkspaceSvgItem;
  language: Language;
  onHandlePointerDown: (
    event: PointerEvent<HTMLSpanElement>,
    item: WorkspaceSvgItem,
    mode: ImageTransformMode,
    handle?: ResizeHandle,
  ) => void;
}) {
  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const rotateTitle =
    language === "nl"
      ? "Draaien — klikt automatisch vast op 45° en 90°. Houd Option/Alt ingedrukt voor precies draaien."
      : "Rotate — snaps to 45° and 90° angles. Hold Option/Alt for precise rotation.";

  return (
    <span className="image-transform-box" aria-hidden="true">
      {handles.map((handle) => (
        <span
          key={handle}
          className={`image-transform-handle image-transform-handle--${handle}`}
          onPointerDown={(event) => onHandlePointerDown(event, item, "resize", handle)}
        />
      ))}
      <span
        className="image-transform-rotate"
        title={rotateTitle}
        onPointerDown={(event) => onHandlePointerDown(event, item, "rotate")}
      >
        ↻
      </span>
    </span>
  );
}

function MultiSelectionTransformControls({
  bounds,
  language,
  zoom,
  selectionBoxRef,
  onHandlePointerDown,
  onPointerMove,
  onPointerUp,
}: {
  bounds: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>;
  language: Language;
  zoom: number;
  selectionBoxRef: RefObject<HTMLDivElement | null>;
  onHandlePointerDown: (event: PointerEvent<HTMLSpanElement>, mode: ImageTransformMode, handle?: ResizeHandle) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const rotateTitle =
    language === "nl"
      ? "Selectie draaien - klikt automatisch vast op 45° en 90°. Houd Option/Alt ingedrukt voor precies draaien."
      : "Rotate selection - snaps to 45° and 90° angles. Hold Option/Alt for precise rotation.";
  const controlScale = Math.max(0.01, zoom);
  const style = {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    "--transform-box-outset-x": `${7 / controlScale}px`,
    "--transform-box-outset-y": `${7 / controlScale}px`,
    "--transform-border-width": `${1 / controlScale}px`,
    "--transform-handle-width": `${11 / controlScale}px`,
    "--transform-handle-height": `${11 / controlScale}px`,
    "--transform-handle-border-width": `${2 / controlScale}px`,
    "--transform-rotate-width": `${19 / controlScale}px`,
    "--transform-rotate-height": `${19 / controlScale}px`,
    "--transform-rotate-top": `${-31 / controlScale}px`,
    "--transform-rotate-right": `${-7 / controlScale}px`,
    "--transform-rotate-font-size": `${12 / controlScale}px`,
  } as CSSProperties;

  return (
    <div
      ref={selectionBoxRef}
      className="multi-transform-box"
      style={style}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {handles.map((handle) => (
        <span
          key={handle}
          className={`image-transform-handle image-transform-handle--${handle}`}
          onPointerDown={(event) => onHandlePointerDown(event, "resize", handle)}
        />
      ))}
      <span
        className="image-transform-rotate"
        title={rotateTitle}
        onPointerDown={(event) => onHandlePointerDown(event, "rotate")}
      >
        ↻
      </span>
    </div>
  );
}

function getNextImageTransform(
  session: ImageTransformSession,
  pointer: Point,
  options: { preciseRotation?: boolean } = {},
): WorkspaceItemTransform {
  if (session.mode === "move") {
    return normalizeWorkspaceItemTransform({
      ...session.transform,
      x: session.transform.x + pointer.x - session.pointer.x,
      y: session.transform.y + pointer.y - session.pointer.y,
    });
  }

  if (session.mode === "rotate" && session.rotationStart) {
    const startWidth = session.frame.width * session.transform.scaleX;
    const startHeight = session.frame.height * session.transform.scaleY;
    const rawRotation =
      session.transform.rotation +
      ((Math.atan2(pointer.y - session.rotationStart.center.y, pointer.x - session.rotationStart.center.x) -
        session.rotationStart.angle) *
        180) /
        Math.PI;
    const nextRotation = options.preciseRotation ? rawRotation : snapRotation(rawRotation);
    const rotatedCenterOffset = rotatePoint({ x: startWidth / 2, y: startHeight / 2 }, nextRotation);
    return normalizeWorkspaceItemTransform({
      ...session.transform,
      x: session.rotationStart.center.x - rotatedCenterOffset.x,
      y: session.rotationStart.center.y - rotatedCenterOffset.y,
      rotation: nextRotation,
    });
  }

  if (session.mode === "resize" && session.handle) {
    return getResizedImageTransform(session, pointer, session.handle);
  }

  return session.transform;
}

function getNextGroupTransforms(
  session: ImageTransformSession & {
    groupItems: Array<{ id: string; transform: WorkspaceItemTransform; frame: { width: number; height: number } }>;
    groupBounds: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>;
  },
  pointer: Point,
  options: { preciseRotation?: boolean } = {},
): Map<string, WorkspaceItemTransform> {
  if (session.mode === "move") {
    const deltaX = pointer.x - session.pointer.x;
    const deltaY = pointer.y - session.pointer.y;
    return new Map(
      session.groupItems.map((item) => [
        item.id,
        normalizeWorkspaceItemTransform({
          ...item.transform,
          x: item.transform.x + deltaX,
          y: item.transform.y + deltaY,
        }),
      ]),
    );
  }

  if (session.mode === "rotate" && session.rotationStart) {
    const rotationStart = session.rotationStart;
    const rawDelta =
      ((Math.atan2(pointer.y - rotationStart.center.y, pointer.x - rotationStart.center.x) -
        rotationStart.angle) *
        180) /
      Math.PI;
    const targetRotation = options.preciseRotation ? rawDelta : snapRotation(rawDelta);
    return new Map(
      session.groupItems.map((item) => [
        item.id,
        rotateWorkspaceItemTransformAroundPoint(item.transform, item.frame, rotationStart.center, targetRotation),
      ]),
    );
  }

  if (session.mode === "resize" && session.handle) {
    const scale = getGroupResizeScale(session.groupBounds, pointer, session.handle);
    return new Map(
      session.groupItems.map((item) => [
        item.id,
        scaleWorkspaceItemTransformFromAnchor(item.transform, item.frame, scale.anchor, scale.scaleX, scale.scaleY),
      ]),
    );
  }

  return new Map(session.groupItems.map((item) => [item.id, item.transform]));
}

function getGroupResizeScale(
  bounds: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>,
  pointer: Point,
  handle: ResizeHandle,
): { anchor: Point; scaleX: number; scaleY: number } {
  const handleX = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const handleY = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const anchor = {
    x: handleX === -1 ? bounds.right : handleX === 1 ? bounds.left : bounds.center.x,
    y: handleY === -1 ? bounds.bottom : handleY === 1 ? bounds.top : bounds.center.y,
  };
  const minScaleX = MIN_IMAGE_SIZE / Math.max(MIN_IMAGE_SIZE, bounds.width);
  const minScaleY = MIN_IMAGE_SIZE / Math.max(MIN_IMAGE_SIZE, bounds.height);
  let scaleX = 1;
  let scaleY = 1;

  if (handleX !== 0) {
    scaleX = Math.max(minScaleX, (handleX * (pointer.x - anchor.x)) / bounds.width);
  }
  if (handleY !== 0) {
    scaleY = Math.max(minScaleY, (handleY * (pointer.y - anchor.y)) / bounds.height);
  }
  if (handleX !== 0 && handleY !== 0) {
    const uniformScale = Math.max(scaleX, scaleY);
    scaleX = uniformScale;
    scaleY = uniformScale;
  }

  return { anchor, scaleX, scaleY };
}

function snapRotation(rotation: number): number {
  const snapped = Math.round(rotation / ROTATION_SNAP_INTERVAL_DEGREES) * ROTATION_SNAP_INTERVAL_DEGREES;
  const distance = Math.abs(rotation - snapped);
  return distance <= ROTATION_SNAP_THRESHOLD_DEGREES ? snapped : rotation;
}

function getResizedImageTransform(
  session: ImageTransformSession,
  pointer: Point,
  handle: ResizeHandle,
): WorkspaceItemTransform {
  const handleX = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const handleY = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const startWidth = session.frame.width * session.transform.scaleX;
  const startHeight = session.frame.height * session.transform.scaleY;
  const startTopLeft = { x: session.transform.x, y: session.transform.y };
  const anchorLocal = getResizeAnchorLocal(handleX, handleY, startWidth, startHeight);
  const anchor = addPoint(startTopLeft, rotatePoint(anchorLocal, session.transform.rotation));
  const pointerLocal = rotatePoint(
    { x: pointer.x - anchor.x, y: pointer.y - anchor.y },
    -session.transform.rotation,
  );

  let nextWidth = startWidth;
  let nextHeight = startHeight;
  let topLeftLocal = { x: 0, y: 0 };

  if (handleX !== 0 && handleY !== 0) {
    const widthRatio = Math.max(MIN_IMAGE_SIZE / startWidth, (handleX * pointerLocal.x) / startWidth);
    const heightRatio = Math.max(MIN_IMAGE_SIZE / startHeight, (handleY * pointerLocal.y) / startHeight);
    const ratio = Math.max(widthRatio, heightRatio);
    nextWidth = startWidth * ratio;
    nextHeight = startHeight * ratio;
    topLeftLocal = { x: handleX === 1 ? 0 : -nextWidth, y: handleY === 1 ? 0 : -nextHeight };
  } else if (handleX !== 0) {
    nextWidth = Math.max(MIN_IMAGE_SIZE, handleX * pointerLocal.x);
    topLeftLocal = { x: handleX === 1 ? 0 : -nextWidth, y: -startHeight / 2 };
  } else if (handleY !== 0) {
    nextHeight = Math.max(MIN_IMAGE_SIZE, handleY * pointerLocal.y);
    topLeftLocal = { x: -startWidth / 2, y: handleY === 1 ? 0 : -nextHeight };
  }

  const topLeft = addPoint(anchor, rotatePoint(topLeftLocal, session.transform.rotation));
  return normalizeWorkspaceItemTransform({
    ...session.transform,
    x: topLeft.x,
    y: topLeft.y,
    scaleX: nextWidth / session.frame.width,
    scaleY: nextHeight / session.frame.height,
  });
}

function getResizeAnchorLocal(handleX: number, handleY: number, width: number, height: number): Point {
  return {
    x: handleX === -1 ? width : handleX === 1 ? 0 : width / 2,
    y: handleY === -1 ? height : handleY === 1 ? 0 : height / 2,
  };
}

function getSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
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

function ImportedSvgPreview({ importedSvg, language }: { importedSvg: ImportedSvg; language: Language }) {
  const { t } = createTranslator(language);
  const friendlyMessages = getFriendlySvgMessages(importedSvg.preflight, language);
  const isReady = importedSvg.preflight.ok && importedSvg.preflight.warnings.length === 0;

  return (
    <div className="import-preview-grid">
      <div className="svg-preview-frame">
        <iframe title={t("import.previewTitle", { fileName: importedSvg.fileName })} sandbox="" srcDoc={importedSvg.previewHtml} />
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
              importedSvg.preflight.issues.length > 0
                ? `Issues:\n${importedSvg.preflight.issues.join("\n")}`
                : "Issues: none",
              importedSvg.preflight.warnings.length > 0
                ? `Warnings:\n${importedSvg.preflight.warnings.join("\n")}`
                : "Warnings: none",
            ].join("\n\n")}
          </pre>
        </details>

        <details>
          <summary>{t("details.rawSvg")}</summary>
          <pre>{importedSvg.svg}</pre>
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
