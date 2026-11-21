import { it, expect } from 'vitest';
import { validateJobRpcRequest } from './native-joy-rpc';
import vectors from '../../../..//packages/joy-runtime/contracts/job-rpc-vectors.json';
it('accepts and rejects the shared job RPC contract vectors', () => {
  for (const v of vectors.accepted) expect(validateJobRpcRequest(v)).toBe(true);
  for (const v of vectors.rejected) expect(validateJobRpcRequest(v)).toBe(false);
});
it('keeps hostile unknown input closed before asserting contract validity', () => {
  expect(
    validateJobRpcRequest({
      op: 'job',
      action: 'start',
      timeout: 30,
      jobTimeout: 60,
      motionApproved: true,
      bladeRemovedConfirmed: true,
      programDigest: 'a'.repeat(64),
      pressureRequests: [1],
      plan: {},
      settings: { tool: 'pen' },
      extra: true,
    }),
  ).toBe(false);
});

it('closes scalar identities and tool markers before claiming a typed request', () => {
  const base = vectors.accepted[0]!;
  for (const value of [
    { ...base, settings: { tool: 'fine_point_blade' } },
    { ...base, bladeJob: 'general', bladeTrial: 'trial' },
    { ...base, settings: { tool: 'fine_point_blade' }, bladeJob: 1 },
    { ...vectors.accepted[1]!, operationId: -1 },
  ])
    expect(validateJobRpcRequest(value)).toBe(false);
});

import Ajv2020 from 'ajv/dist/2020';
import schema from '../../../../packages/joy-runtime/contracts/job-rpc-v1.schema.json';
it('keeps the versioned schema and the independent host validator aligned with shared vectors', () => {
  const validate = new Ajv2020({ strict: false }).compile(schema);
  for (const value of vectors.accepted) expect(validate(value)).toBe(true);
  for (const value of vectors.rejected) expect(validate(value)).toBe(false);
});

it('rejects a non-string action without coercing arbitrary input', () => {
  expect(
    validateJobRpcRequest({
      op: 'job',
      action: {
        toString() {
          throw Error('Must not coerce');
        },
      },
      operationId: 1,
    }),
  ).toBe(false);
});
