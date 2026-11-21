import { describe, it, expect } from 'vitest';
import { registerNativeJoyIpc, type NativeJoyIpcDependencies } from './native-joy-ipc';
function fixture(
  confirm = true,
  changeDuringDialog = false,
  diagnostics?: NativeJoyIpcDependencies['diagnostics'],
) {
  const handlers = new Map<string, (e: unknown, x?: unknown) => Promise<unknown>>();
  const calls: unknown[][] = [];
  let context = 1,
    busy = false,
    dialogs = 0;
  const service = {
    getStatus: async () => ({ enabled: true }),
    loadingApprovalContext: () => context,
    getLoadingState: () => ({ active: false }),
    startLoading: async (h: 6.5 | 12, a: boolean, b: boolean, c?: number) => {
      if (c !== context) throw Error('approval session changed');
      calls.push(['start', h, a, b, c]);
      return { active: true };
    },
    loadingStatus: async () => {
      calls.push(['status']);
      return {};
    },
    controlLoading: async (a: 'go' | 'cancel') => {
      calls.push([a]);
      return {};
    },
    importProvisioning: async () => ({}),
    connect: async () => ({}),
    pollStatus: async () => ({}),
    disconnect: async () => {},
  };
  registerNativeJoyIpc({
    register: (n, f) => handlers.set(n, f),
    isTrusted: (e) => e === 'trusted',
    cutterBusy: () => busy,
    chooseCache: async () => null,
    confirmImport: async () => false,
    confirmHardware: async () => false,
    confirmLoading: async () => {
      dialogs++;
      if (changeDuringDialog) context++;
      return confirm;
    },
    service: () => service,
    diagnostics: diagnostics ?? {
      prepare: async () => {},
      record: async () => {},
      export: async () => ({ canceled: true }),
    },
  });
  return {
    handlers,
    calls,
    service,
    get dialogs() {
      return dialogs;
    },
    setBusy: (b: boolean) => {
      busy = b;
    },
  };
}
describe('loading IPC host authority and session-bound approval', () => {
  it('restores terminal history only for an idle service, never in place of an active operation', async () => {
    let restores = 0;
    const old = { phase: 'failed', active: false, historical: true };
    const f = fixture(true, false, {
      prepare: async () => {},
      record: async () => {},
      export: async () => ({ canceled: true }),
      restore: async () => {
        restores++;
        return old;
      },
    });
    f.service.loadingStatus = async () => ({ phase: 'idle' });
    expect(await f.handlers.get('native-joy:loading-status')!('trusted')).toEqual(old);
    f.service.loadingStatus = async () => ({ phase: 'waiting_for_mat', active: true });
    expect(await f.handlers.get('native-joy:loading-status')!('trusted')).toEqual({
      phase: 'waiting_for_mat',
      active: true,
    });
    expect(restores).toBe(1);
  });

  it('persists safe terminal metadata when a worker boundary rejects instead of logging exception text', async () => {
    const records: unknown[] = [];
    const f = fixture(true, false, {
      prepare: async () => {},
      record: async (s) => {
        records.push(s);
      },
      export: async () => ({ canceled: true }),
    });
    f.service.loadingStatus = async () => {
      throw Error('DO_NOT_LOG_SECRET');
    };
    await expect(f.handlers.get('native-joy:loading-status')!('trusted')).rejects.toThrow();
    expect(records).toEqual([{ active: false }]);
    expect(JSON.stringify(records)).not.toContain('DO_NOT_LOG_SECRET');
  });

  it('rechecks competing ownership after async storage preparation', async () => {
    const f = fixture(true, false, {
      prepare: async () => {
        f.setBusy(true);
      },
      record: async () => {},
      export: async () => ({ canceled: true }),
    });
    await expect(
      f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 }),
    ).rejects.toThrow(/owns|session/i);
    expect(f.calls).toEqual([]);
  });
  it('does not open a second loading dialog or export while admission is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const f = fixture(true, false, {
      prepare: () => gate,
      record: async () => {},
      export: async () => ({ canceled: false }),
    });
    const pending = f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 });
    await new Promise((r) => setTimeout(r, 0));
    await expect(
      f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 }),
    ).rejects.toThrow(/pending/i);
    await expect(
      f.handlers.get('native-joy:loading-diagnostics-export')!('trusted'),
    ).rejects.toThrow(/loading/i);
    release();
    await pending;
    expect(f.dialogs).toBe(1);
    expect(f.calls.filter((c) => c[0] === 'start')).toHaveLength(1);
  });

  it('preflights capture before any start and records returned metadata', async () => {
    const seen: string[] = [];
    const f = fixture(true, false, {
      prepare: async () => {
        seen.push('prepare');
      },
      record: async () => {
        seen.push('record');
      },
      export: async () => ({ canceled: false }),
    });
    await f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 });
    expect(seen).toEqual(['prepare', 'record']);
    expect(f.calls[0]?.[0]).toBe('start');
  });
  it('refuses motion when diagnostic preparation fails', async () => {
    const f = fixture(true, false, {
      prepare: async () => {
        throw Error('disk unavailable');
      },
      record: async () => {},
      export: async () => ({ canceled: false }),
    });
    await expect(
      f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 }),
    ).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
  it('exports only from a trusted sender without renderer paths or flags', async () => {
    let exports = 0;
    const f = fixture(true, false, {
      prepare: async () => {},
      record: async () => {},
      export: async () => {
        exports++;
        return { canceled: false };
      },
    });
    const handler = f.handlers.get('native-joy:loading-diagnostics-export');
    expect(handler).toBeTypeOf('function');
    await expect(handler!('untrusted')).rejects.toThrow(/trusted/);
    await expect(handler!('trusted', { path: '/untrusted' })).rejects.toThrow();
    expect(exports).toBe(0);
    expect(await handler!('trusted')).toEqual({ canceled: false });
    expect(exports).toBe(1);
  });

  it('only supplies host approval and the captured session generation', async () => {
    const f = fixture();
    await f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 6.5 });
    expect(f.calls).toEqual([['start', 6.5, true, true, 1]]);
    expect(f.dialogs).toBe(1);
  });
  it('denies motion when the native session changes while confirmation is open', async () => {
    const f = fixture(true, true);
    await expect(
      f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 }),
    ).rejects.toThrow(/session/i);
    expect(f.calls).toEqual([]);
  });
  it('declined confirmation never activates the worker', async () => {
    const f = fixture(false);
    expect(
      await f.handlers.get('native-joy:loading-start')!('trusted', { heightInches: 12 }),
    ).toEqual({ canceled: true });
    expect(f.calls).toEqual([]);
  });
  it('rejects untrusted, malformed, forged approval and presence before any dialog', async () => {
    const f = fixture();
    for (const [sender, input] of [
      ['untrusted', { heightInches: 12 }],
      ['trusted', { heightInches: 12, motionApproved: true }],
      ['trusted', { heightInches: 12, materialPresent: true }],
      ['trusted', { heightInches: true }],
      ['trusted', { heightInches: 8 }],
    ])
      await expect(f.handlers.get('native-joy:loading-start')!(sender, input)).rejects.toThrow();
    expect(f.dialogs).toBe(0);
    expect(f.calls).toEqual([]);
  });
  it('control identities and physical observations cannot be supplied by renderer', async () => {
    const f = fixture();
    for (const name of ['status', 'go', 'cancel']) {
      await expect(f.handlers.get('native-joy:loading-' + name)!('untrusted')).rejects.toThrow(
        /trusted/i,
      );
      await expect(
        f.handlers.get('native-joy:loading-' + name)!('trusted', { operationId: 1 }),
      ).rejects.toThrow();
    }
    expect(f.calls).toEqual([]);
    await f.handlers.get('native-joy:loading-cancel')!('trusted');
    expect(f.calls).toEqual([['cancel']]);
  });
});
