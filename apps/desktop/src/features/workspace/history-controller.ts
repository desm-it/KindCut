import type { WorkspaceSvgItem } from '../../workspace-objects';

export type WorkspaceHistorySnapshot = {
  importedSvgs: WorkspaceSvgItem[];
  selectedSvgId: string | null;
  selectedSvgIds: string[];
};

export type WorkspaceHistory = {
  past: WorkspaceHistorySnapshot[];
  future: WorkspaceHistorySnapshot[];
};

export const WORKSPACE_HISTORY_LIMIT = 100;
export const emptyWorkspaceHistory = (): WorkspaceHistory => ({ past: [], future: [] });

export function recordWorkspaceEdit(
  history: WorkspaceHistory,
  snapshot: WorkspaceHistorySnapshot,
): WorkspaceHistory {
  return { past: [...history.past, snapshot].slice(-WORKSPACE_HISTORY_LIMIT), future: [] };
}

export function travelWorkspaceHistory(
  history: WorkspaceHistory,
  current: WorkspaceHistorySnapshot,
  direction: 'undo' | 'redo',
): { history: WorkspaceHistory; snapshot: WorkspaceHistorySnapshot | null } {
  if (direction === 'undo') {
    const snapshot = history.past.at(-1) ?? null;
    return snapshot
      ? {
          history: {
            past: history.past.slice(0, -1),
            future: [current, ...history.future].slice(0, WORKSPACE_HISTORY_LIMIT),
          },
          snapshot,
        }
      : { history, snapshot: null };
  }
  const snapshot = history.future[0] ?? null;
  return snapshot
    ? {
        history: {
          past: [...history.past, current].slice(-WORKSPACE_HISTORY_LIMIT),
          future: history.future.slice(1),
        },
        snapshot,
      }
    : { history, snapshot: null };
}
