import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeJoyJobView } from './NativeJoyJobPanel';
import { initialJobPanel } from './native-joy-job-controller';
const workflow = {
  actionIndex: 0,
  actionCount: 2,
  containsBlade: true,
  actions: [
    {
      tool: 'pen' as const,
      profileId: 'p',
      profileName: 'Saved pen',
      passCount: 1,
      pressureRequests: [100],
    },
    {
      tool: 'fine_point_blade' as const,
      profileId: 'b',
      profileName: 'Saved blade',
      passCount: 3,
      pressureRequests: [223, 223, 223],
    },
  ],
};
const job = {
  operationId: 1,
  phase: 'retained_ready' as const,
  active: true,
  sessionRetired: false,
  jobStarted: true,
  programDigest: 'a'.repeat(64),
  tool: 'pen' as const,
  acceptedRecords: 9,
  completedPasses: 1,
  totalRecords: 9,
  totalPasses: 1,
  physicalCompletionVerified: false as const,
  motionStoppedVerified: false as const,
  returnToOrigin: 'protocol_complete' as const,
  workflow,
};
const render = (state: any) =>
  renderToStaticMarkup(
    <NativeJoyJobView
      available={true}
      setup={{ enabled: true, runtimeAvailable: true, session: {} } as any}
      state={state}
      onAction={() => {}}
    />,
  );
it('shows frozen tool recipes and next blade only after pen return without suggesting redrawing', () => {
  const html = render({ ...initialJobPanel(), job });
  expect(html).toContain('Frozen tool actions');
  expect(html).toContain('Saved pen');
  expect(html).toContain('Saved blade');
  expect(html).toContain('Prepare next tool');
  expect(html).not.toContain('exclude previously drawn paths');
  expect(html).toContain('Unload mat');
});
it('keeps next-blade arming available while the current completed tool is still pen', () => {
  const preview = {
    jobId: 'next',
    programDigest: 'b'.repeat(64),
    tool: 'fine_point_blade',
    operation: 'cut',
    materialId: 211,
    heightInches: 12,
    passCount: 3,
    recordCount: 111,
    pressureRequests: [223, 223, 223],
    physicalCalibrationVerified: false,
    workflow: { ...workflow, actionIndex: 1 },
  };
  const html = render({ ...initialJobPanel(), job, preview });
  expect(html).toContain('Arm next tool');
  expect(html).not.toContain('Arm next pen');
});
it('does not report finished tool while non-drawing return is still running', () => {
  const html = render({
    ...initialJobPanel(),
    job: { ...job, phase: 'returning_to_origin', returnToOrigin: 'running' },
  });
  expect(html).toContain('Returning without drawing to job origin (0,0)');
  expect(html).not.toContain('Prepare next tool');
  expect(html).not.toContain('action protocol completed');
});

it('compact Make keeps actual ready Go separate from preview and hides engineering instructions', () => {
  const html = renderToStaticMarkup(
    <NativeJoyJobView
      compact
      state={{
        ...initialJobPanel(),
        job: { ...job, phase: 'waiting_for_go', jobStarted: false, returnToOrigin: 'pending' },
      }}
      setup={{ enabled: true, runtimeAvailable: true, session: {} } as any}
      available={true}
      onAction={() => {}}
    />,
  );
  expect(html).toContain('Start drawing');
  expect(html).not.toContain('Standalone source-backed sender');
  expect(html).not.toContain('Load mat and align');
  expect(html).not.toContain('native-make__ready');
  expect(html).toContain('data-native-intent="job-go"');
});
it('compact Make keeps explicit next preparation and unload, never reuses Go', () => {
  const html = renderToStaticMarkup(
    <NativeJoyJobView
      compact
      state={{ ...initialJobPanel(), job }}
      setup={{ enabled: true, runtimeAvailable: true, session: {} } as any}
      available={true}
      onAction={() => {}}
    />,
  );
  expect(html).toContain('Prepare next tool');
  expect(html).toContain('Unload mat');
  expect(html).not.toContain('Start drawing');
});
