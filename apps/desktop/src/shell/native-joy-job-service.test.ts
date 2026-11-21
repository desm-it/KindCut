import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NativeJoyJobService } from './native-joy-job-service';
import { emptyLibrary, type JoyConfigurationLibrary } from './joy-configuration-store';
import type { NativeJobState } from './native-joy-job-types';
const fixture = JSON.parse(
  readFileSync(new URL('../../native-tests/configuration.synthetic.json', import.meta.url), 'utf8'),
);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M50 50 L80 50"/></svg>';
function setup() {
  const lib: JoyConfigurationLibrary = {
    ...emptyLibrary(),
    selection: { profileId: 'p', calibrationId: 'c' },
    profiles: [
      {
        id: 'p',
        name: 'pen',
        provenance: 'test',
        settings: {
          ...fixture.settings,
          profileId: 'p',
          materialId: 1,
          tool: 'pen',
          operation: 'draw',
          mode: 'precision',
          pressureRequest: 180,
        },
      },
    ],
    calibrations: [
      {
        id: 'c',
        capturedAt: '2026-01-01T00:00:00Z',
        deviceFingerprint: 'a'.repeat(64),
        firmwareSelector: 8.164000001,
        source: 'imported_unverified',
        physicalCalibrationVerified: false,
        pressureResponsesHex: fixture.rows,
      },
    ],
  };
  const calls: any[] = [];
  let state: any = {
    operationId: 1,
    phase: 'waiting_for_go',
    active: true,
    sessionRetired: false,
    jobStarted: false,
    programDigest: 'd'.repeat(64),
    tool: 'pen',
    acceptedRecords: 0,
    completedPasses: 0,
    totalRecords: 1,
    totalPasses: 1,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
  };
  const native = {
    runOfflineConfiguration: async (r: any) => {
      calls.push(['offline', r]);
      return {
        programDigest: 'd'.repeat(64),
        tool: 'pen',
        operation: 'draw',
        materialId: 1,
        passCount: 1,
        recordCount: 1,
        pressureRequests: [180],
        heightInches: 12,
        physicalCalibrationVerified: false,
      };
    },
    reserveJobApproval: () => ({ generation: 2, token: 7, deviceFingerprint: 'a'.repeat(64) }),
    releaseJobApproval: () => {},
    startJob: async (r: any) => {
      calls.push(['start', r]);
      return state;
    },
    jobResumeApprovalContext: () => ({ generation: 2, operationId: 1 }),
    jobGoApprovalContext: () => ({ generation: 2, operationId: 1 }),
    controlJob: async (...args: any[]) => {
      calls.push(['control', ...args]);
      return state;
    },
    jobStatus: async () => state,
    getJobState: () => state,
  };
  const opts = {
    pollMs: false as const,
    loadLibrary: async () => structuredClone(lib),
    native,
    legacyBusy: () => false,
    confirmLoad: async () => true,
    confirmTool: async () => true,
    confirmResume: async () => true,
    journal: { preflight: async () => {}, observe: async (_state: NativeJobState) => {} },
  };
  return { service: new NativeJoyJobService(opts), calls, lib, native, opts };
}
describe('trusted native Joy jobs', () => {
  it('prepares from the exact selected source, privately freezes start inputs, and returns only a handle plus metadata', async () => {
    const h = setup();
    const result = await h.service.prepare({
      profileId: 'p',
      calibrationId: 'c',
      source: {
        svg,
        materialId: 1,
        mat: { widthIn: 4.5, heightIn: 12 },
        strokeTools: { '#112233': { tool: 'pen', operation: 'draw' } },
      },
    });
    expect(result.jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.tool).toBe('pen');
    expect(JSON.stringify(result)).not.toContain('pressureResponsesHex');
    expect(h.calls[0][1].pressureRequests).toEqual([180]);
  });
  it('rejects blade live admission and renderer approval flags', async () => {
    const h = setup();
    await expect(h.service.start({ jobId: 'x', source: {} })).rejects.toThrow();
    expect(h.calls.filter((x) => x[0] === 'start')).toHaveLength(0);
  });
  it('requires genuine load approval and emits Go only after genuine tool confirmation', async () => {
    const h = setup();
    const prepared = await h.service.prepare({
      profileId: 'p',
      calibrationId: 'c',
      source: {
        svg,
        materialId: 1,
        mat: { widthIn: 4.5, heightIn: 12 },
        strokeTools: { '#112233': { tool: 'pen', operation: 'draw' } },
      },
    });
    await h.service.start({
      jobId: prepared.jobId,
      source: {
        svg,
        materialId: 1,
        mat: { widthIn: 4.5, heightIn: 12 },
        strokeTools: { '#112233': { tool: 'pen', operation: 'draw' } },
      },
    });
    await h.service.go();
    expect(h.calls.some((x) => x[0] === 'control')).toBe(true);
  });
});

const source = () => ({
  svg,
  materialId: 1,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: { '#112233': { tool: 'pen' as const, operation: 'draw' as const } },
});
async function prepared(h: ReturnType<typeof setup>) {
  return h.service.prepare({ profileId: 'p', calibrationId: 'c', source: source() });
}
describe('job authority and lifetime regression cases', () => {
  it('rejects unknown worker fields rather than copying private data to renderer', async () => {
    const h = setup(),
      original = h.native.runOfflineConfiguration;
    h.native.runOfflineConfiguration = async (r) => ({
      ...(await original(r)),
      unexpectedPrivateData: 'DO_NOT_EXPOSE_TEST',
    });
    await expect(prepared(h)).rejects.toThrow();
  });
  it('rechecks library after diagnostic preflight before dispatch', async () => {
    const h = setup(),
      p = await prepared(h);
    h.opts.journal.preflight = async () => {
      h.lib.profiles[0]!.settings.pressureRequest = 181;
    };
    await expect(h.service.start({ jobId: p.jobId, source: source() })).rejects.toThrow();
    expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(0);
  });
  it('does not alias returned pressure arrays into the private job source', async () => {
    const h = setup(),
      p = await prepared(h);
    p.pressureRequests[0] = 7;
    await h.service.start({ jobId: p.jobId, source: source() });
    expect(h.calls.find((c) => c[0] === 'start')![1].pressureRequests).toEqual([180]);
  });
  it('releases a pending Go latch even when the operation is not ready', async () => {
    const h = setup(),
      p = await prepared(h);
    await h.service.start({ jobId: p.jobId, source: source() });
    const original = h.native.jobGoApprovalContext;
    h.native.jobGoApprovalContext = () => {
      throw Error('Not yet ready');
    };
    await expect(h.service.go()).rejects.toThrow();
    h.native.jobGoApprovalContext = original;
    await expect(h.service.go()).resolves.toMatchObject({ phase: 'waiting_for_go' });
  });
  it('host refusal is a cancellation result without dispatch', async () => {
    const h = setup(),
      p = await prepared(h);
    h.opts.confirmLoad = async () => false;
    await expect(h.service.start({ jobId: p.jobId, source: source() })).resolves.toEqual({
      canceled: true,
    });
    expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(0);
  });
  it('changed source or device cannot reach the load confirmation', async () => {
    const h = setup(),
      p = await prepared(h);
    h.opts.confirmLoad = async () => {
      throw Error('Must not ask');
    };
    await expect(
      h.service.start({ jobId: p.jobId, source: { ...source(), svg: svg.replace('L80', 'L81') } }),
    ).rejects.toThrow();
    h.native.reserveJobApproval = () => ({
      generation: 2,
      token: 7,
      deviceFingerprint: 'b'.repeat(64),
    });
    await expect(h.service.start({ jobId: p.jobId, source: source() })).rejects.toThrow();
    expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(0);
  });
  it('preflight failure and invalidation during approval do not dispatch', async () => {
    const h = setup(),
      p = await prepared(h);
    h.opts.journal.preflight = async () => {
      throw Error('disk unavailable');
    };
    await expect(h.service.start({ jobId: p.jobId, source: source() })).rejects.toThrow();
    expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(0);
    const k = setup(),
      q = await prepared(k);
    k.opts.confirmLoad = async () => {
      k.service.invalidate();
      return true;
    };
    await expect(k.service.start({ jobId: q.jobId, source: source() })).rejects.toThrow();
    expect(k.calls.filter((c) => c[0] === 'start')).toHaveLength(0);
  });
});

async function pausedService() {
  const h = setup(),
    p = await prepared(h);
  await h.service.start({ jobId: p.jobId, source: source() });
  await h.service.go();
  const state = h.native.getJobState();
  state.phase = 'sending';
  state.jobStarted = true;
  await h.service.pause();
  state.phase = 'paused';
  return h;
}
it('queue pause and resume require fresh trusted clearance, not a renderer flag', async () => {
  const h = await pausedService();
  h.opts.confirmResume = async () => false;
  expect(await h.service.resume()).toEqual({ canceled: true });
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'resume')).toHaveLength(0);
  h.opts.confirmResume = async () => true;
  await h.service.resume();
  expect(h.calls.find((x) => x[0] === 'control' && x[1] === 'resume')?.slice(1, 4)).toEqual([
    'resume',
    true,
    { generation: 2, operationId: 1 },
  ]);
});
it('invalidates resume when source, calibration or cancellation changes while dialog is open', async () => {
  for (const change of ['source', 'calibration', 'cancel']) {
    const h = await pausedService();
    h.opts.confirmResume = async () => {
      if (change === 'source') h.service.invalidate();
      else if (change === 'calibration') h.lib.calibrations[0]!.deviceFingerprint = 'b'.repeat(64);
      else await h.service.cancel();
      return true;
    };
    await expect(h.service.resume()).rejects.toThrow();
    expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'resume')).toHaveLength(0);
  }
});

it('rechecks source authority at actual queued resume dispatch, not merely before enqueue', async () => {
  const h = await pausedService();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const original = h.native.controlJob;
  h.native.controlJob = async (action, approved, ctx, beforeDispatch?: () => Promise<void>) => {
    if (action === 'resume') {
      entered();
      await gate;
      await beforeDispatch?.();
    }
    return original(action, approved, ctx);
  };
  const pending = h.service.resume();
  await waiting;
  h.service.invalidate();
  release();
  await expect(pending).rejects.toThrow();
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'resume')).toHaveLength(0);
});

async function retainedService() {
  const h = setup(),
    p = await prepared(h);
  await h.service.start({ jobId: p.jobId, source: source() });
  await h.service.go();
  const state = h.native.getJobState();
  Object.assign(state, {
    phase: 'retained_ready',
    jobStarted: true,
    acceptedRecords: state.totalRecords,
    completedPasses: state.totalPasses,
  });
  Object.assign(h.native, {
    jobRetainedApprovalContext: () => ({
      generation: 2,
      operationId: state.operationId,
      deviceFingerprint: 'a'.repeat(64),
    }),
    startNextJob: async (req: any, ctx: any, guard?: () => Promise<void>) => {
      await guard?.();
      h.calls.push(['next', req, ctx]);
      Object.assign(state, {
        operationId: state.operationId + 1,
        phase: 'waiting_for_go',
        jobStarted: false,
        acceptedRecords: 0,
        completedPasses: 0,
        programDigest: req.programDigest,
      });
      return state;
    },
    jobGoApprovalContext: () => ({ generation: 2, operationId: state.operationId }),
  });
  return h;
}
it('prepares and arms a new immutable pen action on the existing mat without another load or automatic Go', async () => {
  const h = await retainedService(),
    nextSource = { ...source(), svg: svg.replace('L80 50', 'L81 50') };
  h.service.invalidate();
  const p = await h.service.prepare({ profileId: 'p', calibrationId: 'c', source: nextSource });
  const state = await h.service.start({ jobId: p.jobId, source: nextSource });
  expect(state).toMatchObject({ operationId: 2, phase: 'waiting_for_go', jobStarted: false });
  expect(h.calls.filter((x) => x[0] === 'start')).toHaveLength(1);
  expect(h.calls.filter((x) => x[0] === 'next')).toHaveLength(1);
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'go')).toHaveLength(1);
  const req = h.calls.find((x) => x[0] === 'next')![1];
  expect(req).not.toHaveProperty('motionApproved');
  expect(req).not.toHaveProperty('bladeRemovedConfirmed');
  await h.service.go();
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'go')).toHaveLength(2);
});
it('rejects different loaded-mat dimensions/material/calibration without sending another action', async () => {
  for (const change of ['mat', 'material', 'calibration']) {
    const h = await retainedService(),
      s = source();
    if (change === 'mat') s.mat.heightIn = 6.5;
    else if (change === 'material') {
      s.materialId = 2;
      h.lib.profiles[0]!.settings.materialId = 2;
    } else h.lib.calibrations[0]!.capturedAt = '2026-02-01T00:00:00Z';
    await expect(
      h.service.prepare({ profileId: 'p', calibrationId: 'c', source: s }),
    ).rejects.toThrow();
    expect(h.calls.filter((x) => x[0] === 'next')).toHaveLength(0);
  }
});
it('requires genuine explicit End confirmation and retains the session on refusal', async () => {
  const h = await retainedService();
  (h.opts as any).confirmEnd = async () => false;
  expect(await h.service.end()).toEqual({ canceled: true });
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'end')).toHaveLength(0);
  (h.opts as any).confirmEnd = async () => true;
  await h.service.end();
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'end')).toHaveLength(1);
});
it('fences an old action status reply while a new action journal is being created', async () => {
  const h = await retainedService(),
    p = await h.service.prepare({ profileId: 'p', calibrationId: 'c', source: source() });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    seen = new Promise<void>((r) => (entered = r));
  const old = structuredClone(h.native.getJobState());
  h.native.jobStatus = async () => {
    entered();
    await gate;
    return old;
  };
  const observed: any[] = [];
  h.opts.journal.observe = async (state) => {
    observed.push(structuredClone(state));
  };
  const stale = h.service.status();
  await seen;
  await h.service.start({ jobId: p.jobId, source: source() });
  release();
  await stale;
  expect(observed.map((x) => x.operationId)).toEqual([2]);
});

it('does not rewrite an unchanged retained-session report on every idle status poll', async () => {
  const h = await retainedService();
  let writes = 0;
  h.opts.journal.observe = async () => {
    writes++;
  };
  await h.service.status();
  await h.service.status();
  await h.service.status();
  expect(writes).toBe(1);
});

const cutPolicy = JSON.parse(
  readFileSync(new URL('./joy-blade-trial-policy.json', import.meta.url), 'utf8'),
);
const cutSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M75.59055118110237 75.59055118110237 L151.18110236220474 75.59055118110237 L151.18110236220474 151.18110236220474 L75.59055118110237 151.18110236220474 Z"/></svg>';
const cutSource = () => ({
  svg: cutSvg,
  materialId: 211,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: { '#112233': { tool: 'fine_point_blade' as const, operation: 'cut' as const } },
});
it('prepares and admits non-square multi-path blade jobs from the saved recipe', async () => {
  const h = cutSetup(),
    src = cutSource();
  src.svg = src.svg.replace(
    '</svg>',
    '<path fill="none" stroke="#112233" d="M180 180 C200 160 220 160 240 180 L240 220 L180 220 Z"/></svg>',
  );
  const p = await h.service.prepare({ profileId: 'p', calibrationId: 'c', source: src });
  await h.service.start({ jobId: p.jobId, source: src });
  expect(h.calls.find((x) => x[0] === 'start')![1]).toMatchObject({
    bladeJob: 'joy-blade-job-v1',
    pressureRequests: [223, 223, 223],
  });
  expect(h.calls.find((x) => x[0] === 'offline')![1].plan.groups[0].paths).toHaveLength(2);
});
function cutSetup() {
  const h = setup();
  h.lib.profiles[0]!.settings = { ...structuredClone(cutPolicy.settings), profileId: 'p' };
  h.lib.profiles[0]!.recipe = {
    catalogId: 'cached-joy-211-2',
    sourceMaterialId: 211,
    workspaceMaterialName: 'Heavy Cardstock - 100 lb (270 gsm)',
    passCount: 3,
    pressureRequests: [223, 223, 223],
  };
  const state = h.native.getJobState();
  Object.assign(state, { tool: 'fine_point_blade', totalPasses: 3, totalRecords: 18 });
  h.native.runOfflineConfiguration = async (r: any) => {
    h.calls.push(['offline', r]);
    return {
      programDigest: 'd'.repeat(64),
      tool: 'fine_point_blade',
      operation: 'cut',
      materialId: 211,
      passCount: 3,
      recordCount: 18,
      pressureRequests: [223, 223, 223],
      heightInches: 12,
      physicalCalibrationVerified: false,
    };
  };
  return h;
}
async function preparedCut(h: ReturnType<typeof cutSetup>) {
  return h.service.prepare({ profileId: 'p', calibrationId: 'c', source: cutSource() });
}
it('admits a blade job from a fresh owner with genuine load and distinct tool Go', async () => {
  const h = cutSetup(),
    p = await preparedCut(h);
  await h.service.start({ jobId: p.jobId, source: cutSource() });
  const req = h.calls.find((x) => x[0] === 'start')![1];
  expect(req.bladeJob).toBe('joy-blade-job-v1');
  expect(req.bladeRemovedConfirmed).toBe(true);
  expect(req.pressureRequests).toEqual([223, 223, 223]);
  expect(h.calls.filter((x) => x[0] === 'control')).toHaveLength(0);
  await h.service.go();
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'go')).toHaveLength(1);
});
it('accepts non-square finite source without relaxing saved recipe bindings', async () => {
  const h = cutSetup();
  const p = await h.service.prepare({
    profileId: 'p',
    calibrationId: 'c',
    source: {
      ...cutSource(),
      svg: cutSvg.replace('L151.18110236220474 151.18110236220474', 'L160 151.18110236220474'),
    },
  });
  expect(p.tool).toBe('fine_point_blade');
});
it('cannot silently promote a retained pen owner into the first blade trial', async () => {
  const h = cutSetup();
  Object.assign(h.native.getJobState(), {
    phase: 'retained_ready',
    jobStarted: true,
    acceptedRecords: 18,
    completedPasses: 3,
  });
  await expect(preparedCut(h)).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});
it('cannot use cut load approval as blade installation Go approval', async () => {
  const h = cutSetup(),
    p = await preparedCut(h);
  await h.service.start({ jobId: p.jobId, source: cutSource() });
  h.opts.confirmTool = async () => false;
  expect(await h.service.go()).toEqual({ canceled: true });
  expect(h.calls.filter((x) => x[0] === 'control' && x[1] === 'go')).toHaveLength(0);
});
it('keeps cut Go source validation inside dispatch and forbids cut pause/resume', async () => {
  const h = cutSetup(),
    p = await preparedCut(h);
  await h.service.start({ jobId: p.jobId, source: cutSource() });
  h.native.controlJob = async (...args: any[]) => {
    if (args[0] === 'go') {
      h.service.invalidate();
      await args[3]?.();
    }
    h.calls.push(['control', ...args]);
    return h.native.getJobState();
  };
  await expect(h.service.go()).rejects.toThrow();
  expect(h.calls.filter((x) => x[0] === 'control')).toHaveLength(0);
  Object.assign(h.native.getJobState(), { phase: 'sending', jobStarted: true });
  await expect(h.service.pause()).rejects.toThrow();
  Object.assign(h.native.getJobState(), { phase: 'paused' });
  await expect(h.service.resume()).rejects.toThrow();
  expect(h.calls.filter((x) => x[0] === 'control')).toHaveLength(0);
});

it('rejects a preview-only source before offline preparation or admission', async () => {
  const h = setup();
  await expect(
    h.service.prepare({
      profileId: 'p',
      calibrationId: 'c',
      source: { ...source, previewOnly: true },
    }),
  ).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});
function combinedSetup() {
  const h = setup();
  h.lib.profiles[0]!.settings.materialId = 211;
  const blade = structuredClone(h.lib.profiles[0]!);
  blade.id = 'b';
  blade.name = 'Saved Blade';
  blade.settings = { ...structuredClone(cutPolicy.settings), profileId: 'b' };
  blade.recipe = {
    catalogId: 'cached-joy-211-2',
    sourceMaterialId: 211,
    workspaceMaterialName: 'Heavy Cardstock',
    passCount: 3,
    pressureRequests: [223, 223, 223],
  };
  h.lib.profiles.push(blade);
  const combo = {
    svg: cutSvg.replace(
      '</svg>',
      '<path fill="none" stroke="#445566" d="M200 200 L230 200"/></svg>',
    ),
    materialId: 211,
    mat: { widthIn: 4.5, heightIn: 12 },
    strokeTools: {
      '#112233': { tool: 'fine_point_blade' as const, operation: 'cut' as const },
      '#445566': { tool: 'pen' as const, operation: 'draw' as const },
    },
  };
  h.native.runOfflineConfiguration = async (r: any) => {
    h.calls.push(['offline', r]);
    return {
      programDigest: (r.settings.tool === 'pen' ? 'd' : 'e').repeat(64),
      tool: r.settings.tool,
      operation: r.settings.operation,
      materialId: 211,
      passCount: r.pressureRequests.length,
      recordCount: r.settings.tool === 'pen' ? 1 : 111,
      pressureRequests: r.pressureRequests,
      heightInches: 12,
      physicalCalibrationVerified: false,
    };
  };
  const state = h.native.getJobState();
  Object.assign(h.native, {
    jobRetainedApprovalContext: () => ({
      generation: 2,
      operationId: state.operationId,
      deviceFingerprint: 'a'.repeat(64),
    }),
    startNextJob: async (req: any, ctx: any, guard?: () => Promise<void>) => {
      await guard?.();
      h.calls.push(['next', req, ctx]);
      Object.assign(state, {
        operationId: state.operationId + 1,
        phase: 'waiting_for_go',
        jobStarted: false,
        acceptedRecords: 0,
        completedPasses: 0,
        programDigest: req.programDigest,
        tool: req.settings.tool,
        totalRecords: 111,
        totalPasses: 3,
        returnToOrigin: 'pending',
      });
      return state;
    },
    jobGoApprovalContext: () => ({ generation: 2, operationId: state.operationId }),
  });
  return { ...h, combo, state };
}
it('freezes ALL parsed paths as pen then blade before one load and next is frozen blade only', async () => {
  const h = combinedSetup(),
    args = { profileId: 'p', calibrationId: 'c', source: h.combo };
  const first = await h.service.prepare(args);
  expect(first.tool).toBe('pen');
  expect(first.workflow).toMatchObject({ actionIndex: 0, actionCount: 2, containsBlade: true });
  const offline = h.calls.filter((c) => c[0] === 'offline');
  expect(offline).toHaveLength(2);
  expect(offline.every((c) => c[1].op === 'configuration' && c[1].action === 'prepare_job')).toBe(
    true,
  );
  expect(offline.map((c) => c[1].plan.groups[0].tool)).toEqual(['pen', 'fine_point_blade']);
  expect(offline.flatMap((c) => c[1].plan.groups[0].paths)).toHaveLength(2);
  const loaded = await h.service.start({ jobId: first.jobId, source: h.combo });
  expect('workflow' in loaded && loaded.workflow?.containsBlade).toBe(true);
  await h.service.go();
  Object.assign(h.state, { phase: 'sending', jobStarted: true });
  await expect(h.service.pause()).rejects.toThrow();
  Object.assign(h.state, {
    phase: 'retained_ready',
    jobStarted: true,
    acceptedRecords: 1,
    completedPasses: 1,
    returnToOrigin: 'protocol_complete',
  });
  const next = await h.service.prepare(args);
  expect(next.tool).toBe('fine_point_blade');
  expect(next.workflow?.actionIndex).toBe(1);
  expect(h.calls.filter((c) => c[0] === 'offline')).toHaveLength(2);
  await h.service.start({ jobId: next.jobId, source: h.combo });
  expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(1);
  expect(h.calls.find((c) => c[0] === 'next')![1]).toMatchObject({
    bladeJob: 'joy-blade-job-v1',
    pressureRequests: [223, 223, 223],
  });
  expect(h.calls.filter((c) => c[0] === 'control' && c[1] === 'go')).toHaveLength(1);
  await h.service.go();
  expect(h.calls.filter((c) => c[0] === 'control' && c[1] === 'go')).toHaveLength(2);
});
it('binds original selected blade even when the first unique saved action is pen', async () => {
  const h = combinedSetup();
  h.lib.selection!.profileId = 'b';
  const p = await h.service.prepare({ profileId: 'b', calibrationId: 'c', source: h.combo });
  expect(p.tool).toBe('pen');
  await h.service.start({ jobId: p.jobId, source: h.combo });
  expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(1);
  expect(h.lib.selection!.profileId).toBe('b');
});
it('refuses ambiguous saved recipes before compile or load', async () => {
  const h = combinedSetup();
  h.lib.selection!.profileId = 'b';
  h.lib.profiles.push({
    ...structuredClone(h.lib.profiles[0]!),
    id: 'p2',
    settings: { ...h.lib.profiles[0]!.settings, profileId: 'p2' },
  });
  await expect(
    h.service.prepare({ profileId: 'b', calibrationId: 'c', source: h.combo }),
  ).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});
it('editing any frozen source or profile prevents the blade dispatch', async () => {
  for (const mode of ['source', 'profile']) {
    const h = combinedSetup(),
      a = { profileId: 'p', calibrationId: 'c', source: h.combo };
    const p = await h.service.prepare(a);
    await h.service.start({ jobId: p.jobId, source: h.combo });
    await h.service.go();
    Object.assign(h.state, {
      phase: 'retained_ready',
      jobStarted: true,
      acceptedRecords: 1,
      completedPasses: 1,
      returnToOrigin: 'protocol_complete',
    });
    if (mode === 'profile') h.lib.profiles[1]!.settings.pressureRequest = 224;
    else h.service.invalidate();
    await expect(
      h.service.prepare({
        ...a,
        source:
          mode === 'source' ? { ...h.combo, svg: h.combo.svg.replace('L230', 'L231') } : h.combo,
      }),
    ).rejects.toThrow();
    expect(h.calls.filter((c) => c[0] === 'next')).toHaveLength(0);
  }
});

function multicolourSetup() {
  const h = combinedSetup();
  h.combo.svg = h.combo.svg.replace(
    '</svg>',
    '<path fill="none" stroke="#778899" d="M250 200 L280 200"/></svg>',
  );
  Object.assign(h.combo.strokeTools, { '#778899': { tool: 'pen', operation: 'draw' } });
  return h;
}
it('freezes one complete action per pen colour followed by blade before the first load', async () => {
  const h = multicolourSetup(),
    m = await h.service.prepare({ profileId: 'p', calibrationId: 'c', source: h.combo });
  expect(m.workflow).toMatchObject({ actionCount: 3, containsBlade: true });
  expect(m.workflow!.actions.map((a) => [a.tool, a.color])).toEqual([
    ['pen', '#445566'],
    ['pen', '#778899'],
    ['fine_point_blade', undefined],
  ]);
  const drafts = h.calls.filter((c) => c[0] === 'offline');
  expect(drafts).toHaveLength(3);
  expect(drafts.map((c) => c[1].plan.groups[0].paths[0].color)).toEqual([
    '#445566',
    '#778899',
    undefined,
  ]);
  expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(0);
});
it('supports a frozen pen-only colour queue without inventing a blade action', async () => {
  const h = multicolourSetup();
  h.combo.svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#445566" d="M80 80 L100 80"/><path fill="none" stroke="#778899" d="M120 80 L140 80"/></svg>';
  const m = await h.service.prepare({ profileId: 'p', calibrationId: 'c', source: h.combo });
  expect(m.workflow).toMatchObject({ actionCount: 2, containsBlade: false });
  expect(m.workflow!.actions.map((a) => a.color)).toEqual(['#445566', '#778899']);
});
it('pen-colour changes use one load, distinct operations and a fresh Go for every tool', async () => {
  const h = multicolourSetup(),
    args = { profileId: 'p', calibrationId: 'c', source: h.combo };
  (h.native as any).startNextJob = async (req: any, ctx: any, guard?: () => Promise<void>) => {
    await guard?.();
    h.calls.push(['next', req, ctx]);
    Object.assign(h.state, {
      operationId: h.state.operationId + 1,
      phase: 'waiting_for_go',
      jobStarted: false,
      acceptedRecords: 0,
      completedPasses: 0,
      programDigest: req.programDigest,
      tool: req.settings.tool,
      totalRecords: req.settings.tool === 'pen' ? 1 : 111,
      totalPasses: req.pressureRequests.length,
      returnToOrigin: 'pending',
    });
    return h.state;
  };
  let m = await h.service.prepare(args);
  await h.service.start({ jobId: m.jobId, source: h.combo });
  await h.service.go();
  for (let i = 1; i < 3; i++) {
    Object.assign(h.state, {
      phase: 'retained_ready',
      jobStarted: true,
      acceptedRecords: h.state.totalRecords,
      completedPasses: h.state.totalPasses,
      returnToOrigin: 'protocol_complete',
    });
    m = await h.service.prepare(args);
    expect(m.workflow!.actionIndex).toBe(i);
    await h.service.start({ jobId: m.jobId, source: h.combo });
    expect(h.calls.filter((c) => c[0] === 'control' && c[1] === 'go')).toHaveLength(i);
    await h.service.go();
  }
  expect(h.calls.filter((c) => c[0] === 'start')).toHaveLength(1);
  expect(h.calls.filter((c) => c[0] === 'next')).toHaveLength(2);
  expect(h.calls.filter((c) => c[0] === 'control' && c[1] === 'go')).toHaveLength(3);
});

it('automatic initial preparation selects exact source recipes while remaining motion-free', async () => {
  const h = setup();
  h.native.getJobState = () => ({ ...h.native.jobStatus, phase: 'idle', active: false }) as any;
  let ensure = 0;
  const c = new NativeJoyJobService({
    ...h.opts,
    ensureMakeSelection: async (material, tools) => {
      expect(material).toBe(1);
      expect(tools).toEqual(['pen']);
      ensure++;
      return { profileId: 'p', calibrationId: 'c' };
    },
  });
  const p = await c.prepareAutomatic(source());
  expect(p.jobId).toBeTruthy();
  expect(ensure).toBe(1);
  expect(h.calls.filter((x) => x[0] === 'start' || x[0] === 'control')).toHaveLength(0);
});
it('automatic preparation rejects preview fields and active/standalone owners before recipe writes', async () => {
  const h = setup();
  let writes = 0;
  const c = new NativeJoyJobService({
    ...h.opts,
    ensureMakeSelection: async () => {
      writes++;
      return { profileId: 'p', calibrationId: 'c' };
    },
  });
  await expect(c.prepareAutomatic({ ...source(), previewOnly: true })).rejects.toThrow();
  await expect(c.prepareAutomatic(source())).rejects.toThrow();
  expect(writes).toBe(0);
});
it('automatic preparation invalidated during recipe lookup cannot publish or compile a stale program', async () => {
  const h = setup();
  h.native.getJobState = () => ({ phase: 'idle', active: false }) as any;
  let c: NativeJoyJobService;
  c = new NativeJoyJobService({
    ...h.opts,
    ensureMakeSelection: async () => {
      c.invalidate();
      return { profileId: 'p', calibrationId: 'c' };
    },
  });
  await expect(c.prepareAutomatic(source())).rejects.toThrow();
  expect(h.calls).toHaveLength(0);
});
