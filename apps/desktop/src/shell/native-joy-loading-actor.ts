import { NativeOperationLifecycle } from './native-operation-lifecycle';
import {
  readLoadingDiagnostics,
  type NativeJoyLoadingDiagnostics,
} from './native-joy-loading-diagnostics';
export type LoadingPhase =
  | 'idle'
  | 'loading_and_aligning'
  | 'waiting_for_mat'
  | 'gripped'
  | 'measuring_y'
  | 'positioning'
  | 'waiting_for_go'
  | 'releasing'
  | 'completed'
  | 'cancelled'
  | 'failed';
export interface LoadingState {
  operationId: number;
  phase: LoadingPhase;
  active: boolean;
  sessionRetired: boolean;
  physicalLoadingVerified: false;
  physicalAlignmentVerified: false;
  motionStoppedVerified: false;
  jobStarted: false;
  diagnostics?: NativeJoyLoadingDiagnostics;
  historical?: true;
}
const phases: LoadingPhase[] = [
  'idle',
  'loading_and_aligning',
  'waiting_for_mat',
  'gripped',
  'measuring_y',
  'positioning',
  'waiting_for_go',
  'releasing',
  'completed',
  'cancelled',
  'failed',
];
const activePhases: LoadingPhase[] = [
  'loading_and_aligning',
  'waiting_for_mat',
  'gripped',
  'measuring_y',
  'positioning',
  'waiting_for_go',
  'releasing',
];
/** Owns validated loading state. Active phases advance in listed order; terminal states retire the session. */
export class NativeJoyLoadingActor {
  private readonly lifecycle = new NativeOperationLifecycle<'go' | 'cancel'>();
  get reserved() {
    return this.lifecycle.reserved;
  }
  reserve(value: boolean) {
    this.lifecycle.reserve(value);
  }
  get goRequested() {
    return this.lifecycle.has('go');
  }
  get cancelRequested() {
    return this.lifecycle.has('cancel');
  }
  markRequested(action: 'go' | 'cancel', value: boolean) {
    this.lifecycle.mark(action, value);
  }
  enqueue<T>(work: () => Promise<T>) {
    return this.lifecycle.enqueue(work);
  }
  settled() {
    return this.lifecycle.settled();
  }
  private current: LoadingState = {
    operationId: 0,
    phase: 'idle',
    active: false,
    sessionRetired: false,
    physicalLoadingVerified: false,
    physicalAlignmentVerified: false,
    motionStoppedVerified: false,
    jobStarted: false,
  };
  get state(): LoadingState {
    return this.current;
  }
  replace(state: LoadingState): void {
    this.current = state;
  }
  accept(
    value: Record<string, unknown>,
    starting: boolean,
    authorization: { goRequested?: boolean; cancelRequested?: boolean },
  ): LoadingState {
    if (
      !Number.isSafeInteger(value.operationId) ||
      Number(value.operationId) < 0 ||
      typeof value.phase !== 'string' ||
      !phases.includes(value.phase as LoadingPhase) ||
      typeof value.active !== 'boolean' ||
      typeof value.sessionRetired !== 'boolean' ||
      value.physicalLoadingVerified !== false ||
      value.physicalAlignmentVerified !== false ||
      value.motionStoppedVerified !== false ||
      value.jobStarted !== false
    )
      throw new Error('Invalid loading state.');
    const phase = value.phase as LoadingPhase,
      active = activePhases.includes(phase);
    if (
      value.active !== active ||
      (active && value.sessionRetired) ||
      (phase === 'idle' && (value.operationId !== 0 || value.sessionRetired)) ||
      (!active && phase !== 'idle' && !value.sessionRetired)
    )
      throw new Error('Inconsistent loading state.');
    if (
      Object.keys(value).some(
        (k) =>
          ![
            'operationId',
            'phase',
            'active',
            'sessionRetired',
            'physicalLoadingVerified',
            'physicalAlignmentVerified',
            'motionStoppedVerified',
            'jobStarted',
            'diagnostics',
          ].includes(k),
      )
    )
      throw new Error('Invalid loading state.');
    const diagnostics =
      value.diagnostics === undefined
        ? undefined
        : readLoadingDiagnostics(value.diagnostics, Number(value.operationId));
    const next: LoadingState = {
      operationId: Number(value.operationId),
      phase,
      active: value.active,
      sessionRetired: value.sessionRetired,
      physicalLoadingVerified: false,
      physicalAlignmentVerified: false,
      motionStoppedVerified: false,
      jobStarted: false,
      ...(diagnostics ? { diagnostics } : {}),
    };
    const prior = this.current;
    if (starting) {
      if (next.operationId <= 0 || next.phase !== 'loading_and_aligning' || !next.active)
        throw new Error('Invalid loading start state.');
    } else {
      if (next.operationId !== prior.operationId) throw new Error('Mismatched loading operation.');
      if (next.active && activePhases.indexOf(next.phase) < activePhases.indexOf(prior.phase))
        throw new Error('Regressed loading state.');
      if (next.phase === 'completed' && !authorization.goRequested)
        throw new Error('Unrequested host-Go completion.');
      if (next.phase === 'cancelled' && !authorization.cancelRequested)
        throw new Error('Unrequested cancellation.');
    }
    this.current = next;
    return next;
  }
}
