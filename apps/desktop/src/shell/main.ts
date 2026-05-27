import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
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

  const rendererEntry = resolveRendererEntry({
    appRoot: path.resolve(__dirname, ".."),
    viteDevServerUrl: process.env.VITE_DEV_SERVER_URL,
  });

  if (rendererEntry.type === "url") {
    await mainWindow.loadURL(rendererEntry.value);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(rendererEntry.value);
  }

  return mainWindow;
}

Menu.setApplicationMenu(null);

app.setName("KindCut");

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

if (isDevelopment) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
