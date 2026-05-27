import { contextBridge, ipcRenderer } from "electron";
import type { SlicebugPlanResult, SlicebugStatus } from "./slicebug-service";

const desktopApi = {
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? "0.1.0",
  },
  slicebug: {
    getStatus: (): Promise<SlicebugStatus> => ipcRenderer.invoke("slicebug:get-status"),
    generateSamplePlan: (): Promise<SlicebugPlanResult> => ipcRenderer.invoke("slicebug:generate-sample-plan"),
  },
};

contextBridge.exposeInMainWorld("cricutCompanion", desktopApi);

export type CricutCompanionDesktopApi = typeof desktopApi;
export type { SlicebugPlanResult, SlicebugStatus };
