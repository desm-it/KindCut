import { BLADE_JOB_ID, requireBladeJob } from './joy-blade-job';
import fs from 'node:fs/promises';
import {
  readLoadingDiagnostics,
  readJobDiagnostics,
  type NativeJoyLoadingDiagnostics,
} from './native-joy-loading-diagnostics';
import { createHash } from 'node:crypto';
import { calibration, type JoyCalibration } from './joy-configuration-store';
import { constants } from 'node:fs';
import path from 'node:path';
import { JoyRuntimeClient } from './joy-runtime-client';
import type { ProvisioningBundle } from './joy-provisioning-store';
import { readJobState, type NativeJobState } from './native-joy-job-types';
import {
  NativeJoyLoadingActor,
  type LoadingState,
  type LoadingPhase,
} from './native-joy-loading-actor';
import { NativeJoyJobActor } from './native-joy-job-actor';
import { BLADE_TRIAL_ID, requireBladeTrial } from './joy-blade-trial';

export interface RuntimeClientPort {
  readonly isRunning: boolean;
  request(input: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
  abort?(): void;
}
interface StorePort {
  exists(): Promise<boolean>;
  save(bundle: ProvisioningBundle): Promise<void>;
  load(): Promise<ProvisioningBundle>;
}
export interface NativeJoySnapshot {
  state: 'ready';
  machine: 'cricut_joy';
  firmwareSelector: number;
  materialRecord: number;
  fallbackUsed: boolean;
  status: {
    status_byte_1: number;
    status_byte_2: number;
    extra_u16_raw: number;
    extra_u16_native: number;
    value_be32: number;
  };
}
export interface NativeJoySetup {
  experimental: true;
  enabled: boolean;
  runtimeAvailable: boolean;
  provisioned: boolean;
  provisioningSource?: 'bundled' | 'imported' | 'missing';
  platform: string;
  session: NativeJoySnapshot | null;
}
export type NativeJoyLoadingPhase = LoadingPhase;
export type NativeJoyLoadingState = LoadingState;
interface Options {
  platform: string;
  enabled: boolean;
  runtimePath: string;
  store: StorePort;
  preferImported?: boolean;
  clientFactory?: () => RuntimeClientPort;
}
const statusKeys = [
  'status_byte_1',
  'status_byte_2',
  'extra_u16_raw',
  'extra_u16_native',
  'value_be32',
] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid runtime metadata.');
  return value as Record<string, unknown>;
}
function snapshot(value: unknown): NativeJoySnapshot {
  const reply = object(value),
    status = object(reply.status);
  if (
    reply.state !== 'ready' ||
    reply.machine !== 'cricut_joy' ||
    typeof reply.firmwareSelector !== 'number' ||
    !Number.isFinite(reply.firmwareSelector) ||
    !Number.isInteger(reply.materialRecord) ||
    Number(reply.materialRecord) < 0 ||
    typeof reply.fallbackUsed !== 'boolean'
  )
    throw new Error('Invalid runtime session metadata.');
  for (const key of statusKeys)
    if (
      typeof status[key] !== 'number' ||
      !Number.isInteger(status[key]) ||
      Number(status[key]) < 0 ||
      Number(status[key]) > 0xffffffff
    )
      throw new Error('Invalid runtime status metadata.');
  return {
    state: 'ready',
    machine: 'cricut_joy',
    firmwareSelector: reply.firmwareSelector,
    materialRecord: Number(reply.materialRecord),
    fallbackUsed: reply.fallbackUsed,
    status: {
      status_byte_1: Number(status.status_byte_1),
      status_byte_2: Number(status.status_byte_2),
      extra_u16_raw: Number(status.extra_u16_raw),
      extra_u16_native: Number(status.extra_u16_native),
      value_be32: Number(status.value_be32),
    },
  };
}

/** Main-process only. Never forwards provisioning bundles, paths or raw logs to renderer. */
type MakeConnectionScope = {
  owner: object;
  generation: number;
  client: RuntimeClientPort | null;
  cancelled: boolean;
  retirement?: Promise<void>;
};
export class NativeJoyService {
  private client: RuntimeClientPort | null = null;
  private makeConnection: MakeConnectionScope | null = null;
  private session: NativeJoySnapshot | null = null;
  private deviceFingerprint: string | null = null;
  private busy = false;
  private connecting = false;
  private generation = 0;
  private useImported: boolean;
  private readonly loadingActor = new NativeJoyLoadingActor();
  private readonly jobActor = new NativeJoyJobActor();
  private get loading(): NativeJoyLoadingState {
    return this.loadingActor.state;
  }
  private set loading(state: NativeJoyLoadingState) {
    this.loadingActor.replace(state);
  }
  private offlineReserved = false;
  private disconnecting = false;
  private disconnectPromise: Promise<void> | null = null;
  private disposed = false;
  get ownsJob() {
    return this.jobActor.reserved || this.jobActor.starting || this.jobActor.state.active;
  }
  get ownsHardware() {
    return (
      this.session !== null ||
      this.connecting ||
      this.loading.active ||
      this.loadingActor.reserved ||
      this.offlineReserved ||
      this.jobActor.reserved ||
      this.jobActor.starting ||
      this.jobActor.state.active ||
      this.disconnecting
    );
  }
  get currentDeviceFingerprint(): string | null {
    return this.deviceFingerprint;
  }
  loadingApprovalContext(): number {
    this.hardware();
    this.noLoading();
    if (
      this.busy ||
      !this.session ||
      !this.client ||
      this.session.firmwareSelector !== 8.164000001 ||
      this.session.fallbackUsed
    )
      throw new Error('An exact initialized original Joy session is required.');
    return this.generation;
  }
  async startLoading(
    heightInches: 6.5 | 12,
    approved: boolean,
    bladeRemovedConfirmed: boolean,
    approvalContext?: number,
  ): Promise<NativeJoyLoadingState> {
    const generation = this.loadingApprovalContext();
    if (approved !== true || bladeRemovedConfirmed !== true)
      throw new Error('Host loading approval required.');
    if (heightInches !== 6.5 && heightInches !== 12) throw new Error('Unsupported loading height.');
    if (approvalContext !== undefined && approvalContext !== generation)
      throw new Error('Loading approval belongs to a different session.');
    const client = this.client!;
    this.loadingActor.reserve(true);
    return this.queueLoading(async () =>
      this.loadingExchange(
        client,
        generation,
        {
          op: 'loading',
          action: 'start',
          heightInches,
          timeout: 30,
          motionApproved: true,
          bladeRemovedConfirmed: true,
        },
        true,
      ),
    );
  }
  getLoadingState(): NativeJoyLoadingState {
    return {
      ...this.loading,
      ...(this.loading.diagnostics
        ? {
            diagnostics: readLoadingDiagnostics(this.loading.diagnostics, this.loading.operationId),
          }
        : {}),
    };
  }
  async loadingStatus(): Promise<NativeJoyLoadingState> {
    if (!this.loading.active && !this.loadingActor.reserved) return this.getLoadingState();
    this.hardware();
    const client = this.client;
    if (!client) throw new Error('Loading session unavailable.');
    const generation = this.generation;
    return this.queueLoading(async () => {
      if (!this.loading.active && !this.loadingActor.reserved) return this.getLoadingState();
      return this.loadingExchange(client, generation, { op: 'loading', action: 'status' });
    });
  }
  async controlLoading(action: 'go' | 'cancel'): Promise<NativeJoyLoadingState> {
    this.hardware();
    if (action !== 'go' && action !== 'cancel') throw new Error('Invalid loading control.');
    const client = this.client,
      generation = this.generation,
      operationId = this.loading.operationId;
    if (!client || !this.loading.active) throw new Error('No active loading operation.');
    return this.queueLoading(async () => {
      this.currentLoading(client, generation);
      if (!this.loading.active || operationId !== this.loading.operationId)
        throw new Error('Loading operation already ended.');
      if (action === 'go' && this.loading.phase !== 'waiting_for_go')
        throw new Error('Loading has not reached the host-Go wait.');
      if (action === 'go') this.loadingActor.markRequested('go', true);
      else this.loadingActor.markRequested('cancel', true);
      return this.loadingExchange(client, generation, { op: 'loading', action, operationId });
    });
  }
  private queueLoading<T>(run: () => Promise<T>): Promise<T> {
    return this.loadingActor.enqueue(run);
  }
  private currentLoading(client: RuntimeClientPort, generation: number) {
    if (
      this.disposed ||
      this.disconnecting ||
      generation !== this.generation ||
      client !== this.client
    )
      throw new Error('Loading session changed.');
  }
  private async loadingExchange(
    client: RuntimeClientPort,
    generation: number,
    request: Record<string, unknown>,
    starting = false,
  ): Promise<NativeJoyLoadingState> {
    this.currentLoading(client, generation);
    this.busy = true;
    try {
      const raw = await client.request(request, 5000);
      this.currentLoading(client, generation);
      const next = this.loadingActor.accept(object(raw), starting, {
        goRequested: this.loadingActor.goRequested,
        cancelRequested: this.loadingActor.cancelRequested,
      });
      this.loading = next;
      if (next.sessionRetired) {
        // Keep the host reservation through process retirement, not just receipt.
        this.loadingActor.reserve(true);
        this.session = null;
        await client.close();
        this.currentLoading(client, generation);
        this.client = null;
      }
      this.loadingActor.reserve(next.active);
      return this.getLoadingState();
    } catch {
      if (
        generation === this.generation &&
        this.client === client &&
        !this.disconnecting &&
        !this.disposed
      ) {
        this.loadingActor.reserve(true);
        let closed = false;
        try {
          await client.close();
          closed = true;
        } catch {
          /* Quarantine; never expose port errors. */
        }
        if (generation === this.generation && this.client === client) {
          this.client = closed ? null : client;
          this.session = null;
          this.loading = this.failedLoading();
          this.loadingActor.reserve(!closed);
        }
      }
      throw new Error('Experimental loading could not be completed; no automatic retry was made.');
    } finally {
      this.busy = false;
    }
  }
  private failedLoading(): NativeJoyLoadingState {
    const state = this.getLoadingState();
    if (state.diagnostics) {
      state.diagnostics.captureIncomplete = true;
      state.diagnostics.failure ??= {
        stage: state.diagnostics.lastStage,
        code: 'runtime_boundary_failed',
        errorType: 'RuntimeError',
      };
    }
    return {
      ...state,
      phase: 'failed',
      active: false,
      sessionRetired: true,
      physicalLoadingVerified: false,
      physicalAlignmentVerified: false,
      motionStoppedVerified: false,
      jobStarted: false,
    };
  }
  async runOfflineConfiguration(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const retained =
      !this.jobActor.endSent &&
      !this.jobActor.cancelSent &&
      this.jobActor.reserved &&
      this.jobActor.state.phase === 'retained_ready' &&
      this.jobActor.state.active &&
      this.jobActor.state.jobStarted &&
      this.jobActor.goSent &&
      this.jobActor.state.acceptedRecords === this.jobActor.state.totalRecords &&
      this.jobActor.state.completedPasses === this.jobActor.state.totalPasses &&
      !!this.client?.isRunning;
    if (this.disposed || this.disconnecting) throw new Error('Native runtime is closing.');
    if (
      request.op !== 'configuration' ||
      !['validate', 'compile', 'prepare_job'].includes(String(request.action))
    )
      throw new Error('Only offline configuration is permitted.');
    const connectedIdle =
      !!this.session &&
      !!this.client?.isRunning &&
      !this.jobActor.reserved &&
      !this.jobActor.state.active;
    if (
      this.loading.active ||
      this.loadingActor.reserved ||
      this.jobActor.starting ||
      (this.jobActor.state.active && !retained) ||
      this.busy ||
      (!retained &&
        (this.session || this.client) &&
        !(connectedIdle && request.action === 'prepare_job'))
    )
      throw new Error('Offline compiler is unavailable while hardware is owned.');
    if (retained && request.action !== 'prepare_job')
      throw new Error('Only prepare_job is permitted while a job is retained.');
    const generation = this.generation,
      live = this.client,
      client = this.newClient();
    this.busy = true;
    this.offlineReserved = true;
    try {
      const result = object(await client.request(request, 15000));
      await client.close();
      if (
        generation !== this.generation ||
        this.disposed ||
        (retained &&
          (live !== this.client ||
            !this.jobActor.reserved ||
            this.jobActor.state.phase !== 'retained_ready')) ||
        (connectedIdle && (live !== this.client || !this.session || this.jobActor.state.active))
      )
        throw new Error('Configuration preparation canceled.');
      this.offlineReserved = false;
      return result;
    } catch {
      try {
        await client.close();
      } catch {
        /* compiler process quarantined separately; never touch live owner */
      }
      if (generation === this.generation && !this.disposed) this.offlineReserved = false;
      throw new Error(
        'Offline configuration could not be prepared. No device operation was requested.',
      );
    } finally {
      this.busy = false;
    }
  }
  async captureCalibration(approved: boolean, context: number): Promise<JoyCalibration> {
    if (approved !== true) throw new Error('Fresh host approval required to read calibration.');
    const generation = this.loadingApprovalContext();
    if (context !== generation || !this.deviceFingerprint)
      throw new Error('Calibration approval belongs to another session.');
    const fingerprint = this.deviceFingerprint,
      client = this.client!;
    return this.operation(async () => {
      const r = object(
        await client.request(
          { op: 'calibration', action: 'read', readApproved: true, timeout: 8 },
          12000,
        ),
      );
      if (generation !== this.generation || this.disposed || client !== this.client)
        throw new Error('Calibration session changed.');
      if (r.source !== 'device_pressure_table_read' || r.physicalCalibrationVerified !== false)
        throw new Error('Invalid calibration provenance.');
      return calibration({
        id: `calibration-${fingerprint.slice(0, 24)}`,
        capturedAt: new Date().toISOString(),
        deviceFingerprint: fingerprint,
        firmwareSelector: r.firmwareSelector,
        source: r.source,
        physicalCalibrationVerified: false,
        pressureResponsesHex: r.pressureResponsesHex,
      });
    });
  }
  constructor(private readonly options: Options) {
    this.useImported = options.preferImported === true;
  }
  private newClient() {
    return (
      this.options.clientFactory?.() ??
      new JoyRuntimeClient({ executable: this.options.runtimePath })
    );
  }
  private async operation<T>(run: () => Promise<T>): Promise<T> {
    this.noLoading();
    if (this.busy) throw new Error('Native Joy is busy.');
    this.busy = true;
    try {
      return await run();
    } catch {
      const client = this.client,
        ownedRetirement =
          client && this.makeConnection?.client === client && this.makeConnection.retirement;
      let closed = !client;
      if (!ownedRetirement) {
        try {
          await client?.close();
          closed = true;
        } catch {}
      }
      this.client = closed ? null : client;
      this.session = null;
      this.deviceFingerprint = null;
      if (!closed) this.loadingActor.reserve(true);
      throw new Error('Native Joy operation could not be completed.');
    } finally {
      this.busy = false;
    }
  }
  private hardware() {
    if (this.disposed || this.disconnecting) throw new Error('Native Joy session is closing.');
    if (this.options.platform !== 'darwin' || this.options.enabled !== true)
      throw new Error('Experimental native Joy is disabled.');
  }
  private noLoading() {
    if (
      this.disposed ||
      this.disconnecting ||
      this.loading.active ||
      this.loadingActor.reserved ||
      this.offlineReserved ||
      this.jobActor.reserved ||
      this.jobActor.starting ||
      this.jobActor.state.active
    )
      throw new Error('Experimental loading owns or is retiring the Joy hardware.');
  }
  /** State generation for isolated-preload action receipts; metadata only. */
  get inlineActionIdentity(): string {
    return JSON.stringify([
      this.generation,
      this.jobActor.state.operationId,
      this.jobActor.state.phase,
      this.loading.operationId,
      this.loading.phase,
      this.jobActor.reserved,
      this.loadingActor.reserved,
    ]);
  }
  async getStatus(): Promise<NativeJoySetup> {
    let runtimeAvailable = false;
    try {
      const st = await fs.lstat(this.options.runtimePath);
      if (st.isFile()) {
        await fs.access(this.options.runtimePath, constants.X_OK);
        runtimeAvailable = true;
      }
    } catch {}
    if (this.session && this.client && !this.client.isRunning) this.session = null;
    const imported = this.useImported && (await this.options.store.exists());
    let bundled = false;
    try {
      bundled = (
        await fs.stat(
          path.join(path.dirname(this.options.runtimePath), '_internal/profiles/cricut-joy.json'),
        )
      ).isFile();
    } catch {}
    return {
      experimental: true,
      enabled: this.options.platform === 'darwin' && this.options.enabled,
      runtimeAvailable,
      provisioned: imported || bundled,
      provisioningSource: imported ? 'imported' : bundled ? 'bundled' : 'missing',
      platform: this.options.platform,
      session: this.session ? { ...this.session, status: { ...this.session.status } } : null,
    };
  }
  async importProvisioning(input: {
    sourcePath: string;
    approved: boolean;
  }): Promise<{ recordCount: number }> {
    if (input.approved !== true) throw new Error('Explicit material import approval required.');
    if (this.options.platform !== 'darwin')
      throw new Error('Native Joy provisioning currently requires macOS.');
    if (this.session)
      throw new Error('Disconnect the native Joy session before importing material.');
    return this.operation(async () => {
      const client = this.newClient();
      this.client = client;
      try {
        const result = object(
          await client.request(
            { op: 'provision', importApproved: true, sourcePath: input.sourcePath },
            15000,
          ),
        );
        if (
          !Number.isInteger(result.recordCount) ||
          Number(result.recordCount) < 1 ||
          Number(result.recordCount) > 4096
        )
          throw new Error('Invalid provisioning metadata.');
        await this.options.store.save(result.bundle as ProvisioningBundle);
        this.useImported = true; // Explicit Advanced import opts in for this app session.
        return { recordCount: Number(result.recordCount) };
      } finally {
        await client.close();
        if (this.client === client) this.client = null;
      }
    });
  }
  async connect(
    input: { address: string; hardwareApproved: boolean; cryptoResetApproved: boolean },
    owner?: object,
  ): Promise<NativeJoySnapshot> {
    this.hardware();
    if (input.hardwareApproved !== true || input.cryptoResetApproved !== true)
      throw new Error('Explicit Bluetooth and crypto-reset approvals required.');
    if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(input.address))
      throw new Error('Invalid Bluetooth address.');
    if (this.session) throw new Error('Native Joy session already active.');
    return this.operation(async () => {
      const generation = ++this.generation;
      this.connecting = true;
      const scope: MakeConnectionScope | null =
        owner === undefined ? null : { owner, generation, client: null, cancelled: false };
      this.makeConnection = scope;
      this.jobActor.replace({
        operationId: 0,
        phase: 'idle',
        active: false,
        sessionRetired: false,
        jobStarted: false,
        programDigest: null,
        tool: null,
        acceptedRecords: 0,
        completedPasses: 0,
        totalRecords: 0,
        totalPasses: 0,
        physicalCompletionVerified: false,
        motionStoppedVerified: false,
      });
      this.jobActor.markRequested('go', false);
      this.jobActor.markRequested('end', false);
      this.jobActor.markRequested('cancel', false);
      this.jobActor.markRequested('pause', false);
      this.jobActor.markRequested('resumePending', false);
      this.loading = {
        operationId: 0,
        phase: 'idle',
        active: false,
        sessionRetired: false,
        physicalLoadingVerified: false,
        physicalAlignmentVerified: false,
        motionStoppedVerified: false,
        jobStarted: false,
      };
      this.loadingActor.markRequested('go', false);
      this.loadingActor.markRequested('cancel', false);
      try {
        const bundle =
          this.useImported && (await this.options.store.exists())
            ? await this.options.store.load()
            : undefined;
        if (generation !== this.generation || scope?.cancelled)
          throw new Error('Connection canceled.');
        const client = this.newClient();
        this.client = client;
        if (scope) scope.client = client;
        const reply = await client.request(
          {
            op: 'connect',
            profileId: 'cricut-joy',
            address: input.address,
            hardwareApproved: true,
            cryptoResetApproved: true,
            ...(bundle ? { bundle } : {}),
            timeout: 20,
          },
          60000,
        );
        if (generation !== this.generation || scope?.cancelled)
          throw new Error('Connection canceled.');
        this.session = snapshot(reply);
        this.deviceFingerprint = createHash('sha256')
          .update(input.address.toUpperCase().replace(/-/g, ':'))
          .digest('hex');
        return { ...this.session, status: { ...this.session.status } };
      } catch (error) {
        if (scope && this.makeConnection === scope) await this.retireMakeConnection(scope);
        throw error;
      } finally {
        this.connecting = false;
      }
    });
  }
  /** Only a main-owned Make attempt can retire the exact client it created. */
  async cancelMakeConnection(owner: object): Promise<boolean> {
    const scope = this.makeConnection;
    if (
      !scope ||
      scope.owner !== owner ||
      this.jobActor.reserved ||
      this.jobActor.starting ||
      this.jobActor.state.active ||
      this.loadingActor.reserved ||
      this.loading.active ||
      this.offlineReserved ||
      this.disposed
    )
      return false;
    if (scope.retirement) {
      await scope.retirement;
      return true;
    }
    if (
      this.disconnecting ||
      this.generation !== scope.generation ||
      (this.busy && !this.connecting) ||
      scope.client !== this.client
    )
      return false;
    await this.retireMakeConnection(scope);
    return true;
  }
  private retireMakeConnection(scope: MakeConnectionScope): Promise<void> {
    if (scope.retirement) return scope.retirement;
    if (this.makeConnection !== scope || scope.client !== this.client) return Promise.resolve();
    const client = scope.client,
      disconnect = Boolean(client && this.session && !this.busy && !this.connecting);
    scope.cancelled = true;
    this.generation++;
    this.disconnecting = true;
    this.session = null;
    this.deviceFingerprint = null;
    scope.retirement = Promise.resolve().then(async () => {
      let closed = false;
      try {
        if (disconnect) {
          try {
            await client!.request({ op: 'disconnect' }, 3000);
          } catch {
            /* EOF still runs the owned worker's cleanup. */
          }
        }
        if (client) await client.close();
        closed = true;
      } finally {
        if (this.makeConnection === scope && this.client === client) {
          this.client = closed ? null : client;
          this.loadingActor.reserve(!closed);
          if (closed) this.makeConnection = null;
        }
        this.disconnecting = false;
        if (!closed)
          throw Error('Native Joy process retirement failed; hardware remains reserved.');
      }
    });
    return scope.retirement;
  }
  async pollStatus(): Promise<NativeJoySnapshot> {
    this.hardware();
    if (!this.session || !this.client) throw new Error('No approved native Joy session.');
    return this.operation(async () => {
      const generation = this.generation,
        client = this.client!;
      const reply = await client.request({ op: 'status', timeout: 2 }, 5000);
      if (generation !== this.generation || client !== this.client)
        throw new Error('Status session changed.');
      this.session = snapshot(reply);
      return { ...this.session, status: { ...this.session.status } };
    });
  }
  async controlMat(
    action: 'load' | 'unload',
    approved: boolean,
  ): Promise<{ requestAcknowledged: boolean; matPresenceVerified: false; responseCode?: number }> {
    this.hardware();
    if (approved !== true) throw new Error('Explicit roller-motion approval required.');
    if (action !== 'load' && action !== 'unload') throw new Error('Unsupported mat action.');
    if (!this.session || !this.client)
      throw new Error('Connect the Joy before controlling its mat.');
    return this.operation(async () => {
      const generation = this.generation;
      const reply = object(
        await this.client!.request({ op: 'mat', action, motionApproved: true, timeout: 8 }, 15000),
      );
      if (generation !== this.generation) throw new Error('Mat operation canceled.');
      if (typeof reply.requestAcknowledged !== 'boolean' || reply.matPresenceVerified !== false)
        throw new Error('Invalid mat acknowledgement.');
      if (
        !reply.requestAcknowledged &&
        (!Number.isInteger(reply.responseCode) ||
          Number(reply.responseCode) < 0 ||
          Number(reply.responseCode) > 255)
      )
        throw new Error('Invalid mat rejection.');
      this.session = snapshot(reply);
      return {
        requestAcknowledged: reply.requestAcknowledged,
        matPresenceVerified: false,
        ...(!reply.requestAcknowledged ? { responseCode: Number(reply.responseCode) } : {}),
      };
    });
  }
  async disconnect(): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise;
    this.generation++;
    this.connecting = false;
    this.disconnecting = true;
    const generation = this.generation,
      client = this.client,
      wasLoading = this.loading.active || this.loadingActor.reserved,
      wasJob = this.jobActor.state.active || this.jobActor.reserved || this.jobActor.starting;
    const ending = Promise.resolve().then(async () => {
      let closed = false;
      try {
        if (client && wasJob) {
          await this.jobActor.settled();
          if (client === this.client && client.isRunning) {
            let observed = readJobState(
              await client.request({ op: 'job', action: 'status' }, 1500),
            );
            const id = observed.operationId;
            if (observed.active) {
              this.jobActor.markRequested('cancel', true);
              readJobState(
                await client.request({ op: 'job', action: 'cancel', operationId: id }, 1500),
              );
              const deadline = Date.now() + 6000;
              do {
                const left = deadline - Date.now();
                if (left <= 0) throw Error('Job cleanup deadline.');
                observed = readJobState(
                  await client.request({ op: 'job', action: 'status' }, Math.min(left, 1500)),
                );
                if (observed.operationId !== id) throw Error('Job identity changed.');
                if (observed.active) await new Promise<void>((r) => setTimeout(r, 25));
              } while (observed.active);
            }
            if (generation === this.generation && !this.disposed) this.jobActor.replace(observed);
          }
        } else if (client && wasLoading) {
          // Let the single-pending port finish its current metadata/start request.
          // Its stale result is generation-rejected, never published or replayed.
          await this.loadingActor.settled();
          let observed = this.loadingActor.accept(
            object(await client.request({ op: 'loading', action: 'status' }, 1500)),
            false,
            {
              goRequested: this.loadingActor.goRequested,
              cancelRequested: this.loadingActor.cancelRequested,
            },
          );
          if (observed.active) {
            this.loadingActor.markRequested('cancel', true);
            const id = observed.operationId;
            this.loadingActor.accept(
              object(
                await client.request({ op: 'loading', action: 'cancel', operationId: id }, 1500),
              ),
              false,
              { goRequested: this.loadingActor.goRequested, cancelRequested: true },
            );
            const deadline = Date.now() + 6000;
            do {
              const remaining = deadline - Date.now();
              if (remaining <= 0) throw new Error('Loading cleanup deadline.');
              observed = this.loadingActor.accept(
                object(
                  await client.request(
                    { op: 'loading', action: 'status' },
                    Math.min(1500, remaining),
                  ),
                ),
                false,
                { goRequested: this.loadingActor.goRequested, cancelRequested: true },
              );
              if (observed.operationId !== id) throw new Error('Loading owner changed.');
              if (observed.active) await new Promise<void>((resolve) => setTimeout(resolve, 25));
            } while (observed.active);
          }
          if (generation === this.generation && !this.disposed) this.loading = observed;
          if (!observed.sessionRetired && client.isRunning)
            await client.request({ op: 'disconnect' }, 1500);
        } else if (client && !this.busy && client.isRunning) {
          await client.request({ op: 'disconnect' }, 3000);
        }
      } catch {
        if (generation === this.generation && !this.disposed) this.loading = this.failedLoading();
        // Closing the pipe gives the worker owner its cancellation/EOF path.
        // This is not a claim that motors have physically stopped.
      } finally {
        try {
          if (client) await client.close();
          closed = true;
        } finally {
          if (generation === this.generation && !this.disposed) {
            this.client = closed ? null : client;
            this.session = null;
            if (this.loading.active) this.loading = this.failedLoading();
            this.loadingActor.reserve(!closed);
            this.jobActor.reserve(!closed);
            this.jobActor.markStarting(false);
            if (this.jobActor.state.active) this.jobActor.replace(this.failedJob());
            this.deviceFingerprint = null;
            this.offlineReserved = this.offlineReserved && !closed; // quarantine if process retirement failed
          }
        }
      }
    });
    this.disconnectPromise = ending;
    try {
      await ending;
    } catch {
      throw new Error('Native Joy process retirement failed; hardware remains reserved.');
    } finally {
      this.disconnecting = false;
      this.disconnectPromise = null;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.connecting = false;
    this.session = null;
    this.loading = this.failedLoading();
    this.loadingActor.reserve(false);
    this.offlineReserved = false;
    this.jobActor.replace(this.failedJob());
    this.jobActor.reserve(false);
    this.jobActor.markStarting(false);
    const client = this.client;
    this.client = null;
    if (client?.abort) client.abort();
    else void client?.close().catch(() => {});
  }
  reserveJobApproval(): { generation: number; token: number; deviceFingerprint: string } {
    const generation = this.loadingApprovalContext();
    if (!this.deviceFingerprint || !this.client?.isRunning)
      throw Error('Current device binding unavailable.');
    this.jobActor.reserve(true);
    return {
      generation,
      token: this.jobActor.nextToken(),
      deviceFingerprint: this.deviceFingerprint,
    };
  }
  releaseJobApproval(c: { generation: number; token: number; deviceFingerprint: string }): void {
    if (
      c.generation === this.generation &&
      c.token === this.jobActor.generation &&
      c.deviceFingerprint === this.deviceFingerprint &&
      !this.jobActor.state.active &&
      !this.jobActor.starting
    )
      this.jobActor.reserve(false);
  }
  private validJobContext(c: { generation: number; token: number; deviceFingerprint: string }) {
    return (
      !this.disposed &&
      !this.disconnecting &&
      this.jobActor.reserved &&
      c.generation === this.generation &&
      c.token === this.jobActor.generation &&
      c.deviceFingerprint === this.deviceFingerprint &&
      !!this.session &&
      !!this.client?.isRunning
    );
  }
  private queueJob<T>(fn: () => Promise<T>): Promise<T> {
    return this.jobActor.enqueue(fn);
  }
  private currentJob(c: RuntimeClientPort, g: number) {
    if (this.disposed || this.disconnecting || g !== this.generation || c !== this.client)
      throw Error('Job session changed.');
  }
  private failedJob(): NativeJobState {
    const s = this.getJobState();
    if (s.diagnostics) {
      s.diagnostics.captureIncomplete = true;
      s.diagnostics.failure ??= {
        stage: s.diagnostics.lastStage,
        code: 'runtime_boundary_failed',
        errorType: 'RuntimeError',
      };
    }
    return {
      ...s,
      phase: 'failed',
      active: false,
      sessionRetired: true,
      physicalCompletionVerified: false,
      motionStoppedVerified: false,
    };
  }
  private async jobExchange(
    c: RuntimeClientPort,
    g: number,
    request: Record<string, unknown>,
    starting = false,
  ): Promise<NativeJobState> {
    this.currentJob(c, g);
    this.busy = true;
    try {
      const next = readJobState(await c.request(request, 5000));
      this.currentJob(c, g);
      this.jobActor.observe(next, starting, request);

      if (next.sessionRetired) {
        this.jobActor.reserve(true);
        this.session = null;
        await c.close();
        this.currentJob(c, g);
        this.client = null;
        this.deviceFingerprint = null;
      }
      this.jobActor.reserve(next.active);
      return this.getJobState();
    } catch {
      if (g === this.generation && c === this.client && !this.disconnecting && !this.disposed) {
        this.jobActor.reserve(true);
        this.session = null;
        let closed = false;
        try {
          await c.close();
          closed = true;
        } catch {
          /* Quarantine an uncertain live process. */
        }
        if (g === this.generation && c === this.client) {
          this.client = closed ? null : c;
          this.jobActor.reserve(!closed);
          this.deviceFingerprint = null;
          this.jobActor.replace(this.failedJob());
        }
      }
      throw Error('Native job failed or its state became uncertain; no retry was sent.');
    } finally {
      this.busy = false;
    }
  }
  async startJob(
    request: Record<string, unknown>,
    context: { generation: number; token: number; deviceFingerprint: string },
  ): Promise<NativeJobState> {
    const trial = request.bladeTrial === BLADE_TRIAL_ID,
      general = request.bladeJob === BLADE_JOB_ID,
      blade = trial || general;
    const allowed = [
      'op',
      'action',
      'plan',
      'settings',
      'pressureResponsesHex',
      'pressureRequests',
      'programDigest',
      'motionApproved',
      'bladeRemovedConfirmed',
      'timeout',
      'jobTimeout',
      ...(trial ? ['bladeTrial'] : general ? ['bladeJob'] : []),
    ];
    if (
      Object.keys(request).length !== allowed.length ||
      Object.keys(request).some((k) => !allowed.includes(k)) ||
      request.op !== 'job' ||
      request.action !== 'start' ||
      request.timeout !== 30 ||
      request.jobTimeout !== 60 ||
      request.motionApproved !== true ||
      request.bladeRemovedConfirmed !== true ||
      typeof request.programDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(request.programDigest) ||
      !Array.isArray(request.pressureRequests) ||
      !request.pressureRequests.length ||
      (!blade && (request.settings as { tool?: unknown } | null)?.tool !== 'pen') ||
      (blade && (request.settings as { tool?: unknown } | null)?.tool !== 'fine_point_blade')
    )
      throw Error('Invalid trusted job admission.');
    if (blade)
      (trial ? requireBladeTrial : requireBladeJob)(
        request.plan,
        request.settings,
        request.pressureRequests,
      );
    if (
      !this.validJobContext(context) ||
      this.busy ||
      this.jobActor.starting ||
      this.jobActor.state.active ||
      !this.client
    )
      throw Error('Job approval is stale or busy.');
    const c = this.client,
      g = this.generation,
      payload = structuredClone(request);
    this.jobActor.bind(structuredClone(request));
    this.jobActor.markStarting(true);
    this.jobActor.markRequested('go', false);
    this.jobActor.markRequested('end', false);
    this.jobActor.markRequested('cancel', false);
    this.jobActor.markRequested('pause', false);
    this.jobActor.markRequested('resumePending', false);
    try {
      return await this.queueJob(() => {
        if (!this.validJobContext(context)) throw Error('Job approval expired.');
        return this.jobExchange(c, g, payload, true);
      });
    } finally {
      this.jobActor.markStarting(false);
    }
  }
  async startNextJob(
    request: Record<string, unknown>,
    context: { generation: number; operationId: number; deviceFingerprint: string },
    beforeDispatch?: () => Promise<void>,
  ): Promise<NativeJobState> {
    if (this.jobActor.binding?.bladeTrial === BLADE_TRIAL_ID)
      throw Error('The blade trial permits no next action.');
    const blade = (request.settings as { tool?: unknown } | null)?.tool === 'fine_point_blade',
      trial = request.bladeTrial === BLADE_TRIAL_ID,
      general = request.bladeJob === BLADE_JOB_ID;
    const allowed = [
      'op',
      'action',
      'operationId',
      'plan',
      'settings',
      'pressureResponsesHex',
      'pressureRequests',
      'programDigest',
      'jobTimeout',
      ...(trial ? ['bladeTrial'] : general ? ['bladeJob'] : []),
    ];
    if (
      Object.keys(request).length !== allowed.length ||
      Object.keys(request).some((k) => !allowed.includes(k)) ||
      request.op !== 'job' ||
      request.action !== 'next' ||
      request.jobTimeout !== 60 ||
      !Number.isSafeInteger(request.operationId) ||
      typeof request.programDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(request.programDigest) ||
      !Array.isArray(request.pressureRequests) ||
      !request.pressureRequests.length ||
      (!blade && (request.settings as { tool?: unknown } | null)?.tool !== 'pen') ||
      !this.jobActor.binding ||
      request.settings === undefined ||
      !Array.isArray(request.pressureResponsesHex)
    )
      throw Error('Invalid next-action admission.');
    const prior = this.jobActor.binding;
    if (blade) {
      if (
        !(trial || general) ||
        this.jobActor.state.tool !== 'pen' ||
        this.jobActor.state.returnToOrigin !== 'protocol_complete'
      )
        throw Error('Returned pen owner required for blade continuation.');
      (trial ? requireBladeTrial : requireBladeJob)(
        request.plan,
        request.settings,
        request.pressureRequests,
      );
    }
    const oldPlan = prior.plan as { mat?: unknown; coordinateFrame?: unknown } | undefined,
      newPlan = request.plan as { mat?: unknown; coordinateFrame?: unknown } | undefined;
    if (
      JSON.stringify(oldPlan?.mat) !== JSON.stringify(newPlan?.mat) ||
      oldPlan?.coordinateFrame !== newPlan?.coordinateFrame
    )
      throw Error('Next action changed loaded mat/frame.');
    if (
      (blade
        ? (request.settings as { materialId?: unknown }).materialId !==
          (prior.settings as { materialId?: unknown }).materialId
        : JSON.stringify(request.settings) !== JSON.stringify(prior.settings)) ||
      JSON.stringify(request.pressureResponsesHex) !== JSON.stringify(prior.pressureResponsesHex)
    )
      throw Error('Next action changed loaded material or calibration binding.');
    const retained =
      !this.jobActor.endSent &&
      !this.jobActor.cancelSent &&
      this.jobActor.state.phase === 'retained_ready' &&
      this.jobActor.state.active &&
      this.jobActor.state.jobStarted &&
      this.jobActor.goSent &&
      this.jobActor.state.acceptedRecords === this.jobActor.state.totalRecords &&
      this.jobActor.state.completedPasses === this.jobActor.state.totalPasses &&
      this.jobActor.reserved &&
      !!this.session &&
      !!this.client?.isRunning;
    if (
      !retained ||
      this.busy ||
      this.jobActor.starting ||
      context.generation !== this.generation ||
      context.operationId !== this.jobActor.state.operationId ||
      context.deviceFingerprint !== this.deviceFingerprint ||
      !this.deviceFingerprint ||
      request.operationId !== this.jobActor.state.operationId
    )
      throw Error('Retained job approval is stale or busy.');
    const c = this.client!,
      g = this.generation,
      payload = structuredClone(request);
    return this.queueJob(async () => {
      if (beforeDispatch) await beforeDispatch();
      this.currentJob(c, g);
      if (
        this.jobActor.endSent ||
        this.jobActor.cancelSent ||
        !this.jobActor.reserved ||
        !this.session ||
        this.jobActor.state.phase !== 'retained_ready' ||
        this.jobActor.state.operationId !== context.operationId ||
        context.deviceFingerprint !== this.deviceFingerprint
      )
        throw Error('Retained ownership changed during source validation.');
      this.jobActor.markStarting(true);
      this.jobActor.markRequested('go', false);
      this.jobActor.markRequested('end', false);
      this.jobActor.markRequested('cancel', false);
      this.jobActor.markRequested('pause', false);
      this.jobActor.markRequested('resumePending', false);
      try {
        const state = await this.jobExchange(c, g, payload, true);
        this.jobActor.bind(structuredClone(payload));
        return state;
      } finally {
        this.jobActor.markStarting(false);
      }
    });
  }
  jobRetainedApprovalContext(): {
    generation: number;
    operationId: number;
    deviceFingerprint: string;
  } {
    this.hardware();
    if (
      this.disposed ||
      this.disconnecting ||
      this.jobActor.endSent ||
      this.jobActor.cancelSent ||
      !this.client?.isRunning ||
      !this.session ||
      !this.deviceFingerprint ||
      !this.jobActor.reserved ||
      !this.jobActor.state.active ||
      this.jobActor.state.phase !== 'retained_ready' ||
      !this.jobActor.goSent ||
      this.jobActor.state.acceptedRecords !== this.jobActor.state.totalRecords ||
      this.jobActor.state.completedPasses !== this.jobActor.state.totalPasses
    )
      throw Error('No healthy retained job awaits a next action.');
    return {
      generation: this.generation,
      operationId: this.jobActor.state.operationId,
      deviceFingerprint: this.deviceFingerprint,
    };
  }
  jobGoApprovalContext(): { generation: number; operationId: number } {
    this.hardware();
    if (
      !this.client ||
      !this.jobActor.reserved ||
      !this.jobActor.state.active ||
      this.jobActor.state.phase !== 'waiting_for_go' ||
      this.jobActor.goSent
    )
      throw Error('No job awaiting tool confirmation.');
    return { generation: this.generation, operationId: this.jobActor.state.operationId };
  }
  jobResumeApprovalContext(): { generation: number; operationId: number } {
    this.hardware();
    if (
      !this.client ||
      !this.session ||
      !this.jobActor.reserved ||
      !this.jobActor.state.active ||
      this.jobActor.state.phase !== 'paused' ||
      !this.jobActor.goSent ||
      !this.jobActor.pauseSent ||
      this.jobActor.resumePending ||
      this.jobActor.cancelSent
    )
      throw Error('No healthy owned queue pause awaits clearance.');
    return { generation: this.generation, operationId: this.jobActor.state.operationId };
  }
  async controlJob(
    action: 'go' | 'cancel' | 'pause' | 'resume' | 'end',
    approved?: boolean,
    context?: { generation: number; operationId: number },
    beforeDispatch?: () => Promise<void>,
  ): Promise<NativeJobState> {
    this.hardware();
    if (!['go', 'cancel', 'pause', 'resume', 'end'].includes(action))
      throw Error('Unsupported job control.');
    const c = this.client,
      g = this.generation,
      id = this.jobActor.state.operationId;
    if (action === 'end') {
      if (
        this.jobActor.endSent ||
        this.jobActor.cancelSent ||
        approved !== true ||
        !context ||
        context.generation !== g ||
        context.operationId !== id ||
        !c ||
        !this.jobActor.reserved ||
        !this.session ||
        !this.jobActor.goSent ||
        this.jobActor.state.phase !== 'retained_ready' ||
        this.jobActor.state.acceptedRecords !== this.jobActor.state.totalRecords ||
        this.jobActor.state.completedPasses !== this.jobActor.state.totalPasses
      )
        throw Error('Fresh approval for the retained job is required to end it.');
      return this.queueJob(async () => {
        this.currentJob(c, g);
        if (
          this.jobActor.endSent ||
          this.jobActor.cancelSent ||
          !this.jobActor.reserved ||
          this.jobActor.state.phase !== 'retained_ready' ||
          this.jobActor.state.operationId !== id
        )
          throw Error('Retained job changed before End.');
        this.jobActor.markRequested('end', true);
        return this.jobExchange(c, g, {
          op: 'job',
          action: 'end',
          operationId: id,
          endApproved: true,
        });
      });
    }
    if (
      (action === 'pause' || action === 'resume') &&
      (this.jobActor.binding?.settings as { tool?: unknown })?.tool === 'fine_point_blade'
    )
      throw Error('Pause and resume are disabled for the blade trial.');
    if (!c || !this.jobActor.state.active || !this.jobActor.reserved) throw Error('No active job.');
    return this.queueJob(async () => {
      this.currentJob(c, g);
      if (!this.jobActor.state.active || this.jobActor.state.operationId !== id)
        throw Error('Job already ended.');
      if (beforeDispatch) {
        if (!['go', 'resume'].includes(action))
          throw Error('Dispatch clearance only applies to continuation.');
        await beforeDispatch();
        this.currentJob(c, g);
        if (!this.jobActor.state.active || this.jobActor.state.operationId !== id)
          throw Error('Job ownership changed during dispatch clearance.');
      }
      if (action === 'go') {
        if (
          approved !== true ||
          !context ||
          context.generation !== g ||
          context.operationId !== id ||
          this.jobActor.goSent ||
          this.jobActor.state.phase !== 'waiting_for_go' ||
          (this.jobActor.binding?.bladeTrial === BLADE_TRIAL_ID &&
            this.jobActor.binding.settings === undefined)
        )
          throw Error('Fresh matching host Go required.');
        this.jobActor.markRequested('go', true);
      } else if (action === 'pause') {
        if (
          !this.jobActor.goSent ||
          this.jobActor.cancelSent ||
          this.jobActor.pauseSent ||
          this.jobActor.resumePending ||
          !this.jobActor.state.jobStarted ||
          !['setting_up', 'sending', 'draining'].includes(this.jobActor.state.phase)
        )
          throw Error('Queue pause unavailable.');
        this.jobActor.markRequested('pause', true);
      } else if (action === 'resume') {
        const valid = this.jobResumeApprovalContext();
        if (
          approved !== true ||
          !context ||
          context.generation !== valid.generation ||
          context.operationId !== valid.operationId
        )
          throw Error('Fresh matching resume clearance required.');
        this.jobActor.markRequested('resumePending', true);
      } else {
        if (this.jobActor.cancelSent) throw Error('Job cancellation already requested.');
        this.jobActor.markRequested('cancel', true);
      }
      const bladeTrial =
        (this.jobActor.binding?.settings as { tool?: unknown })?.tool === 'fine_point_blade';
      return this.jobExchange(c, g, {
        op: 'job',
        action,
        operationId: id,
        ...(action === 'go'
          ? { toolConfirmed: true, ...(bladeTrial ? { bladeInstalledConfirmed: true } : {}) }
          : action === 'resume'
            ? { resumeApproved: true }
            : {}),
      });
    });
  }
  async jobStatus(): Promise<NativeJobState> {
    if (!this.jobActor.state.active && !this.jobActor.starting) return this.getJobState();
    const c = this.client,
      g = this.generation;
    if (!c) throw Error('Job runtime unavailable.');
    return this.queueJob(async () => {
      if (!this.jobActor.state.active && !this.jobActor.starting) return this.getJobState();
      return this.jobExchange(c, g, { op: 'job', action: 'status' });
    });
  }
  getJobState(): NativeJobState {
    return {
      ...this.jobActor.state,
      ...(this.jobActor.state.diagnostics
        ? {
            diagnostics: readJobDiagnostics(
              this.jobActor.state.diagnostics,
              this.jobActor.state.operationId,
            ),
          }
        : {}),
    };
  }
}
