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
  | "edit-select-all";

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
      { label: "Cut", accelerator: "CmdOrCtrl+X", click: () => sendRendererAction("edit-cut") },
      { label: "Copy", accelerator: "CmdOrCtrl+C", click: () => sendRendererAction("edit-copy") },
      { label: "Paste", accelerator: "CmdOrCtrl+V", click: () => sendRendererAction("edit-paste") },
      { type: "separator" },
      { label: "Select All", accelerator: "CmdOrCtrl+A", click: () => sendRendererAction("edit-select-all") },
      { label: "Delete", accelerator: "Backspace", click: () => sendRendererAction("edit-delete") },
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

  mainWindow.webContents.on("context-menu", () => {
    void showContextMenu(mainWindow);
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
