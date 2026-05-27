import { contextBridge } from "electron";

const desktopApi = {
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? "0.1.0",
  },
};

contextBridge.exposeInMainWorld("cricutCompanion", desktopApi);

export type CricutCompanionDesktopApi = typeof desktopApi;
