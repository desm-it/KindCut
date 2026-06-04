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
  read: (buffer: Buffer) => Promise<{
    grayscale: () => { contrast: (v: number) => { threshold: (opts: { max: number; replace?: number; autoGreyscale?: boolean }) => { getBufferAsync: (mime: string) => Promise<Buffer> } } };
    MIME_PNG: string;
  }>;
  MIME_PNG: string;
};
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
  | "edit-ungroup"
  | "edit-flip-x"
  | "edit-flip-y"
  | "edit-bring-forward"
  | "edit-send-backward"
  | "edit-bring-to-front"
  | "edit-send-to-back";

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
    { label: "Bring to Front", enabled: editState.canReorder, click: () => sendRendererAction("edit-bring-to-front") },
    { label: "Bring Forward", enabled: editState.canReorder, click: () => sendRendererAction("edit-bring-forward") },
    { label: "Send Backward", enabled: editState.canReorder, click: () => sendRendererAction("edit-send-backward") },
    { label: "Send to Back", enabled: editState.canReorder, click: () => sendRendererAction("edit-send-to-back") },
    { type: "separator" },
    { label: "Flip Horizontal", enabled: hasSelection, click: () => sendRendererAction("edit-flip-x") },
    { label: "Flip Vertical", enabled: hasSelection, click: () => sendRendererAction("edit-flip-y") },
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

async function preprocessToBlackWhite(pngBuffer: Buffer): Promise<Buffer> {
  // Convert DALL-E colour image to high-contrast B&W so Potrace gets clean edges.
  const image = await Jimp.read(pngBuffer);
  // grayscale → max contrast → threshold at 50%
  const processed = image
    .grayscale()
    .contrast(1)           // push to maximum contrast
    .threshold({ max: 128, autoGreyscale: false }); // pixels > 128 → white, ≤ 128 → black
  return processed.getBufferAsync(Jimp.MIME_PNG);
}

function traceWithPotrace(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, {
      threshold: 128,    // image is already B&W from Jimp, simple 50% threshold
      turdSize: 150,     // remove JPEG/PNG noise blobs
      optCurve: true,
      optTolerance: 0.2,
      color: "#000000",
      background: "transparent",
    }, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

// Split into two handlers so the renderer can show step-by-step progress

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
  const rawBuffer = Buffer.from(pngBase64, "base64");
  const bwBuffer = await preprocessToBlackWhite(rawBuffer);
  return traceWithPotrace(bwBuffer);
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
