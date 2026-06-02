import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { IpcMainEvent, MenuItemConstructorOptions, OpenDialogOptions, SaveDialogOptions } from "electron";
import {
  SlicebugCutSession,
  generateSampleSlicebugPlan,
  generateSvgSlicebugPlan,
  getSlicebugStatus,
} from "./slicebug-service";
import type { CutSessionSnapshot, SvgPlanInput } from "./slicebug-service";
import { createMainWindowOptions, resolveRendererEntry } from "./window-config";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let activeCutSession: SlicebugCutSession | null = null;

type RendererAction =
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
};

const PROJECT_FILE_FILTER = { name: "KindCut Projects", extensions: ["kindcut"] };
const EDIT_STATE_REQUEST_TIMEOUT_MS = 250;

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

function createProjectMenu(): MenuItemConstructorOptions {
  return {
    label: "Project",
    submenu: [
      { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => sendRendererAction("new-project") },
      { label: "Open Project...", accelerator: "CmdOrCtrl+O", click: () => sendRendererAction("open-project") },
      { label: "Save Project", accelerator: "CmdOrCtrl+S", click: () => sendRendererAction("save-project") },
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
            submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
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
    { label: "Select All", accelerator: "CmdOrCtrl+A", enabled: hasObjects, click: () => sendRendererAction("edit-select-all") },
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
    } else {
      void showContextMenu(mainWindow);
    }
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
Menu.setApplicationMenu(createAppMenu());

ipcMain.handle("project:save", async (_event, input: ProjectSaveInput): Promise<ProjectFileResult> => saveProjectFile(input));
ipcMain.handle("project:open", async (): Promise<ProjectFileResult> => openProjectFile());
ipcMain.handle("slicebug:get-status", async () => getSlicebugStatus());
ipcMain.handle("slicebug:generate-sample-plan", async (_event, choices?: { materialId?: number; matPreset?: string }) =>
  generateSampleSlicebugPlan(choices),
);
ipcMain.handle("slicebug:create-plan", async (_event, input: SvgPlanInput) => generateSvgSlicebugPlan(input));
ipcMain.handle("slicebug:start-cut-session", async (_event, planPath: string): Promise<CutSessionSnapshot> => {
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
      const displayName = isAi ? file.slice(0, -7) : file.slice(0, -4);
      return { name: displayName, path: filePath, isAi, svg };
    }),
  );
  return items;
});

ipcMain.handle("library:save", async (_event, input: { name: string; svg: string; isAi: boolean }): Promise<string> => {
  await ensureLibraryDir();
  const ext = input.isAi ? ".ai.svg" : ".svg";
  const safe = sanitizeFileName(input.name);
  let fileName = `${safe}${ext}`;
  let filePath = path.join(getLibraryDir(), fileName);
  // Avoid collision
  let counter = 1;
  while (true) {
    try {
      await fs.access(filePath);
      fileName = `${safe}-${counter}${ext}`;
      filePath = path.join(getLibraryDir(), fileName);
      counter++;
    } catch {
      break;
    }
  }
  await fs.writeFile(filePath, input.svg, "utf8");
  return filePath;
});

ipcMain.handle("library:delete", async (_event, filePath: string): Promise<void> => {
  await fs.unlink(filePath);
});

app.whenReady().then(async () => {
  await createMainWindow();

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
