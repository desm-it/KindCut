import { describe, it, expect, vi, afterEach } from 'vitest';
import { NativeJoyPanelController, type NativeJoyPanelApi } from './native-joy-panel-controller';
import type { NativeJoySetup, NativeJoyLoadingState } from '../../shell/native-joy-service';
const session = {
  state: 'ready' as const,
  machine: 'cricut_joy' as const,
  firmwareSelector: 8.164000001,
  materialRecord: 0,
  fallbackUsed: false,
  status: {
    status_byte_1: 96,
    status_byte_2: 1,
    extra_u16_raw: 0,
    extra_u16_native: 0,
    value_be32: 0,
  },
};
function state(
  phase: NativeJoyLoadingState['phase'] = 'loading_and_aligning',
): NativeJoyLoadingState {
  return {
    operationId: 1,
    phase,
    active: ['loading_and_aligning', 'waiting_for_go', 'releasing'].includes(phase),
    sessionRetired: ['completed', 'cancelled', 'failed'].includes(phase),
    physicalLoadingVerified: false,
    physicalAlignmentVerified: false,
    motionStoppedVerified: false,
    jobStarted: false,
  };
}
function fixture() {
  const calls: string[] = [];
  let remote = state();
  let started = false;
  let mat: unknown = { canceled: true };
  const api: NativeJoyPanelApi = {
    getSetupStatus: async () => {
      calls.push('metadata');
      return {
        experimental: true,
        enabled: true,
        platform: 'darwin',
        runtimeAvailable: true,
        provisioned: true,
        session: remote.sessionRetired ? null : session,
      } satisfies NativeJoySetup;
    },
    devices: async () => {
      calls.push('devices');
      return [];
    },
    importProvisioning: async () => ({ canceled: true }),
    connect: async () => session,
    pollStatus: async () => session,
    disconnect: async () => {
      calls.push('disconnect');
      remote = state('cancelled');
    },
    mat: async (action) => {
      calls.push(`mat:${action}`);
      return mat as Awaited<ReturnType<NonNullable<NativeJoyPanelApi['mat']>>>;
    },
    loadingStart: async () => {
      calls.push('start');
      started = true;
      return remote;
    },
    loadingStatus: async () => {
      calls.push('status');
      return started
        ? remote
        : {
            operationId: 0,
            phase: 'idle',
            active: false,
            sessionRetired: false,
            physicalLoadingVerified: false,
            physicalAlignmentVerified: false,
            motionStoppedVerified: false,
            jobStarted: false,
          };
    },
    loadingGo: async () => {
      calls.push('go');
      remote = state('releasing');
      return remote;
    },
    loadingCancel: async () => {
      calls.push('cancel');
      return remote;
    },
  };
  const c = new NativeJoyPanelController(api, () => {});
  return {
    api,
    c,
    calls,
    setRemote: (s: NativeJoyLoadingState) => {
      remote = s;
    },
    setMat: (s: unknown) => {
      mat = s;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe('native Joy panel lifecycle and truthful progress', () => {
  it('deliberate make entry calls host even when metadata already has a ready session', async () => {
    const f = fixture();
    let calls = 0;
    f.api.connectForMake = async () => {
      calls++;
      return { status: 'connected', devices: [] };
    };
    await f.c.mount();
    await f.c.connectForMake();
    expect(calls).toBe(1);
    f.c.dispose();
  });
  it('mount reads local setup only; discovery requires explicit action', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.c.mount();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.calls).toEqual(['metadata', 'status']);
    await f.c.run('refresh');
    expect(f.calls.filter((x) => x === 'devices')).toHaveLength(1);
    f.c.dispose();
  });
  it('continues polling after a slow Finish crosses a timer tick and reports terminal only after observation', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.c.mount();
    await f.c.run('startLoading');
    f.setRemote(state('waiting_for_go'));
    await vi.advanceTimersByTimeAsync(500);
    let release!: (s: NativeJoyLoadingState) => void;
    f.api.loadingGo = () =>
      new Promise((r) => {
        release = r;
      });
    const finish = f.c.run('finishLoading');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(700);
    release(state('releasing'));
    await finish;
    expect(f.c.snapshot.loading?.active).toBe(true);
    expect(f.c.snapshot.message).not.toMatch(/finished|session released/i);
    f.setRemote(state('completed'));
    await vi.advanceTimersByTimeAsync(500);
    expect(f.c.snapshot.loading?.phase).toBe('completed');
    expect(f.c.snapshot.setup?.session).toBeNull();
    expect(f.c.snapshot.message).toMatch(/session ended/i);
    const count = f.calls.length;
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.calls).toHaveLength(count);
    f.c.dispose();
  });
  it('late start completion after unmount requests cancellation without publishing state', async () => {
    const f = fixture();
    await f.c.mount();
    let release!: (s: NativeJoyLoadingState) => void;
    f.api.loadingStart = () =>
      new Promise((r) => {
        release = r;
      });
    const start = f.c.run('startLoading');
    await Promise.resolve();
    f.c.dispose();
    release(state());
    await start;
    expect(f.calls.filter((x) => x === 'cancel')).toHaveLength(1);
    expect(f.c.snapshot.loading).toBeNull();
  });
  it('queues Cancel behind a pending metadata poll rather than losing the click', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.c.mount();
    await f.c.run('startLoading');
    let release!: (s: NativeJoyLoadingState) => void;
    f.api.loadingStatus = () =>
      new Promise((r) => {
        release = r;
      });
    await vi.advanceTimersByTimeAsync(500);
    const cancel = f.c.run('cancelLoading');
    await Promise.resolve();
    expect(f.calls).not.toContain('cancel');
    release(state('waiting_for_go'));
    await cancel;
    expect(f.calls).toContain('cancel');
    f.c.dispose();
  });
  it('keeps the legacy unload route separate from normal retained loading', async () => {
    const f = fixture();
    await f.c.mount();
    await f.c.run('unload');
    expect(f.calls).toContain('mat:unload');
    expect(f.calls).not.toContain('start');
    expect(f.calls).not.toContain('mat:load');
    f.c.dispose();
  });
  it('routes the normal Load mat action to the retained loader and never to legacy mat load', async () => {
    const f = fixture();
    await f.c.mount();
    await f.c.run('load');
    expect(f.calls).toContain('start');
    expect(f.calls).not.toContain('mat:load');
    expect(f.c.snapshot.loading?.phase).toBe('loading_and_aligning');
    f.c.dispose();
  });
  it('allows explicit disconnect while active and never claims physical stopping', async () => {
    const f = fixture();
    await f.c.mount();
    await f.c.run('startLoading');
    await f.c.run('disconnect');
    expect(f.calls).toContain('disconnect');
    expect(f.c.snapshot.loading?.phase).toBe('loading_and_aligning');
    expect(f.c.snapshot.message).toMatch(/stopping.*not.*verified/i);
    f.c.dispose();
  });
  it('preserves retired failure across refresh and terminal polls', async () => {
    const f = fixture();
    const failed = {
      ...state('failed'),
      diagnostics: {
        version: 1,
        operationId: 1,
        lastStage: 'grip',
        failure: { stage: 'grip', code: 'unexpected_reply', errorType: 'ProtocolError' },
        events: [],
        totalEvents: 1,
        evictedEvents: 0,
        captureIncomplete: false,
      },
    } as NativeJoyLoadingState;
    f.setRemote(failed);
    await f.c.mount();
    await f.c.run('startLoading');
    expect(f.c.snapshot.loading?.phase).toBe('failed');
    await f.c.run('refresh');
    expect(f.c.snapshot.loading?.phase).toBe('failed');
    expect((f.c.snapshot.loading as unknown as { diagnostics: unknown })?.diagnostics).toEqual(
      failed.diagnostics,
    );
    f.c.dispose();
  });
  it('exports persisted diagnostics through optional host API and reports cancellation without claiming save', async () => {
    const f = fixture();
    await f.c.mount();
    let exports = 0;
    f.api.exportLoadingDiagnostics = async () => {
      exports++;
      return { canceled: true };
    };
    await f.c.run('export-diagnostics');
    expect(exports).toBe(1);
    expect(f.c.snapshot.message).toMatch(/cancel/i);
    expect(f.c.snapshot.message).not.toMatch(/successfully|file exported/i);
    f.c.dispose();
  });
  it('does not export while loading is active', async () => {
    const f = fixture();
    await f.c.mount();
    await f.c.run('startLoading');
    let exports = 0;
    f.api.exportLoadingDiagnostics = async () => {
      exports++;
      return { canceled: false };
    };
    await f.c.run('export-diagnostics');
    expect(exports).toBe(0);
    expect(f.c.snapshot.loading?.active).toBe(true);
    f.c.dispose();
  });
});

it('failed connection gets power-cycle guidance without automatic retries or device commands', async () => {
  const f = fixture();
  let connects = 0;
  f.api.connect = async () => {
    connects++;
    throw Error('raw private failure');
  };
  await f.c.mount();
  await f.c.run('connect');
  expect(f.c.snapshot).toMatchObject({ connectionNotice: 'connect_failed', error: '' });
  expect(connects).toBe(1);
  expect(f.calls).not.toContain('start');
  expect(f.calls).not.toContain('mat:load');
  await f.c.run('connect');
  expect(connects).toBe(2);
  f.c.dispose();
});
it('a completed empty search shows power and pairing guidance, never on initial mount', async () => {
  const f = fixture();
  await f.c.mount();
  expect(f.c.snapshot.connectionNotice).toBeNull();
  await f.c.run('refresh');
  expect(f.c.snapshot.connectionNotice).toBe('not_found');
  expect(f.c.snapshot.address).toBe('');
  f.api.devices = async () => [
    { id: '00:11:22:33:44:55', name: 'Joy', paired: true, connected: false },
  ];
  await f.c.run('refresh');
  expect(f.c.snapshot.connectionNotice).toBeNull();
  expect(f.c.snapshot.address).toBe('00:11:22:33:44:55');
  f.c.dispose();
});
it('search errors have their own guidance instead of pretending no paired device exists', async () => {
  const f = fixture();
  f.api.devices = async () => {
    throw Error('SECRET must never be rendered');
  };
  await f.c.mount();
  await f.c.run('refresh');
  expect(f.c.snapshot).toMatchObject({ connectionNotice: 'search_failed', error: '' });
  f.c.dispose();
});
it('cancelled approval is not a connection failure and successful retry clears the notice', async () => {
  const f = fixture();
  await f.c.mount();
  f.api.connect = async () => {
    throw Error('fail');
  };
  await f.c.run('connect');
  f.api.connect = async () => ({ canceled: true });
  await f.c.run('connect');
  expect(f.c.snapshot.connectionNotice).toBeNull();
  expect(f.c.snapshot.message).toMatch(/Canceled/);
  f.api.connect = async () => session;
  await f.c.run('connect');
  expect(f.c.snapshot.connectionNotice).toBeNull();
  expect(f.c.snapshot.message).toContain('connected');
  f.c.dispose();
});

it('does not report onboarding ready when a reused-session setup is canceled or fails', async () => {
  for (const kind of ['canceled', 'failure']) {
    const api: any = {
      getSetupStatus: async () => ({ session: {} }),
      connectForMake: async () => {
        if (kind === 'failure') throw Error('setup failed');
        return { canceled: true };
      },
    };
    const c = new NativeJoyPanelController(api, () => {});
    await c.mount();
    expect(await c.connectForMake()).toBe(false);
    c.dispose();
  }
});
