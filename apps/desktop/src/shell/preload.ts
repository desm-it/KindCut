import { installNativeIntentCapture } from './native-joy-intent-capture';
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  CutSessionSnapshot,
  SlicebugBootstrapInput,
  SlicebugBootstrapResult,
  SlicebugPlanResult,
  SlicebugSetupStatus,
  SlicebugStatus,
  SvgPlanInput,
} from './slicebug-service';
import type { SpotifyCodeRequest, SpotifyLookupResult, SpotifySearchResult } from './spotify-code';
import type {
  NativeJoySetup,
  NativeJoySnapshot,
  NativeJoyLoadingState,
} from './native-joy-service';

type AppActionPayload = {
  action:
    | 'new-project'
    | 'open-project'
    | 'save-project'
    | 'save-project-as'
    | 'example-project'
    | 'set-language'
    | 'edit-cut'
    | 'edit-copy'
    | 'edit-paste'
    | 'edit-delete'
    | 'edit-select-all'
    | 'edit-undo'
    | 'edit-redo'
    | 'edit-group'
    | 'edit-ungroup'
    | 'edit-flip-x'
    | 'edit-flip-y'
    | 'edit-bring-forward'
    | 'edit-send-backward'
    | 'edit-bring-to-front'
    | 'edit-send-to-back'
    | 'close-window';
  value?: string;
};

type ProjectSaveInput = {
  content: string;
  defaultFileName: string;
  currentPath?: string | null;
};

type ProjectFileResult = { canceled: true } | { canceled: false; path: string; content?: string };

export type WorkspaceEditState = {
  isWorkspaceContextTarget: boolean;
  selectedObjectCount: number;
  objectCount: number;
  hasInternalClipboard: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canReorder: boolean;
};

export type ProjectState = {
  hasOpenProject: boolean;
  hasUnsavedChanges: boolean;
};

export type UpdateProgressState = {
  percent: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

export type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'not-available'
    | 'failed';
  visible: boolean;
  manual: boolean;
  version?: string;
  currentVersion: string;
  message?: string;
  detail?: string;
  progress?: UpdateProgressState;
  downloadedFile?: string;
};

const emptyEditState: WorkspaceEditState = {
  isWorkspaceContextTarget: false,
  selectedObjectCount: 0,
  objectCount: 0,
  hasInternalClipboard: false,
  canGroup: false,
  canUngroup: false,
  canReorder: false,
};

let editStateProvider: (() => WorkspaceEditState) | null = null;
let projectStateProvider: (() => ProjectState) | null = null;

ipcRenderer.on('workspace-edit-state:request', (_event: IpcRendererEvent, requestId: string) => {
  ipcRenderer.send('workspace-edit-state:response', {
    requestId,
    state: editStateProvider?.() ?? emptyEditState,
  });
});

ipcRenderer.on('project-state:request', (_event: IpcRendererEvent, requestId: string) => {
  ipcRenderer.send('project-state:response', {
    requestId,
    state: projectStateProvider?.() ?? { hasOpenProject: false, hasUnsavedChanges: false },
  });
});

export type LibraryImageMeta = { name: string; path: string; isAi: boolean; svg: string };
export type SpotifyCodeMeta = { name: string; path: string; svg: string; uri: string | null };
type RasterTraceOptions = {
  threshold: number;
  detail: number;
  invert: boolean;
};

// Isolated-world listener: renderer code cannot synthesize isTrusted or invoke this private channel.
installNativeIntentCapture(window, (action) =>
  ipcRenderer.send('native-joy:trusted-click', action),
);

const desktopApi = {
  cutterBackend: {
    get: (): Promise<'auto' | 'native' | 'slicebug'> => ipcRenderer.invoke('cutter:get-backend'),
    set: (value: 'auto' | 'native' | 'slicebug'): Promise<'auto' | 'native' | 'slicebug'> =>
      ipcRenderer.invoke('cutter:set-backend', value),
  },
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version ?? '1.0.0',
  },
  onAppAction: (callback: (payload: AppActionPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: AppActionPayload) => callback(payload);
    ipcRenderer.on('app:action', listener);
    return () => ipcRenderer.removeListener('app:action', listener);
  },
  showWorkspaceContextMenu: (): Promise<void> => ipcRenderer.invoke('workspace:show-context-menu'),
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
    save: (input: ProjectSaveInput): Promise<ProjectFileResult> =>
      ipcRenderer.invoke('project:save', input),
    open: (): Promise<ProjectFileResult> => ipcRenderer.invoke('project:open'),
    openPath: (filePath: string): Promise<ProjectFileResult> =>
      ipcRenderer.invoke('project:open-path', filePath),
  },
  projectState: {
    setProvider: (provider: (() => ProjectState) | null): (() => void) => {
      projectStateProvider = provider;
      return () => {
        if (projectStateProvider === provider) {
          projectStateProvider = null;
        }
      };
    },
  },
  appWindow: {
    closeConfirmed: (): Promise<void> => ipcRenderer.invoke('app:close-confirmed'),
  },
  updater: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('updater:get-state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('updater:check'),
    download: (input?: { background?: boolean }): Promise<UpdateState> =>
      ipcRenderer.invoke('updater:download', input),
    install: (): Promise<UpdateState> => ipcRenderer.invoke('updater:install'),
    dismiss: (): Promise<UpdateState> => ipcRenderer.invoke('updater:dismiss'),
    skip: (): Promise<UpdateState> => ipcRenderer.invoke('updater:skip'),
    onState: (callback: (state: UpdateState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: UpdateState) => callback(state);
      ipcRenderer.on('updater:state', listener);
      return () => ipcRenderer.removeListener('updater:state', listener);
    },
  },
  imageLibrary: {
    list: (): Promise<LibraryImageMeta[]> => ipcRenderer.invoke('library:list'),
    save: (input: { name: string; svg: string; isAi: boolean }): Promise<string> =>
      ipcRenderer.invoke('library:save', input),
    rename: (input: { filePath: string; name: string }): Promise<LibraryImageMeta> =>
      ipcRenderer.invoke('library:rename', input),
    delete: (filePath: string): Promise<void> => ipcRenderer.invoke('library:delete', filePath),
  },
  spotify: {
    search: (query: string): Promise<SpotifyLookupResult<SpotifySearchResult[]>> =>
      ipcRenderer.invoke('spotify:search', query),
    list: (): Promise<SpotifyCodeMeta[]> => ipcRenderer.invoke('spotify:list'),
    create: (request: SpotifyCodeRequest): Promise<SpotifyLookupResult<SpotifyCodeMeta>> =>
      ipcRenderer.invoke('spotify:create', request),
    delete: (filePath: string): Promise<void> => ipcRenderer.invoke('spotify:delete', filePath),
  },
  image: {
    traceRasterToSvg: (input: {
      base64: string;
      fileName?: string;
      mimeType?: string;
      traceOptions?: RasterTraceOptions;
    }): Promise<string> => ipcRenderer.invoke('image:trace-raster-to-svg', input),
  },
  system: {
    getFonts: (): Promise<string[]> => ipcRenderer.invoke('system:fonts'),
  },
  ai: {
    dalleGeneratePng: (input: {
      prompt: string;
      complexity: number;
      language: string;
      apiKey: string;
      imageModel: string;
    }): Promise<string> => ipcRenderer.invoke('ai:dalle-generate-png', input),
    tracePngToSvg: (pngBase64: string): Promise<string> =>
      ipcRenderer.invoke('ai:trace-png-to-svg', pngBase64),
  },
  nativeJoy: {
    jobRecoveryInfo: (): Promise<
      import('./native-joy-job-recovery').NativeJobRecoveryInfo | null
    > => ipcRenderer.invoke('native-joy:job-recovery-info'),
    jobPrepare: (input: {
      profileId: string;
      calibrationId: string;
      source: import('./native-joy-configuration-types').NativeConfigurationSource;
    }): Promise<import('./native-joy-job-types').NativeJobMetadata & { jobId: string }> =>
      ipcRenderer.invoke('native-joy:job-prepare', input),
    jobStart: (input: {
      jobId: string;
      source: import('./native-joy-configuration-types').NativeConfigurationSource;
    }): Promise<import('./native-joy-job-types').NativeJobState | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:job-start', input),
    jobPrepareAutomatic: (
      source: import('./native-joy-configuration-types').NativeConfigurationSource,
    ): Promise<import('./native-joy-job-types').NativeJobMetadata & { jobId: string }> =>
      ipcRenderer.invoke('native-joy:job-prepare-auto', { source }),
    jobArmNext: (input: {
      jobId: string;
      source: import('./native-joy-configuration-types').NativeConfigurationSource;
    }): Promise<import('./native-joy-job-types').NativeJobState> =>
      ipcRenderer.invoke('native-joy:job-arm-next', input),
    jobStatus: (): Promise<
      import('./native-joy-job-types').NativeJobState & { historical?: true }
    > => ipcRenderer.invoke('native-joy:job-status'),
    jobGo: (): Promise<import('./native-joy-job-types').NativeJobState | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:job-go'),
    jobEnd: (): Promise<import('./native-joy-job-types').NativeJobState | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:job-end'),
    jobPause: (): Promise<import('./native-joy-job-types').NativeJobState> =>
      ipcRenderer.invoke('native-joy:job-pause'),
    jobResume: (): Promise<import('./native-joy-job-types').NativeJobState | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:job-resume'),
    jobCancel: (): Promise<import('./native-joy-job-types').NativeJobState> =>
      ipcRenderer.invoke('native-joy:job-cancel'),
    jobInvalidate: (): Promise<unknown> => ipcRenderer.invoke('native-joy:job-invalidate'),
    exportJobDiagnostics: (): Promise<{ canceled: boolean }> =>
      ipcRenderer.invoke('native-joy:job-export'),
    configurationAdopt: (input: {
      catalogId: string;
      materialId: number;
      materialName: string;
      confirmed: true;
    }): Promise<import('./native-joy-configuration-types').NativeConfigurationCatalog> =>
      ipcRenderer.invoke('native-joy:configuration-adopt', input),
    configurationList: (): Promise<
      import('./native-joy-configuration-types').NativeConfigurationCatalog
    > => ipcRenderer.invoke('native-joy:configuration-list'),
    configurationImport: (): Promise<
      import('./native-joy-configuration-types').NativeConfigurationCatalog | { canceled: true }
    > => ipcRenderer.invoke('native-joy:configuration-import'),
    configurationExport: (): Promise<{ canceled: boolean }> =>
      ipcRenderer.invoke('native-joy:configuration-export'),
    configurationSelect: (input: {
      profileId: string;
      calibrationId: string;
    }): Promise<import('./native-joy-configuration-types').NativeConfigurationCatalog> =>
      ipcRenderer.invoke('native-joy:configuration-select', input),
    configurationCapture: (): Promise<
      import('./native-joy-configuration-types').NativeConfigurationCatalog | { canceled: true }
    > => ipcRenderer.invoke('native-joy:configuration-capture'),
    configurationUpdate: (input: {
      profileId: string;
      pressureRequest: number;
    }): Promise<import('./native-joy-configuration-types').NativeConfigurationCatalog> =>
      ipcRenderer.invoke('native-joy:configuration-update', input),
    configurationCompile: (input: {
      profileId: string;
      calibrationId: string;
      source: import('./native-joy-configuration-types').NativeConfigurationSource;
    }): Promise<import('./native-joy-configuration-types').NativeConfigurationCompileResult> =>
      ipcRenderer.invoke('native-joy:configuration-compile', input),
    exportLoadingDiagnostics: (): Promise<{ canceled: boolean }> =>
      ipcRenderer.invoke('native-joy:loading-diagnostics-export'),
    loadingStart: (heightInches: 6.5 | 12): Promise<NativeJoyLoadingState | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:loading-start', { heightInches }),
    loadingStatus: (): Promise<NativeJoyLoadingState> =>
      ipcRenderer.invoke('native-joy:loading-status'),
    loadingGo: (): Promise<NativeJoyLoadingState> => ipcRenderer.invoke('native-joy:loading-go'),
    loadingCancel: (): Promise<NativeJoyLoadingState> =>
      ipcRenderer.invoke('native-joy:loading-cancel'),
    devices: (): Promise<
      Array<{ name: string; id: string; paired: boolean; connected: boolean }>
    > => ipcRenderer.invoke('native-joy:devices'),
    mat: (
      action: 'load' | 'unload',
    ): Promise<
      | { requestAcknowledged: boolean; matPresenceVerified: false; responseCode?: number }
      | { canceled: true }
    > => ipcRenderer.invoke('native-joy:mat', { action }),
    getSetupStatus: (): Promise<NativeJoySetup> => ipcRenderer.invoke('native-joy:get-status'),
    importProvisioning: (): Promise<{ recordCount: number } | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:import'),
    connect: (address: string): Promise<NativeJoySnapshot | { canceled: true }> =>
      ipcRenderer.invoke('native-joy:connect', { address }),
    cancelMakeConnection: (): Promise<{ canceled: boolean }> =>
      ipcRenderer.invoke('native-joy:cancel-make-connection'),
    connectForMake: (
      address?: string,
    ): Promise<
      | {
          status: 'connected';
          devices: Array<{ name: string; id: string; paired: boolean; connected: boolean }>;
        }
      | { status: 'not_found'; devices: [] }
      | {
          status: 'choose_device';
          devices: Array<{ name: string; id: string; paired: boolean; connected: boolean }>;
        }
      | { canceled: true }
    > =>
      ipcRenderer.invoke(
        'native-joy:connect-for-make',
        address === undefined ? undefined : { address },
      ),
    pollStatus: (): Promise<NativeJoySnapshot> => ipcRenderer.invoke('native-joy:poll-status'),
    disconnect: (): Promise<{ state: 'disconnected' }> =>
      ipcRenderer.invoke('native-joy:disconnect'),
  },
  slicebug: {
    getStatus: (): Promise<SlicebugStatus> => ipcRenderer.invoke('slicebug:get-status'),
    getSetupStatus: (): Promise<SlicebugSetupStatus> =>
      ipcRenderer.invoke('slicebug:get-setup-status'),
    bootstrap: (input?: SlicebugBootstrapInput): Promise<SlicebugBootstrapResult> =>
      ipcRenderer.invoke('slicebug:bootstrap', input),
    generateSamplePlan: (choices?: {
      materialId?: number;
      matPreset?: string;
    }): Promise<SlicebugPlanResult> => ipcRenderer.invoke('slicebug:generate-sample-plan', choices),
    createPlan: (input: SvgPlanInput): Promise<SlicebugPlanResult> =>
      ipcRenderer.invoke('slicebug:create-plan', input),
    startCutSession: (planPath: string): Promise<CutSessionSnapshot> =>
      ipcRenderer.invoke('slicebug:start-cut-session', planPath),
    getCutSession: (): Promise<CutSessionSnapshot | null> =>
      ipcRenderer.invoke('slicebug:get-cut-session'),
    continueCutSession: (): Promise<CutSessionSnapshot | null> =>
      ipcRenderer.invoke('slicebug:continue-cut-session'),
    stopCutSession: (): Promise<CutSessionSnapshot | null> =>
      ipcRenderer.invoke('slicebug:stop-cut-session'),
  },
};

contextBridge.exposeInMainWorld('cricutCompanion', desktopApi);

export type CricutCompanionDesktopApi = typeof desktopApi;
export type {
  CutSessionSnapshot,
  SlicebugBootstrapInput,
  SlicebugBootstrapResult,
  SlicebugPlanResult,
  SlicebugSetupStatus,
  SlicebugStatus,
  SvgPlanInput,
};
