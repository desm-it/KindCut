import type { NativeJobState } from './native-joy-job-types';
/** Host-emitted v1 request bodies; transport id is added by the private client. */
export const JOB_RPC_CONTRACT_VERSION = 1 as const;
type ProgramFields = {
  plan: unknown;
  settings: unknown;
  pressureResponsesHex: readonly string[];
  pressureRequests: readonly number[];
  programDigest: string;
  jobTimeout: 60;
  bladeTrial?: string;
  bladeJob?: string;
};
type Start = ProgramFields & {
  op: 'job';
  action: 'start';
  timeout: 30;
  motionApproved: true;
  bladeRemovedConfirmed: true;
};
type Next = ProgramFields & { op: 'job'; action: 'next'; operationId: number };
type Control =
  | {
      op: 'job';
      action: 'go';
      operationId: number;
      toolConfirmed: true;
      bladeInstalledConfirmed?: true;
    }
  | { op: 'job'; action: 'pause' | 'cancel'; operationId: number }
  | { op: 'job'; action: 'resume'; operationId: number; resumeApproved: true }
  | { op: 'job'; action: 'end'; operationId: number; endApproved: true }
  | { op: 'job'; action: 'status' };
export type JobRpcRequest = Start | Next | Control;
export type JobRpcResponse =
  | { id: number; ok: true; result: NativeJobState }
  | {
      id: number;
      ok: false;
      error: { code: 'BAD_INPUT' | 'APPROVAL_REQUIRED' | 'OPERATION_FAILED'; message: string };
    };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).length === expected.length &&
  Object.keys(value).every((key) => expected.includes(key));
function programFields(value: Record<string, unknown>): boolean {
  const markers = ['bladeTrial', 'bladeJob'].filter((key) => Object.hasOwn(value, key));
  const blade = object(value.settings) && value.settings.tool === 'fine_point_blade';
  return (
    markers.length === (blade ? 1 : 0) &&
    markers.every((key) => typeof value[key] === 'string') &&
    typeof value.programDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.programDigest) &&
    Array.isArray(value.pressureRequests) &&
    value.pressureRequests.length > 0 &&
    value.pressureRequests.every(
      (p: unknown) => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535,
    ) &&
    Array.isArray(value.pressureResponsesHex) &&
    value.pressureResponsesHex.every((row: unknown) => typeof row === 'string')
  );
}
/** Independent host envelope admission. Opaque plan/settings still require domain admission. */
export function validateJobRpcRequest(value: unknown): value is JobRpcRequest {
  if (!object(value) || value.op !== 'job') return false;
  const action = value.action;
  if (action === 'start' || action === 'next') {
    const expected = [
      'op',
      'action',
      'plan',
      'settings',
      'pressureResponsesHex',
      'pressureRequests',
      'programDigest',
      'jobTimeout',
    ];
    if (action === 'start') expected.push('timeout', 'motionApproved', 'bladeRemovedConfirmed');
    else expected.push('operationId');
    for (const marker of ['bladeTrial', 'bladeJob'])
      if (Object.hasOwn(value, marker)) expected.push(marker);
    if (!keys(value, expected) || !programFields(value) || value.jobTimeout !== 60) return false;
    if (
      action === 'start' &&
      (value.timeout !== 30 ||
        value.motionApproved !== true ||
        value.bladeRemovedConfirmed !== true)
    )
      return false;
  } else if (action === 'status') return keys(value, ['op', 'action']);
  else if (
    typeof action === 'string' &&
    ['go', 'cancel', 'pause', 'resume', 'end'].includes(action)
  ) {
    const expected = ['op', 'action', 'operationId'];
    if (action === 'go') {
      expected.push('toolConfirmed');
      if (value.bladeInstalledConfirmed === true) expected.push('bladeInstalledConfirmed');
      if (value.toolConfirmed !== true) return false;
    }
    if (action === 'resume') {
      expected.push('resumeApproved');
      if (value.resumeApproved !== true) return false;
    }
    if (action === 'end') {
      expected.push('endApproved');
      if (value.endApproved !== true) return false;
    }
    if (!keys(value, expected)) return false;
  } else return false;
  return (
    action === 'start' ||
    (Number.isSafeInteger(value.operationId) && Number(value.operationId) >= 0)
  );
}
export function startJobRequest(input: Omit<Start, 'op' | 'action'>): Start {
  const value = { op: 'job' as const, action: 'start' as const, ...input };
  if (!validateJobRpcRequest(value)) throw Error('Invalid start request contract.');
  return value;
}
export function nextJobRequest(input: Omit<Next, 'op' | 'action'>): Next {
  const value = { op: 'job' as const, action: 'next' as const, ...input };
  if (!validateJobRpcRequest(value)) throw Error('Invalid next request contract.');
  return value;
}
