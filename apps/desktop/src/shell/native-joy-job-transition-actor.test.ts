import { describe, it, expect } from 'vitest';
import { NativeJoyJobActor } from './native-joy-job-actor';
import type { NativeJobState } from './native-joy-job-types';
const state = (
  phase: NativeJobState['phase'],
  patch: Partial<NativeJobState> = {},
): NativeJobState => ({
  operationId: 1,
  phase,
  active: true,
  sessionRetired: false,
  jobStarted: false,
  programDigest: 'a'.repeat(64),
  tool: 'pen',
  acceptedRecords: 0,
  completedPasses: 0,
  totalRecords: 4,
  totalPasses: 1,
  physicalCompletionVerified: false,
  motionStoppedVerified: false,
  ...patch,
});
describe('NativeJoyJobTransitionActor', () => {
  it('rejects unapproved advancement, identity changes and paused progress', () => {
    const actor = new NativeJoyJobActor(),
      g = { go: false, end: false, cancel: false, pause: false, resumePending: false };
    expect(() =>
      actor.validate(state('sending', { jobStarted: true }), state('waiting_for_go'), false, {}, g),
    ).toThrow();
    expect(() =>
      actor.validate(
        state('sending', { jobStarted: true, programDigest: 'b'.repeat(64) }),
        state('sending', { jobStarted: true }),
        false,
        {},
        { ...g, go: true },
      ),
    ).toThrow(/identity or progress/);
    expect(() =>
      actor.validate(
        state('paused', { jobStarted: true, acceptedRecords: 1 }),
        state('paused', { jobStarted: true }),
        false,
        {},
        { ...g, go: true, pause: true },
      ),
    ).toThrow(/Paused job progress/);
  });
});
