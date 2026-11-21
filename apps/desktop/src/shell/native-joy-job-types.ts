import {
  readJobDiagnostics,
  type NativeJoyLoadingDiagnostics,
} from './native-joy-loading-diagnostics';

export interface NativeJobMetadata {
  programDigest: string;
  tool: 'pen' | 'fine_point_blade';
  operation: 'draw' | 'cut';
  materialId: number;
  passCount: number;
  recordCount: number;
  pressureRequests: number[];
  heightInches: 6.5 | 6.25 | 12;
  physicalCalibrationVerified: false;
  workflow?: NativeJobWorkflow;
}
export type NativeJobPhase =
  | 'idle'
  | 'loading_and_aligning'
  | 'waiting_for_mat'
  | 'gripped'
  | 'measuring_y'
  | 'positioning'
  | 'waiting_for_go'
  | 'setting_up'
  | 'sending'
  | 'draining'
  | 'pausing'
  | 'paused'
  | 'returning_to_origin'
  | 'retained_ready'
  | 'releasing'
  | 'completed'
  | 'cancelled'
  | 'failed';
export interface NativeJobWorkflow {
  actionIndex: number;
  actionCount: number;
  containsBlade: boolean;
  actions: Array<{
    tool: 'pen' | 'fine_point_blade';
    color?: string;
    profileId: string;
    profileName: string;
    passCount: number;
    pressureRequests: number[];
  }>;
}
export interface NativeJobState {
  operationId: number;
  phase: NativeJobPhase;
  active: boolean;
  sessionRetired: boolean;
  jobStarted: boolean;
  programDigest: string | null;
  tool: 'pen' | 'fine_point_blade' | null;
  acceptedRecords: number;
  completedPasses: number;
  totalRecords: number;
  totalPasses: number;
  physicalCompletionVerified: false;
  motionStoppedVerified: false;
  returnToOrigin?: 'pending' | 'running' | 'protocol_complete' | 'failed';
  workflow?: NativeJobWorkflow;
  diagnostics?: NativeJoyLoadingDiagnostics;
}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid job metadata.');
  return v as Record<string, unknown>;
};
const exact = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw new Error('Unexpected job metadata field.');
};
const uint = (v: unknown, min: number, max: number) =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
function readWorkflow(value: unknown): NativeJobWorkflow | undefined {
  if (value === undefined) return undefined;
  const v = obj(value);
  exact(v, ['actionIndex', 'actionCount', 'containsBlade', 'actions']);
  if (
    !uint(v.actionCount, 1, 32) ||
    !uint(v.actionIndex, 0, Number(v.actionCount) - 1) ||
    typeof v.containsBlade !== 'boolean' ||
    !Array.isArray(v.actions) ||
    v.actions.length !== v.actionCount
  )
    throw Error('Invalid job workflow.');
  let blade = false;
  const actions = v.actions.map((input) => {
    const a = obj(input);
    exact(a, ['tool', 'color', 'profileId', 'profileName', 'passCount', 'pressureRequests']);
    if (a.color !== undefined && (typeof a.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.color)))
      throw Error('Invalid workflow colour.');
    if (
      !['pen', 'fine_point_blade'].includes(String(a.tool)) ||
      typeof a.profileId !== 'string' ||
      !a.profileId.length ||
      a.profileId.length > 256 ||
      typeof a.profileName !== 'string' ||
      !a.profileName.length ||
      a.profileName.length > 1024 ||
      !uint(a.passCount, 1, 32) ||
      !Array.isArray(a.pressureRequests) ||
      a.pressureRequests.length !== a.passCount ||
      !a.pressureRequests.every((x) => uint(x, 1, 65535)) ||
      blade
    )
      throw Error('Invalid workflow action.');
    if (a.tool === 'fine_point_blade') blade = true;
    return {
      tool: a.tool as 'pen' | 'fine_point_blade',
      ...(a.color === undefined ? {} : { color: a.color as string }),
      profileId: a.profileId,
      profileName: a.profileName,
      passCount: Number(a.passCount),
      pressureRequests: [...a.pressureRequests] as number[],
    };
  });
  if (blade !== v.containsBlade) throw Error('Invalid workflow blade binding.');
  return {
    actionIndex: Number(v.actionIndex),
    actionCount: Number(v.actionCount),
    containsBlade: blade,
    actions,
  };
}
export function readJobMetadata(value: unknown): NativeJobMetadata {
  const v = obj(value);
  exact(v, [
    'programDigest',
    'tool',
    'operation',
    'materialId',
    'passCount',
    'recordCount',
    'pressureRequests',
    'heightInches',
    'physicalCalibrationVerified',
    'workflow',
  ]);
  if (
    typeof v.programDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.programDigest) ||
    !uint(v.materialId, 1, 0xffffffff) ||
    !uint(v.passCount, 1, 32) ||
    !uint(v.recordCount, 1, 12000) ||
    !Array.isArray(v.pressureRequests) ||
    v.pressureRequests.length !== v.passCount ||
    !v.pressureRequests.every((n) => uint(n, 1, 65535)) ||
    (v.heightInches !== 6.5 && v.heightInches !== 6.25 && v.heightInches !== 12) ||
    v.physicalCalibrationVerified !== false
  )
    throw new Error('Invalid job metadata.');
  if (!(
    (v.tool === 'pen' && v.operation === 'draw') ||
    (v.tool === 'fine_point_blade' && v.operation === 'cut')
  ))
    throw new Error('Invalid job tool/operation.');
  return {
    programDigest: v.programDigest,
    tool: v.tool,
    operation: v.operation,
    materialId: Number(v.materialId),
    passCount: Number(v.passCount),
    recordCount: Number(v.recordCount),
    pressureRequests: [...v.pressureRequests] as number[],
    heightInches: v.heightInches,
    physicalCalibrationVerified: false,
    ...(v.workflow === undefined ? {} : { workflow: readWorkflow(v.workflow) }),
  };
}
const phases: NativeJobPhase[] = [
  'idle',
  'loading_and_aligning',
  'waiting_for_mat',
  'gripped',
  'measuring_y',
  'positioning',
  'waiting_for_go',
  'setting_up',
  'sending',
  'draining',
  'pausing',
  'paused',
  'returning_to_origin',
  'retained_ready',
  'releasing',
  'completed',
  'cancelled',
  'failed',
];
export function readJobState(value: unknown): NativeJobState {
  const v = obj(value);
  exact(v, [
    'operationId',
    'phase',
    'active',
    'sessionRetired',
    'jobStarted',
    'programDigest',
    'tool',
    'acceptedRecords',
    'completedPasses',
    'totalRecords',
    'totalPasses',
    'physicalCompletionVerified',
    'motionStoppedVerified',
    'diagnostics',
    'returnToOrigin',
    'workflow',
  ]);
  if (
    !uint(v.operationId, 0, Number.MAX_SAFE_INTEGER) ||
    !phases.includes(v.phase as NativeJobPhase) ||
    typeof v.active !== 'boolean' ||
    typeof v.sessionRetired !== 'boolean' ||
    typeof v.jobStarted !== 'boolean' ||
    !(
      v.programDigest === null ||
      (typeof v.programDigest === 'string' && /^[0-9a-f]{64}$/.test(v.programDigest))
    ) ||
    !(v.tool === null || v.tool === 'pen' || v.tool === 'fine_point_blade') ||
    ![v.acceptedRecords, v.completedPasses, v.totalRecords, v.totalPasses].every((n) =>
      uint(n, 0, 12000),
    ) ||
    v.physicalCompletionVerified !== false ||
    v.motionStoppedVerified !== false
  )
    throw new Error('Invalid job state.');
  const activePhases: NativeJobPhase[] = [
    'loading_and_aligning',
    'waiting_for_mat',
    'gripped',
    'measuring_y',
    'positioning',
    'waiting_for_go',
    'setting_up',
    'sending',
    'draining',
    'pausing',
    'paused',
    'returning_to_origin',
    'retained_ready',
    'releasing',
  ];
  if (
    v.active !== activePhases.includes(v.phase as NativeJobPhase) ||
    (v.active && v.sessionRetired) ||
    (v.phase === 'idle' && (v.operationId !== 0 || v.sessionRetired)) ||
    (!v.active && v.phase !== 'idle' && !v.sessionRetired) ||
    Number(v.acceptedRecords) > Number(v.totalRecords) ||
    Number(v.completedPasses) > Number(v.totalPasses) ||
    Number(v.totalPasses) > 32 ||
    Number(v.totalRecords) > 12000
  )
    throw new Error('Inconsistent job state.');
  if (
    v.phase === 'retained_ready' &&
    (!v.jobStarted ||
      v.acceptedRecords !== v.totalRecords ||
      v.completedPasses !== v.totalPasses ||
      Number(v.operationId) < 1)
  )
    throw new Error('Undrained job cannot be retained.');
  if (
    v.phase === 'completed' &&
    (!v.jobStarted ||
      v.acceptedRecords !== v.totalRecords ||
      v.completedPasses !== v.totalPasses ||
      Number(v.operationId) < 1)
  )
    throw new Error('Incomplete job cannot report success.');
  if (
    v.phase === 'idle' &&
    (v.jobStarted ||
      v.programDigest !== null ||
      v.tool !== null ||
      [v.acceptedRecords, v.completedPasses, v.totalRecords, v.totalPasses].some((n) => n !== 0))
  )
    throw new Error('Invalid idle job state.');
  if (
    v.returnToOrigin !== undefined &&
    !['pending', 'running', 'protocol_complete', 'failed'].includes(String(v.returnToOrigin))
  )
    throw Error('Invalid origin return state.');
  if (
    v.phase === 'retained_ready' &&
    v.returnToOrigin !== undefined &&
    v.returnToOrigin !== 'protocol_complete'
  )
    throw Error('Origin return incomplete.');
  if (
    v.phase === 'returning_to_origin' &&
    (!v.jobStarted ||
      v.acceptedRecords !== v.totalRecords ||
      v.completedPasses !== v.totalPasses ||
      !['pending', 'running', 'protocol_complete'].includes(String(v.returnToOrigin)))
  )
    throw Error('Invalid return phase.');
  const diagnostics =
    v.diagnostics === undefined
      ? undefined
      : readJobDiagnostics(v.diagnostics, Number(v.operationId));
  return {
    operationId: Number(v.operationId),
    phase: v.phase as NativeJobPhase,
    active: v.active,
    sessionRetired: v.sessionRetired,
    jobStarted: v.jobStarted,
    programDigest: v.programDigest as string | null,
    tool: v.tool as NativeJobState['tool'],
    acceptedRecords: Number(v.acceptedRecords),
    completedPasses: Number(v.completedPasses),
    totalRecords: Number(v.totalRecords),
    totalPasses: Number(v.totalPasses),
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
    ...(diagnostics ? { diagnostics } : {}),
    ...(v.returnToOrigin === undefined
      ? {}
      : { returnToOrigin: v.returnToOrigin as NativeJobState['returnToOrigin'] }),
    ...(v.workflow === undefined ? {} : { workflow: readWorkflow(v.workflow) }),
  };
}
