import { NativeOperationLifecycle } from './native-operation-lifecycle';
import type { NativeJobState } from './native-joy-job-types';
/** Job transition table: identity/progress is monotonic; Go, cancel, pause and End are host-owned gates. */
export class NativeJoyJobActor {
  private readonly lifecycle = new NativeOperationLifecycle<
    'go' | 'end' | 'cancel' | 'pause' | 'resumePending'
  >();
  private snapshot: NativeJobState = {
    operationId: 0,
    phase: 'idle',
    active: false,
    sessionRetired: false,
    jobStarted: false,
    programDigest: null,
    tool: null,
    acceptedRecords: 0,
    completedPasses: 0,
    totalPasses: 0,
    totalRecords: 0,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
  };
  private programBinding: Record<string, unknown> | null = null;
  private token = 0;
  private dispatching = false;
  get state(): NativeJobState {
    return this.snapshot;
  }
  replace(value: NativeJobState) {
    this.snapshot = value;
  }
  get binding() {
    return this.programBinding;
  }
  bind(value: Record<string, unknown> | null) {
    this.programBinding = value;
  }
  get reserved() {
    return this.lifecycle.reserved;
  }
  reserve(value: boolean) {
    this.lifecycle.reserve(value);
  }
  get starting() {
    return this.dispatching;
  }
  markStarting(value: boolean) {
    this.dispatching = value;
  }
  get generation() {
    return this.token;
  }
  nextToken() {
    return ++this.token;
  }
  get goSent() {
    return this.lifecycle.has('go');
  }
  get endSent() {
    return this.lifecycle.has('end');
  }
  get cancelSent() {
    return this.lifecycle.has('cancel');
  }
  get pauseSent() {
    return this.lifecycle.has('pause');
  }
  get resumePending() {
    return this.lifecycle.has('resumePending');
  }
  markRequested(action: 'go' | 'end' | 'cancel' | 'pause' | 'resumePending', value: boolean) {
    this.lifecycle.mark(action, value);
  }
  settled() {
    return this.lifecycle.settled();
  }
  enqueue<T>(work: () => Promise<T>) {
    return this.lifecycle.enqueue(work);
  }
  observe(next: NativeJobState, starting: boolean, request: Record<string, unknown>) {
    this.validate(next, this.snapshot, starting, request, {
      go: this.goSent,
      end: this.endSent,
      cancel: this.cancelSent,
      pause: this.pauseSent,
      resumePending: this.resumePending,
    });
    this.snapshot = next;
    if (!next.active || (this.resumePending && !['paused', 'pausing'].includes(next.phase))) {
      this.markRequested('pause', false);
      this.markRequested('resumePending', false);
    }
  }

  validate(
    next: NativeJobState,
    prior: NativeJobState,
    starting: boolean,
    request: Record<string, unknown>,
    gates: { go: boolean; end: boolean; cancel: boolean; pause: boolean; resumePending: boolean },
  ): void {
    if (starting) {
      const expectedTool = (request.settings as { tool?: unknown } | null)?.tool;
      if (request.action === 'next') {
        if (
          next.operationId <= prior.operationId ||
          next.phase !== 'waiting_for_go' ||
          !next.active ||
          next.jobStarted ||
          next.acceptedRecords !== 0 ||
          next.completedPasses !== 0 ||
          next.programDigest !== request.programDigest ||
          next.tool !== expectedTool ||
          next.totalPasses !== (request.pressureRequests as unknown[]).length ||
          next.totalRecords < 1
        )
          throw Error('Invalid next-action state.');
      } else if (
        next.operationId < 1 ||
        next.phase !== 'loading_and_aligning' ||
        !next.active ||
        next.jobStarted ||
        next.programDigest !== request.programDigest ||
        next.tool !== expectedTool ||
        next.totalPasses !== (request.pressureRequests as unknown[]).length ||
        next.totalRecords < 1
      )
        throw Error('Invalid initial job state.');
    } else {
      if (next.phase === 'retained_ready' && (!gates.go || next.operationId !== prior.operationId))
        throw Error('Unrequested retained job state.');
      if (next.phase === 'completed' && (!gates.go || !gates.end))
        throw Error('Unrequested job completion.');
      if (
        next.phase === 'retained_ready' &&
        (!next.jobStarted ||
          next.acceptedRecords !== next.totalRecords ||
          next.completedPasses !== next.totalPasses)
      )
        throw Error('Undrained job cannot be retained.');
      if (
        next.operationId !== prior.operationId ||
        next.programDigest !== prior.programDigest ||
        next.tool !== prior.tool ||
        next.totalRecords !== prior.totalRecords ||
        next.totalPasses !== prior.totalPasses ||
        next.acceptedRecords < prior.acceptedRecords ||
        next.completedPasses < prior.completedPasses ||
        (prior.jobStarted && !next.jobStarted)
      )
        throw Error('Job identity or progress changed.');
      const loading = [
        'loading_and_aligning',
        'waiting_for_mat',
        'gripped',
        'measuring_y',
        'positioning',
        'waiting_for_go',
      ];
      if (!gates.go && next.active && loading.indexOf(next.phase) < loading.indexOf(prior.phase))
        throw Error('Loading state regressed.');
    }
    if (
      (next.jobStarted ||
        next.acceptedRecords > 0 ||
        next.completedPasses > 0 ||
        ['setting_up', 'sending', 'draining', 'pausing', 'paused', 'completed'].includes(
          next.phase,
        )) &&
      !gates.go
    )
      throw Error('Job advanced without genuine Go.');
    if (['pausing', 'paused'].includes(next.phase) && !gates.pause)
      throw Error('Unrequested queue pause.');
    if (
      prior.phase === 'paused' &&
      next.phase === 'paused' &&
      !gates.resumePending &&
      (next.acceptedRecords !== prior.acceptedRecords ||
        next.completedPasses !== prior.completedPasses)
    )
      throw Error('Paused job progress changed.');
    if (next.phase === 'cancelled' && !gates.cancel) throw Error('Unrequested job cancellation.');
  }
}
