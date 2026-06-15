import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const potrace = require("potrace") as {
  trace: (
    input: Buffer,
    options: {
      threshold?: number; turdSize?: number; optCurve?: boolean;
      optTolerance?: number; color?: string; background?: string;
    },
    cb: (err: Error | null, svg: string) => void,
  ) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Jimp = require("jimp") as {
  read: (buffer: Buffer) => Promise<JimpImage>;
  MIME_PNG: string;
};
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type {
  IpcMainEvent,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  SaveDialogOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  configureDiagnosticsLog,
  getDiagnosticsLogFilePath,
  getDiagnosticsLogsDir,
  logDiagnostics,
} from "./diagnostics-log";
import {
  SlicebugCutSession,
  bootstrapSlicebug,
  checkForBlockingCutterProcesses,
  generateSampleSlicebugPlan,
  generateSvgSlicebugPlan,
  getSlicebugSetupStatus,
  getSlicebugStatus,
  setSlicebugLoggingEnabled,
} from "./slicebug-service";
import type { CutSessionSnapshot, SvgPlanInput } from "./slicebug-service";
import { createMainWindowOptions, resolveRendererEntry } from "./window-config";
import { isVersionAtLeast, shouldSuppressSkippedUpdate } from "./update-version";
import type { SkippedUpdateState } from "./update-version";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let activeCutSession: SlicebugCutSession | null = null;
const closeAllowedWindows = new WeakSet<BrowserWindow>();
let updateCheckInProgress = false;
let installingUpdate = false;
let updateEventsConfigured = false;

type RendererAction =
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

type ProjectSaveInput = {
  content: string;
  defaultFileName: string;
  currentPath?: string | null;
};

type ProjectFileResult =
  | { canceled: true }
  | { canceled: false; path: string; content?: string };

type WorkspaceEditState = {
  isWorkspaceContextTarget: boolean;
  selectedObjectCount: number;
  objectCount: number;
  hasInternalClipboard: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canReorder: boolean;
};

type ProjectState = {
  hasOpenProject: boolean;
  hasUnsavedChanges: boolean;
};

type PendingUpdateState = {
  version: string;
  status: "ready" | "installing";
  createdAt: string;
  updatedAt: string;
  downloadedFile?: string;
};

type UpdateProgressState = {
  percent: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

type UpdateRendererState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "not-available"
    | "failed";
  visible: boolean;
  manual: boolean;
  version?: string;
  currentVersion: string;
  message?: string;
  detail?: string;
  progress?: UpdateProgressState;
  downloadedFile?: string;
};

type AppSettings = {
  slicebugLoggingEnabled?: boolean;
};

type JimpImage = {
  bitmap: {
    data: Buffer;
    width: number;
    height: number;
  };
  getBufferAsync: (mime: string) => Promise<Buffer>;
};

type RasterTraceOptions = {
  threshold?: number;
  detail?: number;
  invert?: boolean;
};

type RasterTraceBackendOptions = {
  threshold: number;
  turdSize: number;
  optTolerance: number;
  invert: boolean;
};

const PROJECT_FILE_FILTER = { name: "KindCut Projects", extensions: ["kindcut"] };
const EDIT_STATE_REQUEST_TIMEOUT_MS = 250;
const PROJECT_STATE_REQUEST_TIMEOUT_MS = 500;
const PENDING_UPDATE_FILE_NAME = "pending-update.json";
const SKIPPED_UPDATE_FILE_NAME = "skipped-update.json";
const SETTINGS_FILE_NAME = "settings.json";
const ABOUT_COPY =
  "KindCut helps you design, preview, save, and prepare Cricut projects locally. " +
  "Cutter handoff is powered by the bundled SliceBug helper and always requires explicit confirmation.";
let slicebugLoggingEnabled = false;
let updateRendererState: UpdateRendererState = {
  status: "idle",
  visible: false,
  manual: false,
  currentVersion: app.getVersion(),
};
let availableUpdateVersion: string | null = null;
let availableDownloadedFile: string | null = null;

function ensureKindCutExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(".kindcut") ? filePath : `${filePath}.kindcut`;
}

async function saveProjectFile(input: ProjectSaveInput): Promise<ProjectFileResult> {
  let filePath = input.currentPath ?? null;
  if (!filePath) {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const saveOptions: SaveDialogOptions = {
      title: "Save KindCut Project",
      defaultPath: input.defaultFileName,
      filters: [PROJECT_FILE_FILTER],
    };
    const result = focusedWindow
      ? await dialog.showSaveDialog(focusedWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    filePath = result.filePath;
  }

  const normalizedPath = ensureKindCutExtension(filePath);
  await fs.writeFile(normalizedPath, input.content, "utf8");
  return { canceled: false, path: normalizedPath };
}

async function openProjectFile(): Promise<ProjectFileResult> {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const openOptions: OpenDialogOptions = {
    title: "Open KindCut Project",
    properties: ["openFile"],
    filters: [PROJECT_FILE_FILTER],
  };
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) {
    return { canceled: true };
  }

  const content = await fs.readFile(filePath, "utf8");
  return { canceled: false, path: filePath, content };
}
function sendRendererAction(action: RendererAction, value?: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("app:action", { action, value });
  }
}

function toggleFocusedWindowDevTools(): void {
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!focusedWindow) {
    return;
  }

  if (focusedWindow.webContents.isDevToolsOpened()) {
    focusedWindow.webContents.closeDevTools();
  } else {
    focusedWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function showAboutDialog(): void {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const options = {
    type: "info" as const,
    title: "About KindCut",
    message: `KindCut ${app.getVersion()}`,
    detail: `${ABOUT_COPY}\n\nCopyright 2026 Joel De Smit.`,
    buttons: ["OK"],
  };

  if (focusedWindow) {
    void dialog.showMessageBox(focusedWindow, options);
    return;
  }

  void dialog.showMessageBox(options);
}

function configureAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: "KindCut",
    applicationVersion: app.getVersion(),
    version: "Cricut companion 1.0",
    copyright: "Copyright 2026 Joel De Smit",
    credits: ABOUT_COPY,
  });
}

function getPreferredWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function showMessage(window: BrowserWindow | null, options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function pendingUpdatePath(): string {
  return path.join(app.getPath("userData"), PENDING_UPDATE_FILE_NAME);
}

function skippedUpdatePath(): string {
  return path.join(app.getPath("userData"), SKIPPED_UPDATE_FILE_NAME);
}

function appSettingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.slicebugLoggingEnabled === undefined || typeof record.slicebugLoggingEnabled === "boolean";
}

async function readAppSettings(): Promise<AppSettings> {
  try {
    const content = await fs.readFile(appSettingsPath(), "utf8");
    const parsed = JSON.parse(content) as unknown;
    return isAppSettings(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAppSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(path.dirname(appSettingsPath()), { recursive: true });
  await fs.writeFile(appSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function loadAppSettings(): Promise<void> {
  const settings = await readAppSettings();
  slicebugLoggingEnabled = settings.slicebugLoggingEnabled === true;
  setSlicebugLoggingEnabled(slicebugLoggingEnabled);
}

async function setSlicebugLoggingPreference(enabled: boolean): Promise<void> {
  slicebugLoggingEnabled = enabled;
  setSlicebugLoggingEnabled(enabled);
  await writeAppSettings({ ...(await readAppSettings()), slicebugLoggingEnabled: enabled });
  Menu.setApplicationMenu(createAppMenu());
  logDiagnostics("info", "[KindCut settings] SliceBug logging changed", { enabled });
}

function isPendingUpdateState(value: unknown): value is PendingUpdateState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    (record.status === "ready" || record.status === "installing") &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    (record.downloadedFile === undefined || typeof record.downloadedFile === "string")
  );
}

function isSkippedUpdateState(value: unknown): value is SkippedUpdateState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.version === "string" && typeof record.skippedAt === "string";
}

async function readPendingUpdate(): Promise<PendingUpdateState | null> {
  try {
    const content = await fs.readFile(pendingUpdatePath(), "utf8");
    const parsed = JSON.parse(content) as unknown;
    return isPendingUpdateState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readSkippedUpdate(): Promise<SkippedUpdateState | null> {
  try {
    const content = await fs.readFile(skippedUpdatePath(), "utf8");
    const parsed = JSON.parse(content) as unknown;
    return isSkippedUpdateState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writePendingUpdate(
  version: string,
  status: PendingUpdateState["status"],
  downloadedFile?: string | null,
): Promise<void> {
  const existing = await readPendingUpdate();
  const now = new Date().toISOString();
  const next: PendingUpdateState = {
    version,
    status,
    createdAt: existing?.version === version ? existing.createdAt : now,
    updatedAt: now,
    downloadedFile: downloadedFile ?? (existing?.version === version ? existing.downloadedFile : undefined),
  };
  await fs.mkdir(path.dirname(pendingUpdatePath()), { recursive: true });
  await fs.writeFile(pendingUpdatePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function writeSkippedUpdate(version: string): Promise<void> {
  const next: SkippedUpdateState = {
    version,
    skippedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(skippedUpdatePath()), { recursive: true });
  await fs.writeFile(skippedUpdatePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function clearPendingUpdate(): Promise<void> {
  await fs.rm(pendingUpdatePath(), { force: true });
}

async function clearSkippedUpdate(): Promise<void> {
  await fs.rm(skippedUpdatePath(), { force: true });
}

async function clearStaleSkippedUpdate(): Promise<SkippedUpdateState | null> {
  const skippedUpdate = await readSkippedUpdate();
  if (!skippedUpdate) {
    return null;
  }
  if (isVersionAtLeast(app.getVersion(), skippedUpdate.version)) {
    logUpdaterEvent("Clearing stale skipped update because installed version caught up", { skippedUpdate });
    await clearSkippedUpdate();
    return null;
  }
  return skippedUpdate;
}

async function shouldSuppressAutomaticUpdate(version: string, interactive: boolean): Promise<boolean> {
  const skippedUpdate = await clearStaleSkippedUpdate();
  return shouldSuppressSkippedUpdate({ availableVersion: version, interactive, skippedUpdate });
}

async function fileExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getMacAppBundlePath(): string {
  return path.resolve(path.dirname(process.execPath), "..", "..");
}

function buildMacUpdateInstallScript(): string {
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    'APP_PATH="$1"',
    'ZIP_PATH="$2"',
    'APP_PID="$3"',
    'LOG_PATH="$4"',
    'APP_NAME="$(basename "$APP_PATH")"',
    'BACKUP_PATH="${APP_PATH}.kindcut-update-backup"',
    'TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kindcut-update.XXXXXX")"',
    "",
    'exec >> "$LOG_PATH" 2>&1',
    'echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Installing KindCut update"',
    'echo "App: $APP_PATH"',
    'echo "Zip: $ZIP_PATH"',
    "",
    "cleanup() {",
    '  rm -rf "$TMP_DIR"',
    "}",
    "trap cleanup EXIT",
    "",
    "for _ in $(seq 1 120); do",
    '  if ! kill -0 "$APP_PID" 2>/dev/null; then',
    "    break",
    "  fi",
    "  sleep 0.5",
    "done",
    "",
    'ditto -x -k "$ZIP_PATH" "$TMP_DIR"',
    'NEW_APP="$(find "$TMP_DIR" -maxdepth 3 -name "$APP_NAME" -type d -print -quit)"',
    'if [ -z "$NEW_APP" ]; then',
    '  echo "Could not find $APP_NAME inside update zip"',
    "  exit 1",
    "fi",
    "",
    'rm -rf "$BACKUP_PATH"',
    'mv "$APP_PATH" "$BACKUP_PATH"',
    'if ! ditto "$NEW_APP" "$APP_PATH"; then',
    '  echo "Copy failed; restoring previous app"',
    '  rm -rf "$APP_PATH"',
    '  mv "$BACKUP_PATH" "$APP_PATH"',
    '  open "$APP_PATH"',
    "  exit 1",
    "fi",
    "",
    'rm -rf "$BACKUP_PATH"',
    'xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true',
    'open "$APP_PATH"',
    'echo "Install complete"',
    "",
  ].join("\n");
}

async function runMacUpdateInstaller(downloadedFile: string): Promise<void> {
  const appBundlePath = getMacAppBundlePath();
  const logPath = path.join(app.getPath("userData"), "updater-install.log");
  const scriptPath = path.join(app.getPath("temp"), `kindcut-update-${Date.now()}.sh`);
  await fs.writeFile(scriptPath, buildMacUpdateInstallScript(), { encoding: "utf8", mode: 0o700 });
  const child = spawn("/bin/bash", [scriptPath, appBundlePath, downloadedFile, String(process.pid), logPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  app.quit();
}

function pickDownloadedUpdateFile(downloadedFiles: string[]): string | null {
  return downloadedFiles.find((file) => file.endsWith(".zip") || file.endsWith(".dmg") || file.endsWith(".exe")) ?? downloadedFiles[0] ?? null;
}

function publishUpdateState(next: Partial<UpdateRendererState>): UpdateRendererState {
  updateRendererState = {
    ...updateRendererState,
    ...next,
    currentVersion: app.getVersion(),
  };
  logDiagnostics("info", "[KindCut updater] State changed", updateRendererState);
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("updater:state", updateRendererState);
  }
  return updateRendererState;
}

function logUpdaterEvent(message: string, details: Record<string, unknown> = {}): void {
  logDiagnostics("info", `[KindCut updater] ${message}`, {
    ...details,
    version: app.getVersion(),
    platform: process.platform,
    updateCacheDir: path.join(app.getPath("userData"), "pending"),
    pendingUpdatePath: pendingUpdatePath(),
    skippedUpdatePath: skippedUpdatePath(),
  });
}

function clearWindowProgress(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setProgressBar(-1);
  }
}

function setWindowProgress(progress: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setProgressBar(progress);
  }
}

function configureUpdates(mainWindow: BrowserWindow): void {
  const allowDevUpdateCheck = process.env.KINDCUT_ENABLE_DEV_AUTO_UPDATE === "1";
  if (
    process.env.KINDCUT_DISABLE_AUTO_UPDATE === "1" ||
    (!app.isPackaged && !allowDevUpdateCheck) ||
    (isDevelopment && !allowDevUpdateCheck)
  ) {
    return;
  }

  const updateFeedUrl = process.env.KINDCUT_UPDATE_URL?.trim();
  if (updateFeedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: updateFeedUrl });
  }
  if (allowDevUpdateCheck) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = console;

  if (!updateEventsConfigured) {
    updateEventsConfigured = true;
    autoUpdater.on("error", (error) => {
      logDiagnostics("error", "[KindCut updater] Update error", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      installingUpdate = false;
      clearWindowProgress();
      publishUpdateState({
        status: "failed",
        visible: updateRendererState.manual,
        message: "KindCut could not update right now.",
        detail: error.message,
      });
    });
    autoUpdater.on("checking-for-update", () => {
      logUpdaterEvent("Checking for update");
    });
    autoUpdater.on("update-available", (info) => {
      logUpdaterEvent("Update available", { updateInfo: info });
    });
    autoUpdater.on("update-not-available", (info) => {
      logUpdaterEvent("Update not available", { updateInfo: info });
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, progress.percent || 0));
      setWindowProgress(percent / 100);
      publishUpdateState({
        status: "downloading",
        visible: updateRendererState.visible,
        progress: {
          percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
      });
    });
    autoUpdater.on("update-downloaded", (event) => {
      logUpdaterEvent("Update downloaded", {
        updateInfo: event,
        downloadedFile: availableDownloadedFile,
      });
      clearWindowProgress();
    });
  }

  void startUpdateFlow(mainWindow);
}

async function startUpdateFlow(mainWindow: BrowserWindow): Promise<void> {
  const pendingUpdate = await readPendingUpdate();
  if (pendingUpdate && isVersionAtLeast(app.getVersion(), pendingUpdate.version)) {
    logUpdaterEvent("Clearing stale pending update because installed version caught up", { pendingUpdate });
    await clearPendingUpdate();
    await checkForUpdates({ interactive: false, sourceWindow: mainWindow });
    return;
  }
  if (pendingUpdate?.status === "ready") {
    await installPendingUpdateOnStartup(mainWindow, pendingUpdate);
    return;
  }
  if (pendingUpdate?.status === "installing") {
    publishUpdateState({
      status: "installing",
      visible: true,
      manual: false,
      version: pendingUpdate.version,
      downloadedFile: pendingUpdate.downloadedFile,
      message: `KindCut ${pendingUpdate.version} is installing.`,
      detail: "If this keeps showing, use Check for Updates from the menu to retry.",
    });
    return;
  }

  await checkForUpdates({ interactive: false, sourceWindow: mainWindow });
}

async function installPendingUpdateOnStartup(window: BrowserWindow, pendingUpdate: PendingUpdateState): Promise<void> {
  installingUpdate = true;
  setWindowProgress(2);
  publishUpdateState({
    status: "installing",
    visible: true,
    manual: false,
    version: pendingUpdate.version,
    downloadedFile: pendingUpdate.downloadedFile,
    message: `KindCut ${pendingUpdate.version} is installing.`,
    detail: "The app will restart to complete the update.",
  });

  try {
    await installPreparedUpdate(pendingUpdate.version, pendingUpdate.downloadedFile);
  } catch (error) {
    logDiagnostics("error", "[KindCut updater] Failed to install pending update", {
      error: error instanceof Error ? error.message : String(error),
      pendingUpdate,
    });
    installingUpdate = false;
    await writePendingUpdate(pendingUpdate.version, "ready", pendingUpdate.downloadedFile);
    clearWindowProgress();
    publishUpdateState({
      status: "ready",
      visible: true,
      manual: true,
      version: pendingUpdate.version,
      downloadedFile: pendingUpdate.downloadedFile,
      message: `KindCut ${pendingUpdate.version} is ready.`,
      detail: "Restart KindCut to try installing the update again.",
    });
  }
}

async function downloadUpdateFileForVersion(version: string, existingFile?: string | null): Promise<string | null> {
  if (await fileExists(existingFile)) {
    return existingFile ?? null;
  }

  const result = await autoUpdater.checkForUpdates();
  const updateInfo = result?.updateInfo;
  if (!result?.isUpdateAvailable || !updateInfo || updateInfo.version !== version) {
    logUpdaterEvent("Requested update version is no longer available", {
      requestedVersion: version,
      updateInfo,
    });
    await clearPendingUpdate();
    return null;
  }

  const downloadedFiles = await autoUpdater.downloadUpdate();
  const downloadedFile = pickDownloadedUpdateFile(downloadedFiles);
  availableDownloadedFile = downloadedFile;
  logUpdaterEvent("Downloaded update for version", { version, downloadedFile, downloadedFiles });
  return downloadedFile;
}

async function installPreparedUpdate(version: string, downloadedFile?: string | null): Promise<void> {
  const updateFile = await downloadUpdateFileForVersion(version, downloadedFile);
  if (!updateFile) {
    installingUpdate = false;
    return;
  }

  installingUpdate = true;
  await writePendingUpdate(version, "installing", updateFile);
  for (const window of BrowserWindow.getAllWindows()) {
    closeAllowedWindows.add(window);
  }
  clearWindowProgress();
  publishUpdateState({
    status: "installing",
    visible: true,
    manual: true,
    version,
    downloadedFile: updateFile,
    message: `KindCut ${version} is installing.`,
    detail: "KindCut will close and restart to complete the update.",
  });
  logUpdaterEvent("Installing prepared update", {
    version,
    downloadedFile: updateFile,
    processPlatform: process.platform,
  });

  if (process.platform === "darwin") {
    await runMacUpdateInstaller(updateFile);
    return;
  }

  autoUpdater.quitAndInstall(false, true);
}

async function checkForUpdates({ interactive, sourceWindow }: { interactive: boolean; sourceWindow?: BrowserWindow | null }): Promise<void> {
  if (updateCheckInProgress || (installingUpdate && !interactive)) {
    if (interactive) {
      publishUpdateState({
        status: updateCheckInProgress ? "checking" : "installing",
        visible: true,
        manual: true,
        message: updateCheckInProgress ? "KindCut is already checking for an update." : "KindCut is already preparing an update.",
      });
    }
    return;
  }

  updateCheckInProgress = true;
  const window = sourceWindow ?? getPreferredWindow();
  publishUpdateState({
    status: "checking",
    visible: interactive,
    manual: interactive,
    message: "Checking for updates...",
    progress: undefined,
  });

  try {
    await clearStaleSkippedUpdate();

    const pendingUpdate = await readPendingUpdate();
    if (pendingUpdate && !installingUpdate) {
      availableUpdateVersion = pendingUpdate.version;
      availableDownloadedFile = pendingUpdate.downloadedFile ?? null;
      publishUpdateState({
        status: "ready",
        visible: true,
        manual: interactive,
        version: pendingUpdate.version,
        downloadedFile: pendingUpdate.downloadedFile,
        message: `KindCut ${pendingUpdate.version} is ready.`,
        detail: "Restart KindCut to complete the update.",
      });
      return;
    }

    const result = await autoUpdater.checkForUpdates();
    const updateInfo = result?.updateInfo;
    if (!result?.isUpdateAvailable || !updateInfo) {
      publishUpdateState({
        status: "not-available",
        visible: interactive,
        manual: interactive,
        message: "KindCut is up to date.",
        detail: `You are running KindCut ${app.getVersion()}.`,
      });
      return;
    }

    availableUpdateVersion = updateInfo.version;
    availableDownloadedFile = null;

    if (await shouldSuppressAutomaticUpdate(updateInfo.version, interactive)) {
      logUpdaterEvent("Suppressing skipped update for automatic check", { version: updateInfo.version });
      publishUpdateState({
        status: "idle",
        visible: false,
        manual: false,
        version: updateInfo.version,
        message: undefined,
        detail: undefined,
        progress: undefined,
      });
      return;
    }

    const projectState = window ? await requestProjectState(window) : null;
    if (!projectState) {
      publishUpdateState({
        status: "available",
        visible: interactive,
        manual: interactive,
        version: updateInfo.version,
        message: `KindCut ${updateInfo.version} is available.`,
        detail: "KindCut could not confirm whether a project is open. Return to the welcome screen before installing.",
      });
      return;
    }

    if (projectState.hasOpenProject || projectState.hasUnsavedChanges) {
      publishUpdateState({
        status: "available",
        visible: interactive,
        manual: interactive,
        version: updateInfo.version,
        message: `KindCut ${updateInfo.version} is available.`,
        detail: projectState.hasUnsavedChanges
          ? "Save or close your current project, then return to the welcome screen before installing."
          : "Close your current project and return to the welcome screen before installing.",
      });
      return;
    }

    publishUpdateState({
      status: "available",
      visible: true,
      manual: interactive,
      version: updateInfo.version,
      message: `KindCut ${updateInfo.version} is available.`,
      detail: "Download it now or let it continue in the background.",
    });
  } catch (error) {
    clearWindowProgress();
    logDiagnostics("error", "[KindCut updater] Could not check for updates", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      interactive,
    });
    publishUpdateState({
      status: "failed",
      visible: interactive,
      manual: interactive,
      message: "KindCut could not check for updates right now.",
      detail: error instanceof Error ? error.message : "Please try again later.",
    });
  } finally {
    updateCheckInProgress = false;
  }
}

function checkForUpdatesFromMenu(): void {
  void checkForUpdates({ interactive: true, sourceWindow: getPreferredWindow() });
}

async function downloadAvailableUpdate({ background }: { background: boolean }): Promise<UpdateRendererState> {
  const version = availableUpdateVersion ?? updateRendererState.version;
  if (!version) {
    return publishUpdateState({
      status: "failed",
      visible: true,
      manual: true,
      message: "No update is ready to download.",
      detail: "Check for updates again.",
    });
  }

  publishUpdateState({
    status: "downloading",
    visible: !background,
    manual: true,
    version,
    message: `Downloading KindCut ${version}...`,
    detail: background ? "The update will continue downloading in the background." : undefined,
    progress: { percent: 0 },
  });

  try {
    const downloadedFile = await downloadUpdateFileForVersion(version, availableDownloadedFile);
    clearWindowProgress();
    if (!downloadedFile) {
      return publishUpdateState({
        status: "failed",
        visible: true,
        manual: true,
        version,
        message: "KindCut could not download the update.",
        detail: "Check for updates again.",
      });
    }
    availableDownloadedFile = downloadedFile;
    await writePendingUpdate(version, "ready", downloadedFile);
    return publishUpdateState({
      status: "ready",
      visible: true,
      manual: true,
      version,
      downloadedFile,
      progress: { percent: 100 },
      message: `KindCut ${version} is ready.`,
      detail: "Restart KindCut to complete the update.",
    });
  } catch (error) {
    clearWindowProgress();
    logDiagnostics("error", "[KindCut updater] Could not download update", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      version,
    });
    return publishUpdateState({
      status: "failed",
      visible: true,
      manual: true,
      version,
      message: "KindCut could not download the update.",
      detail: error instanceof Error ? error.message : "Please try again later.",
    });
  }
}

async function installReadyUpdate(): Promise<UpdateRendererState> {
  const pendingUpdate = await readPendingUpdate();
  const version = pendingUpdate?.version ?? updateRendererState.version ?? availableUpdateVersion;
  if (!version) {
    return publishUpdateState({
      status: "failed",
      visible: true,
      manual: true,
      message: "No downloaded update is ready.",
      detail: "Download the update first.",
    });
  }
  await installPreparedUpdate(version, pendingUpdate?.downloadedFile ?? availableDownloadedFile);
  return updateRendererState;
}

function dismissUpdateModal(): UpdateRendererState {
  return publishUpdateState({ visible: false, manual: false });
}

async function skipAvailableUpdate(): Promise<UpdateRendererState> {
  const version = updateRendererState.version ?? availableUpdateVersion;
  if (!version) {
    return publishUpdateState({
      status: "failed",
      visible: true,
      manual: true,
      message: "No update is ready to skip.",
      detail: "Check for updates again.",
    });
  }

  await writeSkippedUpdate(version);
  availableUpdateVersion = null;
  availableDownloadedFile = null;
  logUpdaterEvent("Skipped update version", { version });
  return publishUpdateState({
    status: "idle",
    visible: false,
    manual: false,
    version,
    message: undefined,
    detail: undefined,
    progress: undefined,
    downloadedFile: undefined,
  });
}

async function openLogsFolder(): Promise<void> {
  const logsDir = getDiagnosticsLogsDir();
  if (!logsDir) {
    await showMessage(getPreferredWindow(), {
      type: "warning",
      title: "KindCut Logs",
      message: "The logs folder is not ready yet.",
      buttons: ["OK"],
    });
    return;
  }

  await fs.mkdir(logsDir, { recursive: true });
  logDiagnostics("info", "[KindCut diagnostics] Opening logs folder", { logsDir });
  const result = await shell.openPath(logsDir);
  if (result) {
    await showMessage(getPreferredWindow(), {
      type: "warning",
      title: "KindCut Logs",
      message: "KindCut could not open the logs folder.",
      detail: result,
      buttons: ["OK"],
    });
  }
}

function createSlicebugLoggingMenuItem(): MenuItemConstructorOptions {
  return {
    label: "Enable SliceBug Logging",
    type: "checkbox",
    checked: slicebugLoggingEnabled,
    click: (menuItem) => {
      void setSlicebugLoggingPreference(Boolean(menuItem.checked));
    },
  };
}

function createProjectMenu(): MenuItemConstructorOptions {
  return {
    label: "Project",
    submenu: [
      { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => sendRendererAction("new-project") },
      { label: "Open Project...", accelerator: "CmdOrCtrl+O", click: () => sendRendererAction("open-project") },
      { label: "Save Project", accelerator: "CmdOrCtrl+S", click: () => sendRendererAction("save-project") },
      { label: "Save Project As...", accelerator: "Shift+CmdOrCtrl+S", click: () => sendRendererAction("save-project-as") },
      { type: "separator" },
      { label: "Example Project", click: () => sendRendererAction("example-project") },
    ],
  };
}

function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      // registerAccelerator: false — let the renderer handle these via keydown events so
      // the isEditableKeyboardTarget check can suppress them when a text field is focused.
      { label: "Undo", accelerator: "CmdOrCtrl+Z", registerAccelerator: false, click: () => sendRendererAction("edit-undo") },
      { label: "Redo", accelerator: process.platform === "darwin" ? "Shift+Cmd+Z" : "Ctrl+Y", registerAccelerator: false, click: () => sendRendererAction("edit-redo") },
      { type: "separator" },
      { label: "Cut", accelerator: "CmdOrCtrl+X", registerAccelerator: false, click: () => sendRendererAction("edit-cut") },
      { label: "Copy", accelerator: "CmdOrCtrl+C", registerAccelerator: false, click: () => sendRendererAction("edit-copy") },
      { label: "Paste", accelerator: "CmdOrCtrl+V", registerAccelerator: false, click: () => sendRendererAction("edit-paste") },
      { type: "separator" },
      { label: "Select All", accelerator: "CmdOrCtrl+A", registerAccelerator: false, click: () => sendRendererAction("edit-select-all") },
      { label: "Delete", accelerator: "Backspace", registerAccelerator: false, click: () => sendRendererAction("edit-delete") },
    ],
  };
}

function createAppMenu(): ReturnType<typeof Menu.buildFromTemplate> {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { label: "Check for Updates...", click: checkForUpdatesFromMenu },
              { label: "Open Logs Folder", click: () => void openLogsFolder() },
              createSlicebugLoggingMenuItem(),
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    createProjectMenu(),
    createEditMenu(),
    {
      label: "View",
      submenu: [
        { label: "Fullscreen", role: "togglefullscreen" },
        { label: "Toggle Debug Windows", accelerator: "Alt+CmdOrCtrl+I", click: toggleFocusedWindowDevTools },
        { type: "separator" },
        { role: "reload" },
      ],
    },
    {
      label: "Settings",
      submenu: [
        {
          label: "Language",
          submenu: [
            { label: "Nederlands", type: "radio", checked: true, click: () => sendRendererAction("set-language", "nl") },
            { label: "English", type: "radio", click: () => sendRendererAction("set-language", "en") },
          ],
        },
      ],
    },
    ...(process.platform === "darwin"
      ? []
      : [
          {
            role: "help",
            submenu: [
              { label: "Check for Updates...", click: checkForUpdatesFromMenu },
              { label: "Open Logs Folder", click: () => void openLogsFolder() },
              createSlicebugLoggingMenuItem(),
              { type: "separator" },
              { label: "About KindCut", click: showAboutDialog },
            ],
          } satisfies MenuItemConstructorOptions,
        ]),
  ];

  return Menu.buildFromTemplate(template);
}

function requestWorkspaceEditState(window: BrowserWindow): Promise<WorkspaceEditState | null> {
  const requestId = `edit-state-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener("workspace-edit-state:response", handleResponse);
      resolve(null);
    }, EDIT_STATE_REQUEST_TIMEOUT_MS);

    function handleResponse(
      event: IpcMainEvent,
      payload: { requestId?: string; state?: WorkspaceEditState },
    ) {
      if (event.sender !== window.webContents || payload.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      ipcMain.removeListener("workspace-edit-state:response", handleResponse);
      resolve(payload.state ?? null);
    }

    ipcMain.on("workspace-edit-state:response", handleResponse);
    window.webContents.send("workspace-edit-state:request", requestId);
  });
}

function requestProjectState(window: BrowserWindow): Promise<ProjectState | null> {
  const requestId = `project-state-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener("project-state:response", handleResponse);
      resolve(null);
    }, PROJECT_STATE_REQUEST_TIMEOUT_MS);

    function handleResponse(
      event: IpcMainEvent,
      payload: { requestId?: string; state?: ProjectState },
    ) {
      if (event.sender !== window.webContents || payload.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      ipcMain.removeListener("project-state:response", handleResponse);
      resolve(payload.state ?? null);
    }

    ipcMain.on("project-state:response", handleResponse);
    window.webContents.send("project-state:request", requestId);
  });
}

async function showContextMenu(window: BrowserWindow): Promise<void> {
  const editState = await requestWorkspaceEditState(window);
  if (!editState?.isWorkspaceContextTarget) {
    return;
  }

  const hasSelection = editState.selectedObjectCount > 0;
  const hasObjects = editState.objectCount > 0;
  const contextMenu = Menu.buildFromTemplate([
    { label: "Cut", accelerator: "CmdOrCtrl+X", enabled: hasSelection, click: () => sendRendererAction("edit-cut") },
    { label: "Copy", accelerator: "CmdOrCtrl+C", enabled: hasSelection, click: () => sendRendererAction("edit-copy") },
    { label: "Paste", accelerator: "CmdOrCtrl+V", enabled: editState.hasInternalClipboard, click: () => sendRendererAction("edit-paste") },
    { label: "Delete", accelerator: "Backspace", enabled: hasSelection, click: () => sendRendererAction("edit-delete") },
    { type: "separator" },
    { label: "Group", enabled: editState.canGroup, click: () => sendRendererAction("edit-group") },
    { label: "Ungroup", enabled: editState.canUngroup, click: () => sendRendererAction("edit-ungroup") },
    { type: "separator" },
    { label: "Bring to Front", enabled: editState.canReorder, click: () => sendRendererAction("edit-bring-to-front") },
    { label: "Bring Forward", enabled: editState.canReorder, click: () => sendRendererAction("edit-bring-forward") },
    { label: "Send Backward", enabled: editState.canReorder, click: () => sendRendererAction("edit-send-backward") },
    { label: "Send to Back", enabled: editState.canReorder, click: () => sendRendererAction("edit-send-to-back") },
    { type: "separator" },
    { label: "Flip Horizontal", enabled: hasSelection, click: () => sendRendererAction("edit-flip-x") },
    { label: "Flip Vertical", enabled: hasSelection, click: () => sendRendererAction("edit-flip-y") },
    { type: "separator" },
    { label: "Select All", accelerator: "CmdOrCtrl+A", enabled: hasObjects, click: () => sendRendererAction("edit-select-all") },
    { type: "separator" },
    { label: "Check for Updates...", click: checkForUpdatesFromMenu },
    { label: "Open Logs Folder", click: () => void openLogsFolder() },
    createSlicebugLoggingMenuItem(),
  ]);
  contextMenu.popup({ window });
}

async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, "preload.js");
  const mainWindow = new BrowserWindow(createMainWindowOptions({ preloadPath }));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("context-menu", (_, params) => {
    if (params.isEditable) {
      const { editFlags } = params;
      const hasSelection = params.selectionText.length > 0;
      const inputMenu = Menu.buildFromTemplate([
        { label: "Cut", enabled: hasSelection && editFlags.canCut, click: () => mainWindow.webContents.cut() },
        { label: "Copy", enabled: hasSelection && editFlags.canCopy, click: () => mainWindow.webContents.copy() },
        { label: "Paste", enabled: editFlags.canPaste, click: () => mainWindow.webContents.paste() },
        { type: "separator" },
        { label: "Select All", enabled: editFlags.canSelectAll, click: () => mainWindow.webContents.selectAll() },
      ]);
      inputMenu.popup({ window: mainWindow });
    }
    // The workspace context menu is shown explicitly on right-click *release* (via the
    // "workspace:show-context-menu" IPC) so a right-drag can pan without popping a menu.
  });

  mainWindow.on("close", (event) => {
    if (installingUpdate || closeAllowedWindows.has(mainWindow)) {
      return;
    }
    event.preventDefault();
    mainWindow.webContents.send("app:action", { action: "close-window" });
  });

  const rendererEntry = resolveRendererEntry({
    appRoot: path.resolve(__dirname, ".."),
    viteDevServerUrl: process.env.VITE_DEV_SERVER_URL,
  });

  if (rendererEntry.type === "url") {
    await mainWindow.loadURL(rendererEntry.value);
  } else {
    await mainWindow.loadFile(rendererEntry.value);
  }

  return mainWindow;
}

app.setName("KindCut");
configureAboutPanel();
Menu.setApplicationMenu(createAppMenu());

ipcMain.handle("workspace:show-context-menu", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) void showContextMenu(win);
});
ipcMain.handle("project:save", async (_event, input: ProjectSaveInput): Promise<ProjectFileResult> => saveProjectFile(input));
ipcMain.handle("project:open", async (): Promise<ProjectFileResult> => openProjectFile());
ipcMain.handle("app:close-confirmed", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return;
  }
  closeAllowedWindows.add(win);
  win.close();
});
ipcMain.handle("updater:get-state", () => updateRendererState);
ipcMain.handle("updater:check", async (event) => {
  await checkForUpdates({ interactive: true, sourceWindow: BrowserWindow.fromWebContents(event.sender) });
  return updateRendererState;
});
ipcMain.handle("updater:download", async (_event, input?: { background?: boolean }) =>
  downloadAvailableUpdate({ background: Boolean(input?.background) }),
);
ipcMain.handle("updater:install", async () => installReadyUpdate());
ipcMain.handle("updater:dismiss", () => dismissUpdateModal());
ipcMain.handle("updater:skip", async () => skipAvailableUpdate());
ipcMain.handle("slicebug:get-status", async () => getSlicebugStatus());
ipcMain.handle("slicebug:get-setup-status", async () => getSlicebugSetupStatus());
ipcMain.handle("slicebug:bootstrap", async (_event, input?: { designSpacePath?: string; designSpaceProfilePath?: string }) =>
  bootstrapSlicebug(input),
);
ipcMain.handle("slicebug:generate-sample-plan", async (_event, choices?: { materialId?: number; matPreset?: string }) =>
  generateSampleSlicebugPlan(choices),
);
ipcMain.handle("slicebug:create-plan", async (_event, input: SvgPlanInput) => generateSvgSlicebugPlan(input));
ipcMain.handle("slicebug:start-cut-session", async (_event, planPath: string): Promise<CutSessionSnapshot> => {
  const blocker = await checkForBlockingCutterProcesses();
  if (!blocker.ok) {
    activeCutSession = null;
    return {
      id: `cut-blocked-${Date.now()}`,
      status: "blocked",
      action: {
        kind: "error",
        code: "error.blockingProcesses",
        title: "Close Design Space",
        message: blocker.message,
        requiresContinue: false,
        canStop: false,
        tone: "error",
      },
      transcript: blocker.message,
      command: "",
      args: [],
      planPath,
    };
  }

  const status = await getSlicebugStatus();
  const executable = status.executable ?? "slicebug";
  activeCutSession = new SlicebugCutSession({
    id: `cut-${Date.now()}`,
    executable,
    planPath,
    smokeMode:
      process.env.CRICUT_COMPANION_SMOKE_SLICEBUG === "1" ||
      process.env.CRICUT_COMPANION_SMOKE_PLAN === "1" ||
      process.env.CRICUT_COMPANION_SMOKE_CUT === "1" ||
      process.env.NODE_ENV === "test",
  });
  return activeCutSession.start();
});
ipcMain.handle("slicebug:get-cut-session", async (): Promise<CutSessionSnapshot | null> => activeCutSession?.getSnapshot() ?? null);
ipcMain.handle("slicebug:continue-cut-session", async (): Promise<CutSessionSnapshot | null> => activeCutSession?.continue() ?? null);
ipcMain.handle("slicebug:stop-cut-session", async (): Promise<CutSessionSnapshot | null> => activeCutSession?.stop() ?? null);

// ── Image library ─────────────────────────────────────────────────────────────

type LibraryImageMeta = { name: string; path: string; isAi: boolean; svg: string };

function getLibraryDir(): string {
  return path.join(app.getPath("documents"), "KindCut", "images");
}

async function ensureLibraryDir(): Promise<void> {
  await fs.mkdir(getLibraryDir(), { recursive: true });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_\s]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || `image-${Date.now()}`;
}

function displayNameFromLibraryFileName(file: string): string {
  const baseName = file.toLowerCase().endsWith(".ai.svg") ? file.slice(0, -7) : file.slice(0, -4);
  return baseName.replace(/-/g, " ");
}

async function findAvailableLibraryPath(
  requestedName: string,
  ext: ".svg" | ".ai.svg",
  currentPath?: string,
): Promise<{ displayName: string; filePath: string }> {
  await ensureLibraryDir();
  const trimmed = requestedName.trim() || "image";
  let suffix = 1;

  while (true) {
    const displayName = suffix === 1 ? trimmed : `${trimmed} ${suffix}`;
    const safeName = sanitizeFileName(displayName);
    const filePath = path.join(getLibraryDir(), `${safeName}${ext}`);
    const normalPath = path.join(getLibraryDir(), `${safeName}.svg`);
    const aiPath = path.join(getLibraryDir(), `${safeName}.ai.svg`);
    const candidatePaths = [normalPath, aiPath].filter((candidate) => !currentPath || path.resolve(candidate) !== path.resolve(currentPath));
    if (candidatePaths.length < 2 && currentPath && path.resolve(filePath) === path.resolve(currentPath)) {
      return { displayName, filePath };
    }
    const hasDisplayNameCollision = (await Promise.all(candidatePaths.map((candidate) => fileExists(candidate)))).some(Boolean);
    if (!hasDisplayNameCollision) {
      return { displayName, filePath };
    }
    suffix += 1;
  }
}

ipcMain.handle("library:list", async (): Promise<LibraryImageMeta[]> => {
  await ensureLibraryDir();
  const dir = getLibraryDir();
  const files = await fs.readdir(dir);
  const svgFiles = files.filter((f) => f.toLowerCase().endsWith(".svg")).sort();
  const items = await Promise.all(
    svgFiles.map(async (file) => {
      const filePath = path.join(dir, file);
      const svg = await fs.readFile(filePath, "utf8");
      const isAi = file.toLowerCase().endsWith(".ai.svg");
      const displayName = displayNameFromLibraryFileName(file);
      return { name: displayName, path: filePath, isAi, svg };
    }),
  );
  return items;
});

ipcMain.handle("library:save", async (_event, input: { name: string; svg: string; isAi: boolean }): Promise<string> => {
  await ensureLibraryDir();
  const ext = input.isAi ? ".ai.svg" : ".svg";
  const { filePath } = await findAvailableLibraryPath(input.name, ext);
  await fs.writeFile(filePath, input.svg, "utf8");
  return filePath;
});

ipcMain.handle("library:rename", async (_event, input: { filePath: string; name: string }): Promise<LibraryImageMeta> => {
  await ensureLibraryDir();
  const currentPath = path.resolve(input.filePath);
  const libraryDir = path.resolve(getLibraryDir());
  if (!currentPath.startsWith(`${libraryDir}${path.sep}`)) {
    throw new Error("That image is outside the KindCut image library.");
  }

  const currentFileName = path.basename(currentPath);
  const isAi = currentFileName.toLowerCase().endsWith(".ai.svg");
  const ext = isAi ? ".ai.svg" : ".svg";
  const { displayName, filePath } = await findAvailableLibraryPath(input.name, ext, currentPath);
  if (path.resolve(filePath) !== currentPath) {
    await fs.rename(currentPath, filePath);
  }
  const svg = await fs.readFile(filePath, "utf8");
  return { name: displayName, path: filePath, isAi, svg };
});

ipcMain.handle("library:delete", async (_event, filePath: string): Promise<void> => {
  await fs.unlink(filePath);
});

ipcMain.handle("system:fonts", async (): Promise<string[]> => {
  try {
    // app.getSystemFonts() available in Electron 26+
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fonts = await (app as any).getSystemFonts?.();
    return Array.isArray(fonts) ? fonts : [];
  } catch {
    return [];
  }
});

// ── AI silhouette: DALL-E 3 → PNG → Potrace → SVG ────────────────────────────

function buildGptImagePrompt(subject: string, complexity: number): string {
  // SUBJECT FIRST — GPT Image weights the start of the prompt most heavily.
  // All 3 levels: filled solid shapes only — no line-art, no drawn outlines.
  // Potrace traces boundaries of filled dark regions on white.

  // IMPORTANT for all levels: the subject string IS the complete design brief.
  // Any examples or part names in the instructions are NOT design suggestions — do not
  // add animals, objects or details that are not explicitly mentioned in the subject.
  const onlySubject = `Draw ONLY "${subject}" — do not add cats, dogs, or any other subject not mentioned.`;

  if (complexity === 1) {
    return `${subject}. ${onlySubject} A single solid filled black silhouette on pure white. One completely filled shape with no internal details, no sub-shapes. Like a shadow or paper punch cut-out. One shape, 100% black filled, pure white background.`;
  }

  if (complexity === 2) {
    return `${subject}. ${onlySubject} A flat cut-file design on pure white background. Made of 4 to 6 separate solid filled black shapes representing distinct parts of the ${subject}. Every shape must have a visible white gap between it and its neighbours — the gap must be at least as thick as a bold pen stroke, clearly visible, never hair-thin. No shapes touching or overlapping. Each shape is its own solid black island with white space around it. No interior holes inside any shape. Every shape 100% solid black. Pure white background.`;
  }

  return `${subject}. ${onlySubject} A detailed rubber stamp design on pure white background. One single solid black connected shape with rich recognisable detail of the ${subject}. All features are defined by notches, bumps and curves in the outer boundary — making it immediately recognisable. No holes or cut-outs inside the shape. No floating islands. One highly detailed connected black piece on white. Think linocut print: lots of visible detail, fully one piece.`;
}

function clampTraceNumber(value: number, min: number, max: number): number {
  const finiteValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, finiteValue));
}

function mapRasterTraceOptions(options?: RasterTraceOptions | null): RasterTraceBackendOptions {
  const threshold = Math.round(clampTraceNumber(options?.threshold ?? 128, 0, 255));
  const detail = Math.round(clampTraceNumber(options?.detail ?? 45, 0, 100));
  const detailRatio = detail / 100;
  return {
    threshold,
    turdSize: Math.round(260 - detailRatio * 245),
    optTolerance: Number((0.36 - detailRatio * 0.28).toFixed(2)),
    invert: Boolean(options?.invert),
  };
}

async function preprocessToBlackWhite(pngBuffer: Buffer, options?: RasterTraceOptions): Promise<Buffer> {
  // Convert colour images to true black/white so the threshold slider stays predictable.
  const traceOptions = mapRasterTraceOptions(options);
  const image = await Jimp.read(pngBuffer);

  const { data, width, height } = image.bitmap;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (width * y + x) * 4;
      const alpha = data[index + 3] ?? 255;
      let value = 255;
      if (alpha >= 16) {
        const red = data[index] ?? 255;
        const green = data[index + 1] ?? 255;
        const blue = data[index + 2] ?? 255;
        value = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
        if (traceOptions.invert) {
          value = 255 - value;
        }
        value = value <= traceOptions.threshold ? 0 : 255;
      }
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }

  return image.getBufferAsync(Jimp.MIME_PNG);
}

function traceWithPotrace(buffer: Buffer, options?: RasterTraceOptions): Promise<string> {
  const traceOptions = mapRasterTraceOptions(options);
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, {
      threshold: 128,    // image is already B&W from Jimp, simple 50% threshold
      turdSize: traceOptions.turdSize,     // remove JPEG/PNG noise blobs
      optCurve: true,
      optTolerance: traceOptions.optTolerance,
      color: "#000000",
      background: "transparent",
    }, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

async function traceRasterBase64ToSvg(base64: string, options?: RasterTraceOptions): Promise<string> {
  const rawBuffer = Buffer.from(base64, "base64");
  const bwBuffer = await preprocessToBlackWhite(rawBuffer, options);
  return traceWithPotrace(bwBuffer, options);
}

// Split into separate handlers so the renderer can show step-by-step progress

ipcMain.handle("ai:dalle-generate-png", async (
  _event,
  input: { prompt: string; complexity: number; language: string; apiKey: string; imageModel?: string },
): Promise<string> => {
  const { prompt, complexity, apiKey, imageModel = "gpt-image-2" } = input;
  if (!apiKey.trim()) throw new Error("No OpenAI API key configured.");

  const imagePrompt = buildGptImagePrompt(prompt.trim(), complexity);

  const requestBody = {
    model: imageModel,   // gpt-image-1 / gpt-image-1.5 / gpt-image-2
    prompt: imagePrompt,
    n: 1,
    size: "1024x1024",
    quality: "high",     // high = cleanest edges for Jimp threshold + Potrace tracing
  };

  const imgResponse = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody),
  });

  if (!imgResponse.ok) {
    let msg = `GPT Image error ${imgResponse.status}`;
    try {
      const err = (await imgResponse.json()) as { error?: { message?: string } };
      if (err?.error?.message) msg = err.error.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const imgData = (await imgResponse.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = imgData.data?.[0];

  // gpt-image-1 returns b64_json directly; dall-e-3 with response_format=b64_json also does
  if (item?.b64_json) return item.b64_json;

  // Fallback: fetch URL if returned
  if (item?.url) {
    const urlRes = await fetch(item.url);
    const arrayBuf = await urlRes.arrayBuffer();
    return Buffer.from(arrayBuf).toString("base64");
  }

  throw new Error("Image generation returned no image data.");
});

ipcMain.handle("ai:trace-png-to-svg", async (_event, pngBase64: string): Promise<string> => {
  return traceRasterBase64ToSvg(pngBase64);
});

ipcMain.handle("image:trace-raster-to-svg", async (_event, input: {
  base64: string;
  fileName?: string;
  mimeType?: string;
  traceOptions?: RasterTraceOptions;
}): Promise<string> => {
  const traceOptions = mapRasterTraceOptions(input.traceOptions);
  logDiagnostics("info", "[KindCut image import] Tracing local raster image", {
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteLength: Buffer.byteLength(input.base64, "base64"),
    traceOptions,
  });
  return traceRasterBase64ToSvg(input.base64, input.traceOptions);
});

app.whenReady().then(async () => {
  configureDiagnosticsLog(path.join(app.getPath("userData"), "logs"));
  await loadAppSettings();
  Menu.setApplicationMenu(createAppMenu());
  logDiagnostics("info", "[KindCut diagnostics] App started", {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath("userData"),
    logFilePath: getDiagnosticsLogFilePath(),
    slicebugLoggingEnabled,
  });

  const mainWindow = await createMainWindow();
  configureUpdates(mainWindow);

  if (process.env.CRICUT_COMPANION_SMOKE_SLICEBUG === "1") {
    console.log(JSON.stringify({ slicebug: await getSlicebugStatus() }));
    app.quit();
    return;
  }

  if (process.env.CRICUT_COMPANION_SMOKE_PLAN === "1") {
    console.log(JSON.stringify({ plan: await generateSampleSlicebugPlan() }));
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

if (isDevelopment) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
