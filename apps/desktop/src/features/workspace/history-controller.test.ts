import { describe, expect, it } from 'vitest';
import {
  emptyWorkspaceHistory,
  recordWorkspaceEdit,
  travelWorkspaceHistory,
} from './history-controller';

type Snapshot = { importedSvgs: never[]; selectedSvgId: string | null; selectedSvgIds: string[] };
const snapshot = (id: string | null): Snapshot => ({
  importedSvgs: [],
  selectedSvgId: id,
  selectedSvgIds: id ? [id] : [],
});

describe('workspace history controller', () => {
  it('records edits, clears redo, and restores selections across undo/redo', () => {
    const first = snapshot('first');
    const second = snapshot('second');
    const recorded = recordWorkspaceEdit(
      { ...emptyWorkspaceHistory(), future: [snapshot('stale')] },
      first,
    );
    expect(recorded.future).toEqual([]);
    const undo = travelWorkspaceHistory(recorded, second, 'undo');
    expect(undo.snapshot?.selectedSvgId).toBe('first');
    const redo = travelWorkspaceHistory(undo.history, first, 'redo');
    expect(redo.snapshot?.selectedSvgId).toBe('second');
  });

  it('returns null without changing empty history', () => {
    const history = emptyWorkspaceHistory();
    expect(travelWorkspaceHistory(history, snapshot(null), 'undo')).toEqual({
      history,
      snapshot: null,
    });
    expect(travelWorkspaceHistory(history, snapshot(null), 'redo')).toEqual({
      history,
      snapshot: null,
    });
  });
});
