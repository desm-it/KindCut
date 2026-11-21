import { NativeJoyService } from './native-joy-service';
import { it, expect } from 'vitest';
import { readJobState } from './native-joy-job-types';
import { readLoadingDiagnostics } from './native-joy-loading-diagnostics';
function diagnostic(n: number) {
  return {
    version: 1,
    operationId: 1,
    lastStage: 'sending',
    failure: null,
    events: Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      atMs: i,
      startedMs: null,
      kind: 'exchange',
      stage: 'sending',
      txHex: '000173',
      rxHex: null,
      code: null,
    })),
    totalEvents: n,
    evictedEvents: 0,
    captureIncomplete: false,
  };
}
function state(n: number) {
  return {
    operationId: 1,
    phase: 'sending',
    active: true,
    sessionRetired: false,
    jobStarted: true,
    programDigest: 'a'.repeat(64),
    tool: 'fine_point_blade',
    acceptedRecords: 1,
    completedPasses: 0,
    totalRecords: 100,
    totalPasses: 3,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
    diagnostics: diagnostic(n),
  };
}
it('accepts a bounded object-major job burst without widening standalone loading', () => {
  expect(readJobState(state(700)).diagnostics!.events).toHaveLength(700);
  expect(() => readLoadingDiagnostics(diagnostic(700), 1)).toThrow();
});
it('still rejects job diagnostic windows above 1024 events', () => {
  expect(() => readJobState(state(1025))).toThrow();
});
it('job state copies preserve the larger job window without calling hardware', () => {
  const s = new NativeJoyService({
    platform: 'darwin',
    enabled: true,
    runtimePath: '/not-a-runtime',
    store: {
      exists: async () => false,
      load: async () => {
        throw Error('no secrets');
      },
      save: async () => {
        throw Error('no writes');
      },
    },
  });
  (
    s as unknown as { jobActor: { replace: (state: ReturnType<typeof readJobState>) => void } }
  ).jobActor.replace(readJobState(state(700)));
  expect(s.getJobState().diagnostics!.events).toHaveLength(700);
  s.dispose();
});
