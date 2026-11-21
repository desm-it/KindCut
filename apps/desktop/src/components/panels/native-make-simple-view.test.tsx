import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeJoyJobView } from './NativeJoyJobPanel';
import { initialJobPanel } from './native-joy-job-controller';
const preview = {
  jobId: 'id',
  programDigest: 'a'.repeat(64),
  tool: 'fine_point_blade' as const,
  operation: 'cut' as const,
  materialId: 211,
  passCount: 3,
  recordCount: 18,
  pressureRequests: [223, 223, 223],
  heightInches: 12 as const,
  physicalCalibrationVerified: false as const,
};
const state = (phase: string, tool: 'pen' | 'fine_point_blade' = 'pen') =>
  ({
    operationId: 1,
    phase,
    tool,
    active: true,
    sessionRetired: false,
    jobStarted: phase === 'retained_ready',
    programDigest: 'a'.repeat(64),
    acceptedRecords: 0,
    completedPasses: 0,
    totalRecords: 18,
    totalPasses: 3,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
  }) as any;
function view(s: any) {
  return renderToStaticMarkup(
    <NativeJoyJobView
      compact
      state={s}
      setup={{ enabled: true, runtimeAvailable: true, session: {} } as any}
      available
      onAction={() => {}}
    />,
  );
}
it.each(['prepared', 'ready', 'next-prepared'])(
  'has exactly one primary action for %s',
  (phase) => {
    const s = initialJobPanel();
    s.preview = preview;
    if (phase === 'ready') s.job = state('waiting_for_go', 'fine_point_blade');
    if (phase === 'next-prepared') s.job = state('retained_ready');
    const h = view(s);
    expect(h.match(/cut-modal__btn--primary/g)).toHaveLength(1);
  },
);
it('keeps compact loading to the current mat icon and label, without a green instruction box', () => {
  const s = initialJobPanel();
  s.preview = preview;
  expect(view(s)).not.toContain('native-make__instruction');
  expect(view(s)).not.toContain('Load with an empty clamp');
  expect(view(s)).toContain('Load mat');
});
it('provides a friendly visible progress path without raw engineering counts', () => {
  const s = initialJobPanel();
  s.job = state('sending', 'fine_point_blade');
  s.job!.jobStarted = true;
  const h = view(s);
  expect(h).toContain('native-make-stage');
  expect(h).toContain('Tool progress');
  expect(h).not.toContain('native pressure');
  expect(h).not.toContain('Job details');
});
