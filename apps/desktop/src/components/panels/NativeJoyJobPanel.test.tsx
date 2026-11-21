import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeJoyJobView } from './NativeJoyJobPanel';
import { initialJobPanel, type JobPanelState } from './native-joy-job-controller';
function html(s: JobPanelState) {
  return renderToStaticMarkup(
    <NativeJoyJobView state={s} setup={null} available={true} onAction={() => {}} />,
  );
}
describe('pen job safety view', () => {
  it('distinguishes native pen trials from cutting and offers no automatic action', () => {
    const text = html(initialJobPanel());
    expect(text).toContain('Prepare current tool plan');
    expect(text).toContain('Blade execution supports');
    expect(text).not.toContain('Job details &amp; diagnostics');
    const advanced = renderToStaticMarkup(
      <NativeJoyJobView
        compact
        showAdvancedInfo
        state={initialJobPanel()}
        setup={null}
        available
        onAction={() => {}}
      />,
    );
    expect(advanced).toContain('Job details &amp; diagnostics');
  });
  it('gives insertion guidance only at the live sensor cue', () => {
    const s = initialJobPanel();
    s.job = {
      operationId: 1,
      phase: 'waiting_for_mat',
      active: true,
      sessionRetired: false,
      jobStarted: false,
      programDigest: 'a'.repeat(64),
      tool: 'pen',
      acceptedRecords: 0,
      completedPasses: 0,
      totalRecords: 9,
      totalPasses: 1,
      physicalCompletionVerified: false,
      motionStoppedVerified: false,
    };
    expect(html(s)).toContain('Insert the mat now');
    s.job.phase = 'waiting_for_go';
    expect(html(s)).not.toContain('Insert the mat now');
    expect(html(s)).toContain('Confirm pen and start drawing');
    expect(html(s)).toContain('Cancel job');
  });
  it('never offers Go/cancel for restored history', () => {
    const s = initialJobPanel();
    s.job = {
      operationId: 1,
      phase: 'completed',
      active: false,
      sessionRetired: true,
      jobStarted: true,
      programDigest: 'a'.repeat(64),
      tool: 'pen',
      acceptedRecords: 9,
      completedPasses: 1,
      totalRecords: 9,
      totalPasses: 1,
      physicalCompletionVerified: false,
      motionStoppedVerified: false,
      historical: true,
    };
    const out = html(s);
    expect(out).toContain('Previous job');
    expect(out).not.toContain('Confirm pen and start drawing');
    expect(out).not.toContain('>Cancel job<');
  });
});

it('shows unknown machine state after interrupted history, never a resumable checkpoint', () => {
  const s = initialJobPanel();
  s.recovery = {
    status: 'interrupted',
    reportId: '11111111-1111-4111-8111-111111111111',
    operationId: 1,
    lastKnownPhase: 'sending',
    jobStarted: true,
    acceptedRecords: 3,
    completedPasses: 0,
    totalRecords: 9,
    totalPasses: 1,
    captureComplete: false,
    machineState: 'unknown',
    canResume: false,
    requiresFreshApproval: true,
  };
  const out = html(s);
  expect(out).toContain('Previous job interrupted');
  expect(out).toContain('Machine state is unknown');
  expect(out).toContain('never resumed or replayed automatically');
  expect(out).not.toContain('>Resume');
});

it('offers protocol-only queue controls with explicit buffered-motion, contact and deadline warnings', () => {
  const s = initialJobPanel();
  s.job = {
    operationId: 1,
    phase: 'sending',
    active: true,
    sessionRetired: false,
    jobStarted: true,
    programDigest: 'a'.repeat(64),
    tool: 'pen',
    acceptedRecords: 2,
    completedPasses: 0,
    totalRecords: 9,
    totalPasses: 1,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
  };
  expect(html(s)).toContain('Pause queue');
  s.job.phase = 'paused';
  const out = html(s);
  expect(out).toContain('Resume same pen program');
  expect(out).toContain('pen may remain in contact');
  expect(out).toContain('deadline continues');
  expect(out).toContain('not proof of stopped motion');
});

it('allows the matching pen to remain installed during explicitly approved pen-only loading without claiming clearance', () => {
  const text = html(initialJobPanel());
  expect(text).toContain('matching pen may remain installed');
  expect(text).toContain('No blade');
  expect(text).toContain('could mark the paper');
  expect(text).not.toContain('entire housing removed');
});

it('shows a completed action on a retained mat with next-action and explicit End, not automatic reload', () => {
  const s = initialJobPanel();
  s.job = {
    operationId: 1,
    phase: 'retained_ready' as any,
    active: true,
    sessionRetired: false,
    jobStarted: true,
    programDigest: 'a'.repeat(64),
    tool: 'pen',
    acceptedRecords: 9,
    completedPasses: 1,
    totalRecords: 9,
    totalPasses: 1,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
  };
  const out = html(s);
  expect(out).toContain('Pen action protocol completed');
  expect(out).toContain('Prepare next pen action');
  expect(out).toContain('Arm next pen action');
  expect(out).toContain('Unload mat');
  expect(out).not.toContain('>Cancel job<');
  expect(out).not.toContain('Load and align for prepared pen trial');
});
it('distinguishes completed drawing protocol from a failed cleanup instead of calling the drawing failed', () => {
  const s = initialJobPanel();
  s.job = {
    operationId: 1,
    phase: 'failed',
    active: false,
    sessionRetired: true,
    jobStarted: true,
    programDigest: 'a'.repeat(64),
    tool: 'pen',
    acceptedRecords: 9,
    completedPasses: 1,
    totalRecords: 9,
    totalPasses: 1,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
    diagnostics: {
      version: 1,
      operationId: 1,
      lastStage: 'disarming',
      failure: { stage: 'disarming', code: 'cleanup_failed', errorType: 'TimeoutError' },
      events: [],
      totalEvents: 0,
      evictedEvents: 0,
      captureIncomplete: false,
    },
  };
  const out = html(s);
  expect(out).toContain('Drawing protocol completed; session cleanup failed');
  expect(out).toContain('Do not repeat the drawing automatically');
  expect(out).not.toContain('Job stage: failed');
});

it('does not call a completed pen action interrupted when only its retained owner was lost', () => {
  const s = initialJobPanel();
  s.recovery = {
    status: 'interrupted',
    reportId: '11111111-1111-4111-8111-111111111111',
    operationId: 1,
    lastKnownPhase: 'retained_ready',
    jobStarted: true,
    acceptedRecords: 9,
    completedPasses: 1,
    totalRecords: 9,
    totalPasses: 1,
    captureComplete: true,
    machineState: 'unknown',
    canResume: false,
    requiresFreshApproval: true,
  };
  const out = html(s);
  expect(out).toContain('Previous loaded-mat session lost its live owner');
  expect(out).toContain('Last pen action reached protocol completion');
  expect(out).not.toContain('Previous job interrupted');
  expect(out).not.toContain('>Resume');
});

it('shows general blade preview and blade-only Go without pen-only or queue-pause promises', () => {
  const s = initialJobPanel();
  s.preview = {
    jobId: '11111111-1111-4111-8111-111111111111',
    programDigest: 'a'.repeat(64),
    tool: 'fine_point_blade',
    operation: 'cut',
    materialId: 211,
    passCount: 3,
    recordCount: 18,
    pressureRequests: [223, 223, 223],
    heightInches: 12,
    physicalCalibrationVerified: false,
  };
  s.job = {
    operationId: 1,
    phase: 'waiting_for_go',
    active: true,
    sessionRetired: false,
    jobStarted: false,
    programDigest: 'a'.repeat(64),
    tool: 'fine_point_blade',
    acceptedRecords: 0,
    completedPasses: 0,
    totalRecords: 18,
    totalPasses: 3,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
  };
  const out = html(s);
  expect(out).toContain('saved material recipe');
  expect(out).toContain('Confirm blade and start cutting');
  expect(out).toContain('removed');
  expect(out).not.toContain('Never install a blade');
  s.job.phase = 'sending';
  s.job.jobStarted = true;
  expect(html(s)).not.toContain('>Pause queue');
  s.job.phase = 'retained_ready';
  s.job.acceptedRecords = 18;
  s.job.completedPasses = 3;
  const held = html(s);
  expect(held).toContain('Unload mat');
  expect(held).not.toContain('>Prepare next pen action');
});
