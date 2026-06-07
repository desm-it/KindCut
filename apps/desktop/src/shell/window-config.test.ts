import { describe, expect, it } from "vitest";
import path from "node:path";
import { createMainWindowOptions, resolveRendererEntry } from "./window-config";

describe("desktop shell window config", () => {
  it("creates a grandma-friendly macOS desktop window", () => {
    const options = createMainWindowOptions({ preloadPath: "/app/preload.js" });

    expect(options.title).toBe("KindCut");
    expect(options.width).toBeGreaterThanOrEqual(1180);
    expect(options.height).toBeGreaterThanOrEqual(760);
    expect(options.minWidth).toBeGreaterThanOrEqual(960);
    expect(options.minHeight).toBeGreaterThanOrEqual(640);
    expect(options.webPreferences?.preload).toBe("/app/preload.js");
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(false);
  });

  it("uses the Vite dev server during development", () => {
    const entry = resolveRendererEntry({ viteDevServerUrl: "http://127.0.0.1:5173" });

    expect(entry).toEqual({ type: "url", value: "http://127.0.0.1:5173" });
  });

  it("loads the packaged renderer html in production", () => {
    const entry = resolveRendererEntry({ appRoot: "/app" });

    expect(entry).toEqual({ type: "file", value: path.join("/app", "renderer", "index.html") });
  });
});
