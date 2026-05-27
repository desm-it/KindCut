import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";

export type RendererEntry =
  | { type: "url"; value: string }
  | { type: "file"; value: string };

export interface RendererEntryInput {
  appRoot?: string;
  viteDevServerUrl?: string;
}

export function resolveRendererEntry(input: RendererEntryInput = {}): RendererEntry {
  if (input.viteDevServerUrl) {
    return { type: "url", value: input.viteDevServerUrl };
  }

  const appRoot = input.appRoot ?? path.resolve(__dirname, "..");
  return { type: "file", value: path.join(appRoot, "renderer", "index.html") };
}

export interface MainWindowOptionsInput {
  preloadPath: string;
}

export function createMainWindowOptions(input: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    title: "Cricut Companion",
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f7efe4",
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
}
