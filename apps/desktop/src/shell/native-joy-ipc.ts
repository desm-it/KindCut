export interface NativeJoyIpcDependencies {
  register(name: string, handler: (event: unknown, input?: unknown) => Promise<unknown>): void;
  isTrusted(event: unknown): boolean;
  cutterBusy(): boolean;
  listDevices?(): Promise<Array<{ name: string; id: string; paired: boolean; connected: boolean }>>;
  chooseCache(): Promise<string | null>;
  confirmImport(): Promise<boolean>;
  confirmHardware(): Promise<boolean>;
  confirmMat?(action: 'load' | 'unload'): Promise<boolean>;
  assertCurrent?(action: 'connect'): void;
  ensureDeviceSettings?(current: () => boolean): Promise<void>;
  confirmLoading?(heightInches: 6.5 | 12): Promise<boolean>;
  diagnostics?: {
    prepare(height: 6.5 | 12): Promise<void>;
    record(state: unknown): Promise<void>;
    restore?(): Promise<unknown | null>;
    export(): Promise<{ canceled: boolean }>;
  };
  service(): {
    readonly inlineActionIdentity?: string;
    getLoadingState?(): { active: boolean };
    loadingApprovalContext?(): number;
    startLoading?(
      heightInches: 6.5 | 12,
      approved: boolean,
      bladeRemovedConfirmed: boolean,
      approvalContext?: number,
    ): Promise<unknown>;
    loadingStatus?(): Promise<unknown>;
    controlLoading?(action: 'go' | 'cancel'): Promise<unknown>;
    getStatus(): Promise<{ enabled: boolean; session?: unknown }>;
    importProvisioning(input: { sourcePath: string; approved: boolean }): Promise<unknown>;
    connect(
      input: { address: string; hardwareApproved: boolean; cryptoResetApproved: boolean },
      owner?: object,
    ): Promise<unknown>;
    cancelMakeConnection?(owner: object): Promise<boolean>;
    controlMat?(action: 'load' | 'unload', approved: boolean): Promise<unknown>;
    pollStatus(): Promise<unknown>;
    disconnect(): Promise<void>;
  };
}
export function registerNativeJoyIpc(deps: NativeJoyIpcDependencies) {
  type Attempt = {
    service: ReturnType<NativeJoyIpcDependencies['service']>;
    owner: object;
    canceled: boolean;
    pending: boolean;
    started: boolean;
    cancellation?: Promise<boolean>;
  };
  let makeAttempt: Attempt | null = null;
  deps.register('native-joy:cancel-make-connection', async (event, input) => {
    if (!deps.isTrusted(event)) throw Error('Native Joy requires a trusted main-frame sender.');
    if (input !== undefined) throw Error('Connection cancellation accepts no renderer fields.');
    const attempt = makeAttempt;
    if (!attempt) return { canceled: false };
    if (deps.service() !== attempt.service) throw Error('Connection owner changed.');
    if (deps.cutterBusy()) throw Error('Another cutter operation owns the hardware.');
    attempt.canceled = true;
    attempt.cancellation ??= (async () => {
      if (!attempt.started) return true;
      if (!attempt.service.cancelMakeConnection)
        throw Error('Scoped connection cancellation is unavailable.');
      return attempt.service.cancelMakeConnection(attempt.owner);
    })();
    try {
      return { canceled: await attempt.cancellation };
    } finally {
      if (makeAttempt === attempt) makeAttempt = null;
    }
  });
  let loadingAdmission = false;
  const record = async (state: unknown) => {
    try {
      await deps.diagnostics?.record(state);
    } catch {
      throw new Error('Loading diagnostics could not be saved; capture is incomplete.');
    }
    return state;
  };
  const runLoading = async (
    service: ReturnType<NativeJoyIpcDependencies['service']>,
    run: () => Promise<unknown>,
  ) => {
    let state: unknown;
    try {
      state = await run();
    } catch (error) {
      const terminal = service.getLoadingState?.();
      if (terminal) await record(terminal);
      throw error;
    }
    return record(state);
  };
  const trusted = (event: unknown) => {
    if (!deps.isTrusted(event)) throw new Error('Native Joy requires a trusted main-frame sender.');
  };
  const idle = () => {
    if (deps.cutterBusy()) throw new Error('Another cutter session currently owns the hardware.');
  };
  deps.register('native-joy:loading-start', async (event, input) => {
    trusted(event);
    idle();
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid loading choice.');
    const x = input as Record<string, unknown>;
    if (
      Object.keys(x).some((k) => k !== 'heightInches') ||
      (x.heightInches !== 6.5 && x.heightInches !== 12)
    )
      throw new Error('Choose a supported mat height.');
    const height = x.heightInches as 6.5 | 12;
    if (loadingAdmission) throw new Error('Loading confirmation is already pending.');
    loadingAdmission = true;
    try {
      const service = deps.service();
      if (!(await service.getStatus()).enabled)
        throw new Error('Experimental native Joy is disabled.');
      if (!service.loadingApprovalContext || !service.startLoading || !deps.diagnostics)
        throw new Error('Loading diagnostics or runtime are unavailable.');
      const context = service.loadingApprovalContext();
      if (!deps.confirmLoading || !(await deps.confirmLoading(height))) return { canceled: true };
      idle();
      if (deps.service() !== service)
        throw new Error('Native Joy session changed during approval.');
      try {
        await deps.diagnostics.prepare(height);
      } catch {
        throw new Error(
          'Loading diagnostic storage could not be prepared; no loading request was sent.',
        );
      }
      idle();
      if (deps.service() !== service)
        throw new Error('Native Joy session changed during diagnostic preparation.');
      return await runLoading(service, () => service.startLoading!(height, true, true, context));
    } finally {
      loadingAdmission = false;
    }
  });
  deps.register('native-joy:loading-status', async (event, input) => {
    trusted(event);
    if (input !== undefined) throw new Error('Loading status accepts no renderer fields.');
    const service = deps.service();
    if (!service.loadingStatus) throw new Error('Experimental loading is unavailable.');
    const state = await runLoading(service, () => service.loadingStatus!());
    if ((state as { phase?: string })?.phase === 'idle' && deps.diagnostics?.restore)
      return (await deps.diagnostics.restore()) ?? state;
    return state;
  });
  for (const action of ['go', 'cancel'] as const)
    deps.register(`native-joy:loading-${action}`, async (event, input) => {
      trusted(event);
      if (input !== undefined) throw new Error('Loading controls accept no renderer fields.');
      if (action === 'go') idle();
      const service = deps.service();
      if (!service.controlLoading) throw new Error('Experimental loading is unavailable.');
      return runLoading(service, () => service.controlLoading!(action));
    });
  deps.register('native-joy:loading-diagnostics-export', async (event, input) => {
    trusted(event);
    if (input !== undefined) throw new Error('Diagnostic export accepts no renderer fields.');
    const s = deps.service();
    if (loadingAdmission || s.getLoadingState?.().active)
      throw new Error('End the loading operation before opening diagnostic export.');
    if (!deps.diagnostics) throw new Error('Loading diagnostic export is unavailable.');
    loadingAdmission = true;
    try {
      return await deps.diagnostics.export();
    } finally {
      loadingAdmission = false;
    }
  });
  deps.register('native-joy:get-status', async (event) => {
    trusted(event);
    return deps.service().getStatus();
  });
  deps.register('native-joy:devices', async (event) => {
    trusted(event);
    return (await deps.listDevices?.()) ?? [];
  });
  deps.register('native-joy:import', async (event) => {
    trusted(event);
    if (!(await deps.confirmImport())) return { canceled: true };
    const sourcePath = await deps.chooseCache();
    if (!sourcePath) return { canceled: true };
    return deps.service().importProvisioning({ sourcePath, approved: true });
  });
  deps.register('native-joy:connect', async (event, input) => {
    trusted(event);
    idle();
    if (
      !input ||
      typeof input !== 'object' ||
      typeof (input as { address?: unknown }).address !== 'string'
    )
      throw new Error('A Bluetooth address is required.');
    const address = (input as { address: string }).address;
    if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(address))
      throw new Error('Invalid Bluetooth address.');
    if (
      deps.listDevices &&
      !(await deps.listDevices()).some((d) => d.id.toUpperCase() === address.toUpperCase())
    )
      throw new Error('Select a discovered, paired original Joy before connecting.');
    if (!(await deps.service().getStatus()).enabled)
      throw new Error('Experimental native Joy is disabled.');
    if (!(await deps.confirmHardware())) return { canceled: true };
    idle(); // A legacy cutter session may have started while the dialog was open.
    return deps.service().connect({ address, hardwareApproved: true, cryptoResetApproved: true });
  });
  deps.register('native-joy:connect-for-make', async (event, input) => {
    trusted(event);
    idle();
    if (
      input !== undefined &&
      (!input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input as object).some((k) => k !== 'address') ||
        typeof (input as { address?: unknown }).address !== 'string' ||
        !/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test((input as { address: string }).address))
    )
      throw new Error('Invalid Bluetooth address.');
    if (makeAttempt?.pending) throw Error('Connection attempt already pending.');
    const attempt: Attempt = {
      service: deps.service(),
      owner: {},
      canceled: false,
      pending: true,
      started: false,
    };
    makeAttempt = attempt;
    const service = attempt.service;
    try {
      const status = await service.getStatus();
      if (attempt.canceled) return { canceled: true };
      idle();
      if (deps.service() !== service) throw Error('Native Joy session changed.');
      if (!status.enabled) throw Error('Native Joy is unavailable.');
      const context = service.inlineActionIdentity;
      const approved = await deps.confirmHardware();
      if (attempt.canceled || !approved) return { canceled: true };
      deps.assertCurrent?.('connect');
      const ensure = async (expectedIdentity = service.inlineActionIdentity) => {
        if (
          attempt.canceled ||
          deps.service() !== service ||
          expectedIdentity !== service.inlineActionIdentity
        )
          throw Error('Native Joy session changed during device setup.');
        idle();
        await deps.ensureDeviceSettings?.(
          () =>
            !attempt.canceled &&
            deps.service() === service &&
            expectedIdentity === service.inlineActionIdentity &&
            !deps.cutterBusy(),
        );
        if (
          attempt.canceled ||
          deps.service() !== service ||
          expectedIdentity !== service.inlineActionIdentity
        )
          throw Error('Native Joy session changed during device setup.');
      };
      if (status.session) {
        await ensure();
        return { status: 'connected', devices: [] };
      }
      const devices = (await deps.listDevices?.()) ?? [];
      if (attempt.canceled) return { canceled: true };
      idle();
      if (deps.service() !== service || context !== service.inlineActionIdentity)
        throw Error('Native Joy session changed during discovery.');
      deps.assertCurrent?.('connect');
      const compatible = devices.filter((d) => d.paired),
        chosen = (input as { address?: string } | undefined)?.address;
      if (chosen && !compatible.some((d) => d.id.toUpperCase() === chosen.toUpperCase()))
        throw Error('Choose a paired original Joy.');
      const candidates = chosen
        ? compatible.filter((d) => d.id.toUpperCase() === chosen.toUpperCase())
        : compatible;
      if (!candidates.length) return { status: 'not_found', devices: [] };
      if (candidates.length > 1) return { status: 'choose_device', devices: candidates };
      idle();
      deps.assertCurrent?.('connect');
      attempt.started = true;
      await service.connect(
        { address: candidates[0]!.id, hardwareApproved: true, cryptoResetApproved: true },
        attempt.owner,
      );
      if (attempt.canceled) return { canceled: true };
      await ensure();
      return { status: 'connected', devices: candidates };
    } catch (error) {
      if (attempt.canceled) return { canceled: true };
      throw error;
    } finally {
      attempt.pending = false;
      if ((!attempt.started || attempt.canceled) && makeAttempt === attempt) makeAttempt = null;
    }
  });
  deps.register('native-joy:poll-status', async (event) => {
    trusted(event);
    idle();
    return deps.service().pollStatus();
  });
  deps.register('native-joy:mat', async (event, input) => {
    trusted(event);
    idle();
    const action = (input as { action?: unknown } | null)?.action;
    if (action !== 'load' && action !== 'unload') throw new Error('Unsupported mat action.');
    if (!deps.confirmMat || !(await deps.confirmMat(action))) return { canceled: true };
    idle();
    const service = deps.service();
    if (!service.controlMat) throw new Error('Mat controls are unavailable in this runtime.');
    return service.controlMat(action, true);
  });
  deps.register('native-joy:disconnect', async (event) => {
    trusted(event);
    await deps.service().disconnect();
    return { state: 'disconnected' };
  });
}
