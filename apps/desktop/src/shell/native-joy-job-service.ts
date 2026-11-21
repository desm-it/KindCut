import type { NativeJoyPlan } from '@cricut-companion/craft-core';
import { partitionNativeJoyActions } from './native-joy-action-plan';
import { startJobRequest, nextJobRequest } from './native-joy-rpc';
import { BLADE_JOB_ID, requireBladeJob } from './joy-blade-job';
import { createHash, randomUUID } from 'node:crypto';
import { compileNormalizedSvgForJoy } from '@cricut-companion/svg-preflight';
import {
  calibration,
  library,
  record,
  exact,
  identifier,
  type JoyConfigurationLibrary,
  type JoySettingsProfile,
  type JoyCalibration,
} from './joy-configuration-store';
import type { NativeConfigurationSource } from './native-joy-configuration-types';
import {
  readJobMetadata,
  type NativeJobMetadata,
  type NativeJobState,
} from './native-joy-job-types';

type Approval = { generation: number; token: number; deviceFingerprint: string };
type RetainedContext = { generation: number; operationId: number; deviceFingerprint: string };
type NativePort = {
  runOfflineConfiguration(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  reserveJobApproval(): Approval;
  releaseJobApproval(ctx: Approval): void;
  startJob(request: Record<string, unknown>, ctx: Approval): Promise<NativeJobState>;
  jobGoApprovalContext(): { generation: number; operationId: number };
  jobResumeApprovalContext?(): { generation: number; operationId: number };
  jobRetainedApprovalContext?(): RetainedContext;
  startNextJob?(
    request: Record<string, unknown>,
    ctx: RetainedContext,
    beforeDispatch?: () => Promise<void>,
  ): Promise<NativeJobState>;
  controlJob(
    action: 'go' | 'cancel' | 'pause' | 'resume' | 'end',
    approved?: boolean,
    ctx?: { generation: number; operationId: number },
    beforeDispatch?: () => Promise<void>,
  ): Promise<NativeJobState>;
  jobStatus(): Promise<NativeJobState>;
  getJobState(): NativeJobState;
  getLoadingState?(): { active: boolean };
};
type Options = {
  ensureMakeSelection?(
    materialId: number,
    tools: ReadonlyArray<'pen' | 'fine_point_blade'>,
  ): Promise<{ profileId: string; calibrationId: string }>;
  loadLibrary(): Promise<JoyConfigurationLibrary>;
  native: NativePort;
  legacyBusy(): boolean;
  confirmLoad(metadata: NativeJobMetadata): Promise<boolean>;
  confirmTool(metadata: NativeJobMetadata): Promise<boolean>;
  confirmResume?(metadata: NativeJobMetadata): Promise<boolean>;
  confirmEnd?(metadata: NativeJobMetadata): Promise<boolean>;
  journal: { preflight(): Promise<void>; observe(state: NativeJobState): Promise<void> };
  pollMs?: number | false;
};
type Prepared = {
  id: string;
  digest: string;
  sourceDigest: string;
  libraryDigest: string;
  profile: JoySettingsProfile;
  calibration: JoyCalibration;
  source: NativeConfigurationSource;
  plan: NativeJoyPlan;
  metadata: NativeJobMetadata;
  worker: Record<string, unknown>;
  generation: number;
  retained?: RetainedContext;
  selectionProfileId?: string;
  workflow?: { actions: Prepared[]; index: number };
};
const fail = () => new Error('Native Joy job is invalid, stale, incompatible or unavailable.');
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function cleanMetadata(v: unknown): NativeJobMetadata {
  return readJobMetadata(v);
}
function sourceValue(v: unknown): NativeConfigurationSource {
  const x = record(v);
  exact(x, ['svg', 'materialId', 'mat', 'strokeTools']);
  const m = record(x.mat),
    t = record(x.strokeTools);
  exact(
    m,
    Object.keys(m).includes('mode') ? ['widthIn', 'heightIn', 'mode'] : ['widthIn', 'heightIn'],
  );
  if (
    typeof x.svg !== 'string' ||
    x.svg.length > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(x.materialId) ||
    typeof m.widthIn !== 'number' ||
    typeof m.heightIn !== 'number' ||
    !Object.keys(t).length
  )
    throw fail();
  return structuredClone(x) as unknown as NativeConfigurationSource;
}
function current(lib: JoyConfigurationLibrary, profileId: string, calibrationId: string) {
  const p = lib.profiles.find((x) => x.id === profileId),
    c = lib.calibrations.find((x) => x.id === calibrationId);
  if (
    !p ||
    !c ||
    lib.selection?.profileId !== profileId ||
    lib.selection.calibrationId !== calibrationId
  )
    throw fail();
  return { profile: structuredClone(p), calibration: calibration(c) };
}
export class NativeJoyJobService {
  private generation = 0;
  private prepared: Prepared | null = null;
  private busy = false;
  private active: Prepared | null = null;
  private goPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private captureFailed = false;
  private cancellationSent = false;
  private retainedPersisted: string | null = null;
  private journalEpoch = 0;
  private transitioning = false;
  private workflowInvalidated = false;
  private loadedBinding: {
    generation: number;
    materialId: number;
    matDigest: string;
    calibrationDigest: string;
  } | null = null;
  constructor(private readonly o: Options) {}
  /** Private host gesture binding; never returned over IPC. */
  get inlineActionIdentity(): string {
    return JSON.stringify([
      this.generation,
      this.prepared?.id ?? null,
      this.active?.id ?? null,
      this.active?.workflow?.index ?? null,
    ]);
  }
  invalidate() {
    this.generation++;
    this.prepared = null;
    if (this.active?.workflow) this.workflowInvalidated = true;
  }
  private async snapshot(p: Prepared) {
    const lib = library(await this.o.loadLibrary());
    const pair = current(lib, p.selectionProfileId ?? p.profile.id, p.calibration.id);
    const actual = lib.profiles.find((x) => x.id === p.profile.id);
    if (
      digest(lib) !== p.libraryDigest ||
      !actual ||
      digest(actual) !== digest(p.profile) ||
      digest(pair.calibration) !== digest(p.calibration)
    )
      throw fail();
    return lib;
  }
  private decorate(state: NativeJobState, p = this.active): NativeJobState {
    return p?.metadata.workflow && state.programDigest === p.metadata.programDigest
      ? { ...state, workflow: structuredClone(p.metadata.workflow) }
      : state;
  }
  async prepareAutomatic(input: unknown): Promise<NativeJobMetadata & { jobId: string }> {
    const source = sourceValue(input),
      live = this.o.native.getJobState();
    if (
      this.busy ||
      this.disposed ||
      this.o.legacyBusy() ||
      this.o.native.getLoadingState?.().active
    )
      throw fail();
    if (live.active) {
      const prior = this.active;
      if (live.phase !== 'retained_ready' || !prior?.workflow) throw fail();
      return this.prepare({
        profileId: prior.selectionProfileId ?? prior.profile.id,
        calibrationId: prior.calibration.id,
        source,
      });
    }
    const gen = this.generation;
    let selection: { profileId: string; calibrationId: string } | null = null;
    this.busy = true;
    try {
      const plan = compileNormalizedSvgForJoy(source.svg, {
        materialId: source.materialId,
        mat: source.mat,
        strokeTools: source.strokeTools,
        boundsPolicy: 'clip',
      });
      if (!plan.groups.length) throw fail();
      selection = this.o.ensureMakeSelection
        ? await this.o.ensureMakeSelection(source.materialId, [
            ...new Set(plan.groups.map((g) => g.tool)),
          ])
        : (await this.o.loadLibrary()).selection;
      if (
        this.disposed ||
        this.generation !== gen ||
        this.o.legacyBusy() ||
        this.o.native.getJobState().active ||
        this.o.native.getLoadingState?.().active
      )
        throw fail();
    } finally {
      this.busy = false;
    }
    if (!selection) throw Error('A saved calibration is required. Complete setup in Settings.');
    return this.prepare({ ...selection, source });
  }
  async prepare(input: unknown): Promise<NativeJobMetadata & { jobId: string }> {
    const live = this.o.native.getJobState(),
      held = live.active && String(live.phase) === 'retained_ready';
    if (held && live.tool === 'fine_point_blade')
      throw Error('End the completed cut session before another action.');
    if (this.busy || this.disposed || (this.active && live.active && !held)) throw fail();
    const v = record(input);
    exact(v, ['profileId', 'calibrationId', 'source']);
    const profileId = identifier(v.profileId),
      calibrationId = identifier(v.calibrationId),
      source = sourceValue(v.source);
    const retained = held ? this.retainedContext() : undefined;
    if (held && this.active?.workflow) {
      const prior = this.active,
        w = prior.workflow!;
      if (
        this.workflowInvalidated ||
        live.returnToOrigin !== 'protocol_complete' ||
        profileId !== (prior.selectionProfileId ?? prior.profile.id) ||
        calibrationId !== prior.calibration.id ||
        digest(source) !== prior.sourceDigest ||
        w.index + 1 >= w.actions.length
      )
        throw fail();
      await this.snapshot(prior);
      this.checkLoadedBinding(source, prior.calibration, retained!);
      const gen = ++this.generation;
      this.prepared = null;
      const next = structuredClone(w.actions[w.index + 1]!);
      next.generation = gen;
      next.retained = retained;
      next.workflow = { actions: w.actions, index: w.index + 1 };
      next.metadata.workflow = {
        ...structuredClone(prior.metadata.workflow!),
        actionIndex: w.index + 1,
      };
      this.prepared = next;
      await this.recheckDispatch(next);
      return { ...structuredClone(next.metadata), jobId: next.id };
    }
    const gen = ++this.generation;
    this.prepared = null;
    const lib = library(await this.o.loadLibrary()),
      { profile: selected, calibration: c } = current(lib, profileId, calibrationId);
    if (
      source.materialId !== selected.settings.materialId ||
      selected.settings.profileId !== selected.id ||
      selected.settings.mode !== 'precision' ||
      c.firmwareSelector !== 8.164000001 ||
      c.physicalCalibrationVerified !== false ||
      c.pressureResponsesHex.length !== 16
    )
      throw fail();
    if (retained) this.checkLoadedBinding(source, c, retained);
    const full = compileNormalizedSvgForJoy(source.svg, {
      materialId: source.materialId,
      mat: source.mat,
      strokeTools: source.strokeTools,
      boundsPolicy: 'clip',
    });
    if (!full.groups.length || full.groups.length > 2)
      throw Error('Unsupported native tool groups.');
    const groups = partitionNativeJoyActions(full.groups),
      mixed = groups.length > 1;
    if (
      mixed &&
      (retained ||
        source.mat.widthIn > 4.5 ||
        !(
          (source.mat.mode === 'card' &&
            source.mat.widthIn === 4.5 &&
            source.mat.heightIn === 6.25) ||
          (source.mat.mode === undefined && [6.5, 12].includes(source.mat.heightIn))
        ) ||
        full.clipping.clippedPathIds.length ||
        full.clipping.omittedPathIds.length)
    )
      throw fail();
    // Validate every frozen action BEFORE the first offline compiler call or load.
    const drafts = groups.map((group) => {
      const matches = lib.profiles.filter(
        (p) =>
          p.settings.profileId === p.id &&
          p.settings.materialId === source.materialId &&
          p.settings.tool === group.tool &&
          p.settings.operation === group.operation &&
          p.settings.mode === 'precision',
      );
      const preferred = matches.find((p) => p.id === profileId),
        profile = structuredClone(preferred ?? (matches.length === 1 ? matches[0] : undefined));
      if (!profile)
        throw Error(
          `Select an unambiguous saved ${group.tool} profile for this material before preparing.`,
        );
      if (!mixed && profile.id !== profileId) throw fail();
      if (retained && profile.settings.tool !== 'pen')
        throw Error(
          'A retained blade continuation must belong to the original frozen combined job.',
        );
      const presses = profile.recipe?.pressureRequests ?? [profile.settings.pressureRequest];
      if (
        !Array.isArray(presses) ||
        !presses.length ||
        presses.length > 32 ||
        presses.some(
          (x) => typeof x !== 'number' || !Number.isSafeInteger(x) || x < 1 || x > 65535,
        ) ||
        (profile.recipe && presses.length !== profile.recipe.passCount)
      )
        throw fail();
      const points = group.paths.flatMap((path) => path.steps.flatMap((step) => step.points));
      if (!points.length) throw fail();
      const plan = {
        ...structuredClone(full),
        groups: [structuredClone(group)],
        bounds: {
          minX: Math.min(...points.map((p) => p.x)),
          minY: Math.min(...points.map((p) => p.y)),
          maxX: Math.max(...points.map((p) => p.x)),
          maxY: Math.max(...points.map((p) => p.y)),
        },
      };
      if (group.tool === 'fine_point_blade') requireBladeJob(plan, profile.settings, presses);
      else if (group.tool !== 'pen' || group.operation !== 'draw') throw fail();
      return { profile, plan, presses };
    });
    const actions: Prepared[] = [];
    for (const d of drafts) {
      const worker = {
        op: 'configuration',
        action: 'prepare_job',
        plan: structuredClone(d.plan),
        settings: structuredClone(d.profile.settings),
        pressureResponsesHex: [...c.pressureResponsesHex],
        pressureRequests: [...d.presses],
      };
      const metadata = cleanMetadata(await this.o.native.runOfflineConfiguration(worker));
      if (
        metadata.workflow ||
        metadata.materialId !== source.materialId ||
        metadata.tool !== d.profile.settings.tool ||
        metadata.operation !== d.profile.settings.operation ||
        metadata.passCount !== d.presses.length ||
        digest(metadata.pressureRequests) !== digest(d.presses) ||
        metadata.heightInches !== source.mat.heightIn ||
        this.disposed ||
        gen !== this.generation ||
        this.o.legacyBusy()
      )
        throw fail();
      actions.push({
        id: randomUUID(),
        digest: digest({ plan: d.plan, settings: d.profile.settings, calibration: c, source }),
        sourceDigest: digest(source),
        libraryDigest: digest(lib),
        profile: d.profile,
        calibration: c,
        source,
        plan: d.plan,
        metadata,
        worker,
        generation: gen,
        ...(retained ? { retained } : {}),
        ...(mixed ? { selectionProfileId: profileId } : {}),
      });
    }
    const p: Prepared = { ...actions[0]! };
    if (mixed) {
      p.workflow = { actions, index: 0 };
      p.metadata = {
        ...p.metadata,
        workflow: {
          actionIndex: 0,
          actionCount: actions.length,
          containsBlade: actions.some((a) => a.metadata.tool === 'fine_point_blade'),
          actions: actions.map((a) => ({
            tool: a.metadata.tool,
            ...(a.plan.groups[0]?.paths[0]?.color
              ? { color: a.plan.groups[0].paths[0].color }
              : {}),
            profileId: a.profile.id,
            profileName: a.profile.name,
            passCount: a.metadata.passCount,
            pressureRequests: [...a.metadata.pressureRequests],
          })),
        },
      };
    }
    this.workflowInvalidated = false;
    this.prepared = p;
    return { ...structuredClone(p.metadata), jobId: p.id };
  }
  async start(input: unknown): Promise<NativeJobState | { canceled: true }> {
    const v = record(input);
    exact(v, ['jobId', 'source']);
    if (typeof v.jobId !== 'string' || this.busy || this.disposed) throw fail();
    const p = this.prepared;
    if (
      !p ||
      p.id !== v.jobId ||
      p.generation !== this.generation ||
      !['pen', 'fine_point_blade'].includes(p.metadata.tool) ||
      digest(sourceValue(v.source)) !== p.sourceDigest ||
      this.o.legacyBusy()
    )
      throw fail();
    if (p.metadata.tool === 'fine_point_blade')
      requireBladeJob(p.plan, p.profile.settings, p.metadata.pressureRequests);
    if (p.retained) return this.startNext(p);
    this.busy = true;
    let ctx: Approval | undefined;
    try {
      await this.snapshot(p);
      ctx = this.o.native.reserveJobApproval();
      if (ctx.deviceFingerprint !== p.calibration.deviceFingerprint) throw fail();
      if ((await this.o.confirmLoad(structuredClone(p.metadata))) !== true)
        return { canceled: true };
      await this.snapshot(p);
      if (p.generation !== this.generation || this.o.legacyBusy()) throw fail();
      this.transitioning = true;
      this.retainedPersisted = null;
      this.journalEpoch++;
      await this.o.journal.preflight();
      await this.snapshot(p);
      if (p.generation !== this.generation || this.o.legacyBusy() || this.disposed) throw fail();
      const request = startJobRequest({
        plan: structuredClone(p.plan),
        settings: structuredClone(p.profile.settings),
        pressureResponsesHex: [...p.calibration.pressureResponsesHex],
        pressureRequests: [...p.metadata.pressureRequests],
        programDigest: p.metadata.programDigest,
        timeout: 30,
        jobTimeout: 60,
        motionApproved: true,
        bladeRemovedConfirmed: true,
        ...(p.metadata.tool === 'fine_point_blade' ? { bladeJob: BLADE_JOB_ID } : {}),
      });
      const state = await this.o.native.startJob(request, ctx);
      this.active = p;
      this.prepared = null;
      this.captureFailed = false;
      this.cancellationSent = false;
      this.journalEpoch++;
      this.loadedBinding = {
        generation: ctx.generation,
        materialId: p.source.materialId,
        matDigest: digest(p.source.mat),
        calibrationDigest: digest(p.calibration),
      };
      try {
        if (
          state.programDigest !== p.metadata.programDigest ||
          state.tool !== p.metadata.tool ||
          state.totalRecords !== p.metadata.recordCount ||
          state.totalPasses !== p.metadata.passCount
        )
          throw fail();
        await this.o.journal.observe(state);
      } catch {
        this.captureFailed = true;
        await this.cancelOwner();
        throw Error(
          'Job boundary or diagnostic persistence failed; cancellation was requested. Keep clear.',
        );
      } finally {
        this.schedule();
      }
      return this.decorate(state);
    } finally {
      if (ctx) this.o.native.releaseJobApproval(ctx);
      this.transitioning = false;
      this.busy = false;
    }
  }
  /** Arm an already-frozen continuation. A separate fresh jobGo remains mandatory. */
  async armNext(input: unknown): Promise<NativeJobState> {
    const v = record(input);
    exact(v, ['jobId', 'source']);
    const p = this.prepared;
    if (
      typeof v.jobId !== 'string' ||
      !p ||
      p.id !== v.jobId ||
      !p.retained ||
      !p.workflow ||
      p.workflow.index < 1 ||
      p.generation !== this.generation ||
      this.busy ||
      this.disposed ||
      this.o.legacyBusy() ||
      digest(sourceValue(v.source)) !== p.sourceDigest
    )
      throw fail();
    const state = await this.start(v);
    if (
      'canceled' in state ||
      state.phase !== 'waiting_for_go' ||
      state.jobStarted ||
      state.acceptedRecords !== 0 ||
      state.completedPasses !== 0
    )
      throw fail();
    return state;
  }
  async go(): Promise<NativeJobState | { canceled: true }> {
    if (
      this.busy ||
      this.goPending ||
      !this.active ||
      !['pen', 'fine_point_blade'].includes(this.active.metadata.tool) ||
      this.disposed ||
      this.captureFailed
    )
      throw fail();
    const p = this.active;
    if (p.generation !== this.generation) throw fail();
    this.busy = true;
    this.goPending = true;
    try {
      const ctx = this.o.native.jobGoApprovalContext();
      if (ctx.operationId !== this.o.native.getJobState().operationId) throw fail();
      if ((await this.o.confirmTool(structuredClone(p.metadata))) !== true)
        return { canceled: true };
      await this.snapshot(p);
      if (
        p.generation !== this.generation ||
        this.o.legacyBusy() ||
        this.disposed ||
        this.captureFailed ||
        ctx.operationId !== this.o.native.getJobState().operationId
      )
        throw fail();
      const state = await this.o.native.controlJob('go', true, ctx, () => this.recheckDispatch(p));
      try {
        await this.o.journal.observe(state);
      } catch {
        this.captureFailed = true;
        await this.cancelOwner();
        throw Error('Job diagnostics failed; cancellation was requested. Keep clear.');
      }
      return this.decorate(state);
    } finally {
      this.goPending = false;
      this.busy = false;
      this.schedule();
    }
  }
  async pause(): Promise<NativeJobState> {
    const prior = this.o.native.getJobState();
    if (
      this.busy ||
      !this.active ||
      this.active.metadata.workflow?.containsBlade ||
      this.active.metadata.tool !== 'pen' ||
      !prior.active ||
      !prior.jobStarted ||
      !['setting_up', 'sending', 'draining'].includes(prior.phase) ||
      this.disposed ||
      this.captureFailed ||
      this.cancellationSent
    )
      throw fail();
    this.busy = true;
    try {
      const state = await this.o.native.controlJob('pause');
      try {
        await this.o.journal.observe(state);
      } catch {
        this.captureFailed = true;
        await this.cancelOwner();
        throw Error('Pause diagnostics failed; cancellation requested.');
      }
      return state;
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  async resume(): Promise<NativeJobState | { canceled: true }> {
    const p = this.active;
    if (
      this.busy ||
      !p ||
      p.metadata.workflow?.containsBlade ||
      p.metadata.tool !== 'pen' ||
      p.generation !== this.generation ||
      this.disposed ||
      this.captureFailed ||
      this.cancellationSent ||
      !this.o.native.jobResumeApprovalContext
    )
      throw fail();
    this.busy = true;
    try {
      const ctx = this.o.native.jobResumeApprovalContext();
      await this.snapshot(p);
      if (
        p.generation !== this.generation ||
        this.disposed ||
        this.captureFailed ||
        this.cancellationSent ||
        this.o.legacyBusy()
      )
        throw fail();
      if ((await this.o.confirmResume?.(structuredClone(p.metadata))) !== true)
        return { canceled: true };
      await this.snapshot(p);
      if (
        p.generation !== this.generation ||
        this.disposed ||
        this.captureFailed ||
        this.cancellationSent ||
        this.o.legacyBusy()
      )
        throw fail();
      const current = this.o.native.jobResumeApprovalContext();
      if (current.generation !== ctx.generation || current.operationId !== ctx.operationId)
        throw fail();
      const state = await this.o.native.controlJob('resume', true, ctx, () =>
        this.recheckDispatch(p),
      );
      try {
        await this.o.journal.observe(state);
      } catch {
        this.captureFailed = true;
        await this.cancelOwner();
        throw Error('Resume diagnostics failed; cancellation requested.');
      }
      return this.decorate(state);
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  private async recheckDispatch(p: Prepared): Promise<void> {
    await this.snapshot(p);
    if (
      p.generation !== this.generation ||
      this.disposed ||
      this.captureFailed ||
      this.cancellationSent ||
      this.o.legacyBusy()
    )
      throw fail();
  }
  private retainedContext(): RetainedContext {
    if (!this.o.native.jobRetainedApprovalContext) throw fail();
    return this.o.native.jobRetainedApprovalContext();
  }
  private checkLoadedBinding(
    source: NativeConfigurationSource,
    c: JoyCalibration,
    ctx: RetainedContext,
  ) {
    const b = this.loadedBinding;
    if (
      !b ||
      ctx.generation !== b.generation ||
      ctx.deviceFingerprint !== c.deviceFingerprint ||
      source.materialId !== b.materialId ||
      digest(source.mat) !== b.matDigest ||
      digest(c) !== b.calibrationDigest
    )
      throw Error(
        'Loaded mat/material/calibration changed. End this session before changing its physical setup.',
      );
  }
  private checkRetainedPrepared(p: Prepared): RetainedContext {
    const ctx = this.retainedContext(),
      saved = p.retained;
    if (
      !saved ||
      ctx.generation !== saved.generation ||
      ctx.operationId !== saved.operationId ||
      ctx.deviceFingerprint !== saved.deviceFingerprint
    )
      throw fail();
    this.checkLoadedBinding(p.source, p.calibration, ctx);
    return ctx;
  }
  private async startNext(p: Prepared): Promise<NativeJobState> {
    if (
      (p.metadata.tool !== 'pen' && !(p.workflow && p.metadata.tool === 'fine_point_blade')) ||
      this.active?.metadata.tool !== 'pen' ||
      !this.o.native.startNextJob ||
      this.busy ||
      this.captureFailed ||
      this.cancellationSent
    )
      throw fail();
    this.busy = true;
    try {
      const ctx = this.checkRetainedPrepared(p);
      await this.recheckDispatch(p);
      this.checkRetainedPrepared(p);
      this.transitioning = true;
      this.retainedPersisted = null;
      this.journalEpoch++;
      await this.o.journal.preflight();
      await this.recheckDispatch(p);
      this.checkRetainedPrepared(p);
      const request = nextJobRequest({
        operationId: ctx.operationId,
        plan: structuredClone(p.plan),
        settings: structuredClone(p.profile.settings),
        pressureResponsesHex: [...p.calibration.pressureResponsesHex],
        pressureRequests: [...p.metadata.pressureRequests],
        programDigest: p.metadata.programDigest,
        jobTimeout: 60,
        ...(p.metadata.tool === 'fine_point_blade' ? { bladeJob: BLADE_JOB_ID } : {}),
      });
      const state = await this.o.native.startNextJob(request, ctx, async () => {
        await this.recheckDispatch(p);
        this.checkRetainedPrepared(p);
      });
      if (
        state.operationId <= ctx.operationId ||
        state.programDigest !== p.metadata.programDigest ||
        state.jobStarted ||
        state.phase !== 'waiting_for_go' ||
        state.acceptedRecords !== 0 ||
        state.completedPasses !== 0 ||
        state.totalRecords !== p.metadata.recordCount ||
        state.totalPasses !== p.metadata.passCount
      )
        throw fail();
      this.active = p;
      this.prepared = null;
      this.captureFailed = false;
      this.cancellationSent = false;
      this.journalEpoch++;
      try {
        await this.o.journal.observe(state);
      } catch {
        this.captureFailed = true;
        await this.cancelOwner();
        throw Error('Next-action diagnostics failed; cancellation requested.');
      }
      return this.decorate(state);
    } finally {
      this.transitioning = false;
      this.busy = false;
      this.schedule();
    }
  }
  async end(): Promise<NativeJobState | { canceled: true }> {
    if (this.busy || !this.active || this.disposed) throw fail();
    this.busy = true;
    try {
      const ctx = this.retainedContext();
      if ((await this.o.confirmEnd?.(structuredClone(this.active.metadata))) !== true)
        return { canceled: true };
      const current = this.retainedContext();
      if (
        current.generation !== ctx.generation ||
        current.operationId !== ctx.operationId ||
        current.deviceFingerprint !== ctx.deviceFingerprint ||
        this.disposed ||
        this.o.legacyBusy()
      )
        throw fail();
      this.invalidate();
      const state = await this.o.native.controlJob('end', true, ctx);
      try {
        await this.o.journal.observe(state);
      } catch {
        this.captureFailed = true;
        throw Error('End requested, but diagnostic persistence failed. Do not repeat it.');
      }
      return this.decorate(state);
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  private async cancelOwner() {
    if (!this.cancellationSent && this.o.native.getJobState().active) {
      this.cancellationSent = true;
      try {
        await this.o.native.controlJob('cancel');
      } catch {
        /* Native actor owns uncertain-process quarantine. */
      }
    }
  }
  async cancel(): Promise<NativeJobState> {
    this.invalidate();
    await this.cancelOwner();
    const state = await this.o.native.jobStatus();
    try {
      await this.o.journal.observe(state);
    } catch {
      this.captureFailed = true;
    }
    if (!state.active) this.active = null;
    this.schedule();
    return state;
  }
  async status(): Promise<NativeJobState> {
    const epoch = this.journalEpoch,
      state = await this.o.native.jobStatus();
    if (this.transitioning || epoch !== this.journalEpoch) return state; // Old status cannot cross an action report epoch.
    try {
      const retained = state.active && String(state.phase) === 'retained_ready',
        signature = retained ? digest(state) : null;
      if (!retained || signature !== this.retainedPersisted) {
        await this.o.journal.observe(state);
        if (epoch === this.journalEpoch) this.retainedPersisted = signature;
      }
    } catch {
      this.captureFailed = true;
      await this.cancelOwner();
      this.schedule();
      throw Error('Job diagnostic capture could not be persisted; cancellation was requested.');
    }
    const display = this.decorate(state);
    if (!state.active) {
      this.active = null;
      this.loadedBinding = null;
    }
    return display;
  }
  private schedule() {
    if (
      this.timer ||
      this.disposed ||
      this.o.pollMs === false ||
      !this.active ||
      !this.o.native.getJobState().active
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.status()
        .catch(() => {})
        .finally(() => this.schedule());
    }, this.o.pollMs ?? 250);
    this.timer.unref?.();
  }
  dispose() {
    this.disposed = true;
    this.invalidate();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
