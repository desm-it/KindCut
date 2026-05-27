import { contextBridge, ipcRenderer } from "electron";
import type { CutSessionSnapshot, SlicebugPlanResult, SlicebugStatus, SvgPlanInput } from "./slicebug-service";

const desktopApi = {
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? "0.1.0",
  },
  slicebug: {
    getStatus: (): Promise<SlicebugStatus> => ipcRenderer.invoke("slicebug:get-status"),
    generateSamplePlan: (choices?: { materialId?: number; matPreset?: string }): Promise<SlicebugPlanResult> =>
      ipcRenderer.invoke("slicebug:generate-sample-plan", choices),
    createPlan: (input: SvgPlanInput): Promise<SlicebugPlanResult> => ipcRenderer.invoke("slicebug:create-plan", input),
    startCutSession: (planPath: string): Promise<CutSessionSnapshot> =>
      ipcRenderer.invoke("slicebug:start-cut-session", planPath),
    getCutSession: (): Promise<CutSessionSnapshot | null> => ipcRenderer.invoke("slicebug:get-cut-session"),
    continueCutSession: (): Promise<CutSessionSnapshot | null> => ipcRenderer.invoke("slicebug:continue-cut-session"),
    stopCutSession: (): Promise<CutSessionSnapshot | null> => ipcRenderer.invoke("slicebug:stop-cut-session"),
  },
};

contextBridge.exposeInMainWorld("cricutCompanion", desktopApi);

export type CricutCompanionDesktopApi = typeof desktopApi;
export type { CutSessionSnapshot, SlicebugPlanResult, SlicebugStatus, SvgPlanInput };
