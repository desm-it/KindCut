import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeJoyJobView } from './NativeJoyJobPanel';
import { initialJobPanel } from './native-joy-job-controller';
const view = (state = initialJobPanel(), props: any = {}) =>
  renderToStaticMarkup(
    <NativeJoyJobView
      compact
      seamless
      state={state}
      setup={props.setup ?? null}
      available
      onAction={() => {}}
      {...props}
    />,
  );
const setup = { enabled: true, runtimeAvailable: true, session: {} } as any;
describe('central current make stage', () => {
  it('does not turn disconnected history into unload', () => {
    const s = initialJobPanel();
    s.job = {
      operationId: 1,
      phase: 'completed',
      active: false,
      historical: true,
      sessionRetired: true,
      jobStarted: true,
      programDigest: 'a'.repeat(64),
      tool: 'pen',
      acceptedRecords: 1,
      completedPasses: 1,
      totalRecords: 1,
      totalPasses: 1,
      physicalCompletionVerified: false,
      motionStoppedVerified: false,
    };
    const h = view(s);
    expect(h).toContain('data-stage-kind="bluetooth"');
    expect(h).not.toContain('data-stage-kind="unload"');
  });
  it('shows finding and connection failure advice centrally only', () => {
    expect(view(undefined, { makeConnection: { busy: true } })).toContain(
      'data-stage-kind="bluetooth"',
    );
    const h = view(undefined, {
      makeConnection: { busy: false, notice: 'connect_failed', error: 'raw detail' },
    });
    expect(h).toContain('data-stage-kind="bluetooth-failed"');
    expect(h).toContain('Power-unplug');
    expect(h).not.toContain('raw detail');
    expect(h.match(/role="alert"/g)).toBeNull();
  });
  it('shows preparation refresh and central errors', () => {
    expect(view(undefined, { setup, makeConnection: { busy: true, preparing: true } })).toContain(
      'data-stage-kind="refresh"',
    );
    const h = view(undefined, { setup, makeConnection: { error: 'Could not prepare design' } });
    expect(h).toContain('data-stage-kind="error"');
    expect(h).not.toContain('role="alert"');
  });
  it('shows prepared load, active tool, retained unload and only current-flow done', () => {
    const s = initialJobPanel();
    s.preview = {
      jobId: 'x',
      programDigest: 'a'.repeat(64),
      tool: 'pen',
      operation: 'draw',
      materialId: 1,
      passCount: 1,
      recordCount: 1,
      pressureRequests: [1],
      heightInches: 12,
      physicalCalibrationVerified: false,
    };
    expect(view(s, { setup })).toContain('data-stage-kind="load"');
    s.job = {
      operationId: 1,
      phase: 'sending',
      active: true,
      sessionRetired: false,
      jobStarted: true,
      programDigest: 'a'.repeat(64),
      tool: 'pen',
      acceptedRecords: 0,
      completedPasses: 0,
      totalRecords: 1,
      totalPasses: 1,
      physicalCompletionVerified: false,
      motionStoppedVerified: false,
    };
    expect(view(s, { setup })).toContain('data-stage-kind="pen"');
    s.job.phase = 'retained_ready' as any;
    expect(view(s, { setup })).toContain('data-stage-kind="unload"');
    expect(view(initialJobPanel(), { makeConnection: { busy: false, finished: true } })).toContain(
      'data-stage-kind="done"',
    );
  });
  it('keeps cancel and progress, removes green instructions', () => {
    const s = initialJobPanel();
    s.job = {
      operationId: 1,
      phase: 'sending',
      active: true,
      sessionRetired: false,
      jobStarted: true,
      programDigest: 'a'.repeat(64),
      tool: 'pen',
      acceptedRecords: 1,
      completedPasses: 0,
      totalRecords: 4,
      totalPasses: 1,
      physicalCompletionVerified: false,
      motionStoppedVerified: false,
    };
    const h = view(s, { setup });
    expect(h).toContain('Cancel job');
    expect(h).toContain('Tool progress');
    expect(h).not.toContain('native-make__instruction');
    expect(h).not.toContain('native-make__ready');
  });
});

it('localizes central statuses and distinguishes disconnected from busy finding', () => {
  expect(view(undefined, { language: 'nl', makeConnection: { busy: true } })).toContain(
    'Cricut zoeken',
  );
  expect(view(undefined, { makeConnection: { busy: false } })).toContain('Not connected');
});
it('keeps the load presentation to a mat and its short label, using the selected card mat', () => {
  const s = initialJobPanel();
  s.preview = { tool: 'pen' } as any;
  const h = view(s, { setup, matVariant: 'card' });
  expect(h).toContain('mat-icon--card');
  expect(h).not.toContain('Your design is prepared');
  expect(h).not.toContain('deliberate tool confirmation');
});
it('shows a current retired failure centrally instead of pretending to search', () => {
  const s = initialJobPanel();
  s.job = { phase: 'failed', active: false, historical: false } as any;
  expect(view(s, { makeConnection: { busy: false } })).toContain('data-stage-kind="error"');
});
it('shows the next frozen tool rather than unload between actions', () => {
  const s = initialJobPanel();
  s.job = {
    phase: 'retained_ready',
    active: true,
    tool: 'pen',
    workflow: {
      actionIndex: 0,
      actionCount: 2,
      actions: [{ tool: 'pen', color: '#000000' }, { tool: 'fine_point_blade' }],
    },
  } as any;
  expect(view(s, { setup, makeConnection: { busy: false } })).toContain('data-stage-kind="cut"');
});

it('does not mistake a pending design error for a Bluetooth failure or interrupt finding', () => {
  expect(
    view(undefined, { makeConnection: { busy: true, error: 'Unsupported design' } }),
  ).toContain('data-stage-kind="bluetooth"');
  expect(
    view(undefined, { makeConnection: { busy: false, error: 'Unsupported design' } }),
  ).toContain('data-stage-kind="bluetooth"');
});
it('keeps raw IPC exceptions behind advanced information', () => {
  const props = {
    setup,
    makeConnection: {
      busy: false,
      error: 'Error invoking remote method native-joy:job-prepare-auto',
    },
  };
  expect(view(undefined, props)).not.toContain('Error invoking remote method');
  expect(view(undefined, { ...props, showAdvancedInfo: true })).toContain(
    'Error invoking remote method',
  );
});

it('labels restored advanced diagnostics as previous history while keeping the central stage current', () => {
  const s = initialJobPanel();
  s.job = {
    phase: 'completed',
    active: false,
    historical: true,
    acceptedRecords: 20,
    totalRecords: 20,
    completedPasses: 3,
    totalPasses: 3,
  } as any;
  const h = view(s, { showAdvancedInfo: true, makeConnection: { busy: true } });
  expect(h).toContain('Previous job: completed');
  expect(h).toContain('data-stage-kind="bluetooth"');
  expect(h).not.toContain('data-stage-kind="unload"');
  expect(h).not.toContain('data-stage-kind="done"');
  expect(h).not.toContain('native-make__progress');
});
