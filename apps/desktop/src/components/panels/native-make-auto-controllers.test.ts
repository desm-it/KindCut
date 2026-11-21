import { it, expect } from 'vitest';
import { NativeJoyPanelController } from './native-joy-panel-controller';
import { NativeJobController } from './native-joy-job-controller';
it('suppresses concurrent setup and rechecks an existing session on a new Make entry', async () => {
  let calls = 0,
    connected = false,
    release!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    api: any = {
      getSetupStatus: async () => ({ session: connected ? {} : null }),
      connectForMake: async () => {
        calls++;
        await gate;
        connected = true;
        return {
          status: 'connected',
          devices: [{ id: '01:02:03:04:05:06', name: 'Joy', paired: true, connected: true }],
        };
      },
    };
  const c = new NativeJoyPanelController(api, () => {});
  await c.mount();
  const one = c.connectForMake();
  await c.connectForMake();
  expect(calls).toBe(1);
  release();
  await one;
  await c.connectForMake();
  expect(calls).toBe(2);
  expect(c.snapshot.setup?.session).toBeTruthy();
  c.dispose();
});
it('retains ambiguous candidates without choosing a device or repeatedly connecting', async () => {
  const devices = ['a', 'b'].map((id) => ({ id, name: id, paired: true, connected: false }));
  const c = new NativeJoyPanelController(
    {
      getSetupStatus: async () => ({ session: null }),
      connectForMake: async () => ({ status: 'choose_device', devices }),
    } as any,
    () => {},
  );
  await c.mount();
  await c.connectForMake();
  expect(c.snapshot.devices).toHaveLength(2);
  expect(c.snapshot.address).toBe('');
  c.dispose();
});
it('automatically prepares and arms a frozen next tool without ever calling Go or loading', async () => {
  let prepared = 0,
    armed = 0,
    go = 0,
    load = 0;
  const workflow = {
      actionIndex: 0,
      actionCount: 2,
      containsBlade: true,
      actions: [{ tool: 'pen' }, { tool: 'fine_point_blade' }],
    },
    held: any = { phase: 'retained_ready', active: true, tool: 'pen', operationId: 1, workflow };
  const source: any = { materialId: 218 };
  const next: any = {
    jobId: 'next',
    workflow: { ...workflow, actionIndex: 1 },
    tool: 'fine_point_blade',
  };
  const api: any = {
    jobStatus: async () => held,
    configurationList: async () => ({ selection: null }),
    jobPrepareAutomatic: async (s: any) => {
      expect(s).toBe(source);
      prepared++;
      return next;
    },
    jobArmNext: async () => {
      armed++;
      return {
        ...held,
        operationId: 2,
        phase: 'waiting_for_go',
        tool: 'fine_point_blade',
        workflow: next.workflow,
      };
    },
    jobGo: async () => {
      go++;
    },
    jobStart: async () => {
      load++;
    },
    jobInvalidate: async () => {},
  };
  const c = new NativeJobController(
    api,
    () => {},
    async () => source,
  );
  await c.mount();
  await c.run('prepare');
  expect(prepared).toBe(1);
  await c.run('arm-next');
  expect(armed).toBe(1);
  expect(c.state.job?.phase).toBe('waiting_for_go');
  expect(go).toBe(0);
  expect(load).toBe(0);
  c.dispose();
});
