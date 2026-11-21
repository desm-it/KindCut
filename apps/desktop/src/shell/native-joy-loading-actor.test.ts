import { describe, it, expect } from 'vitest';
import { NativeJoyLoadingActor } from './native-joy-loading-actor';

describe('NativeJoyLoadingActor', () => {
  it('accepts only monotonic operation transitions and commits after validation', () => {
    const actor = new NativeJoyLoadingActor();
    const state = (phase: 'loading_and_aligning' | 'waiting_for_mat' | 'gripped') => ({
      operationId: 1,
      phase,
      active: true,
      sessionRetired: false,
      physicalLoadingVerified: false,
      physicalAlignmentVerified: false,
      motionStoppedVerified: false,
      jobStarted: false,
    });
    expect(actor.accept(state('loading_and_aligning'), true, {})).toMatchObject({
      phase: 'loading_and_aligning',
    });
    expect(() => actor.accept(state('gripped'), false, {})).not.toThrow();
    expect(actor.state.phase).toBe('gripped');
    expect(() => actor.accept(state('waiting_for_mat'), false, {})).toThrow(/regressed/i);
    expect(actor.state.phase).toBe('gripped');
  });
  it('requires explicit host authorization for terminal completion and cancellation', () => {
    const actor = new NativeJoyLoadingActor();
    const terminal = (phase: 'completed' | 'cancelled') => ({
      operationId: 1,
      phase,
      active: false,
      sessionRetired: true,
      physicalLoadingVerified: false,
      physicalAlignmentVerified: false,
      motionStoppedVerified: false,
      jobStarted: false,
    });
    expect(() => actor.accept(terminal('completed'), false, {})).toThrow();
    expect(() => actor.accept(terminal('cancelled'), false, {})).toThrow();
  });
});
