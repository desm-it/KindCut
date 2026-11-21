import { it, expect } from 'vitest';
import { nativeMakePreviewFocus } from './native-make-preview-focus';
import type { NativeJobState } from '../../shell/native-joy-job-types';
const job = (phase: string, index = 0, active = true, historical = false) =>
  ({
    phase,
    active,
    historical,
    workflow: { actionIndex: index, actionCount: 3 },
  }) as unknown as NativeJobState & { historical?: boolean };
it('hover temporarily takes precedence over the live tool', () =>
  expect(nativeMakePreviewFocus(job('sending', 1), 0, 3)).toBe(0));
it('hover leave restores live tool focus, not an old clicked selection', () =>
  expect(nativeMakePreviewFocus(job('waiting_for_go', 1), null, 3)).toBe(1));
it('loading and unloading show all paths', () => {
  expect(nativeMakePreviewFocus(job('waiting_for_mat'), null, 3)).toBeNull();
  expect(nativeMakePreviewFocus(job('retained_ready', 2), null, 3)).toBeNull();
});
it('does not use a restored or inactive report as the current tool', () => {
  expect(nativeMakePreviewFocus(job('sending', 1, false), null, 3)).toBeNull();
  expect(nativeMakePreviewFocus(job('sending', 1, true, true), null, 3)).toBeNull();
});
it('invalid hover falls back to actual active tool', () =>
  expect(nativeMakePreviewFocus(job('sending', 1), 9, 3)).toBe(1));
