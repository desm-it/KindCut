import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { CutSessionSnapshot, SlicebugPlanResult, SlicebugStatus, SvgPlanInput } from "./slicebug-service";

type AppActionPayload = {
  action:
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
    | "edit-redo";
  value?: string;
};

type ProjectSaveInput = {
  content: string;
  defaultFileName: string;
  currentPath?: string | null;
};

type ProjectFileResult =
  | { canceled: true }
  | { canceled: false; path: string; content?: string };

export type WorkspaceEditState = {
  isWorkspaceContextTarget: boolean;
  selectedObjectCount: number;
  objectCount: number;
  hasInternalClipboard: boolean;
};

const emptyEditState: WorkspaceEditState = {
  isWorkspaceContextTarget: false,
  selectedObjectCount: 0,
  objectCount: 0,
  hasInternalClipboard: false,
};

let editStateProvider: (() => WorkspaceEditState) | null = null;

ipcRenderer.on("workspace-edit-state:request", (_event: IpcRendererEvent, requestId: string) => {
  ipcRenderer.send("workspace-edit-state:response", {
    requestId,
    state: editStateProvider?.() ?? emptyEditState,
  });
});

export type LibraryImageMeta = { name: string; path: string; isAi: boolean; svg: string };

const desktopApi = {
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? "0.1.0",
  },
  onAppAction: (callback: (payload: AppActionPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: AppActionPayload) => callback(payload);
    ipcRenderer.on("app:action", listener);
    return () => ipcRenderer.removeListener("app:action", listener);
  },
  workspaceEditState: {
    setProvider: (provider: (() => WorkspaceEditState) | null): (() => void) => {
      editStateProvider = provider;
      return () => {
        if (editStateProvider === provider) {
          editStateProvider = null;
        }
      };
    },
  },
  project: {
    save: (input: ProjectSaveInput): Promise<ProjectFileResult> => ipcRenderer.invoke("project:save", input),
    open: (): Promise<ProjectFileResult> => ipcRenderer.invoke("project:open"),
  },
  imageLibrary: {
    list: (): Promise<LibraryImageMeta[]> => ipcRenderer.invoke("library:list"),
    save: (input: { name: string; svg: string; isAi: boolean }): Promise<string> =>
      ipcRenderer.invoke("library:save", input),
    delete: (filePath: string): Promise<void> => ipcRenderer.invoke("library:delete", filePath),
  },
  ai: {
    dalleGeneratePng: (input: {
      prompt: string; complexity: number; language: string; apiKey: string; imageModel: string;
    }): Promise<string> => ipcRenderer.invoke("ai:dalle-generate-png", input),
    tracePngToSvg: (pngBase64: string): Promise<string> =>
      ipcRenderer.invoke("ai:trace-png-to-svg", pngBase64),
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
