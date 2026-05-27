import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { createMainWindowOptions, resolveRendererEntry } from "./window-config";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

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

app.setName("Cricut Companion");

app.whenReady().then(async () => {
  await createMainWindow();

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
