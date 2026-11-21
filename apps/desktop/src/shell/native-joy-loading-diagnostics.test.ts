import { describe, it, expect } from 'vitest';
import { readLoadingDiagnostics } from './native-joy-loading-diagnostics';
export function diagnosticFixture() {
  return {
    version: 1,
    operationId: 1,
    lastStage: 'precheck',
    failure: { stage: 'precheck', code: 'unexpected_reply', errorType: 'ValueError' },
    events: [
      {
        seq: 1,
        atMs: 12,
        startedMs: 10,
        kind: 'exchange',
        stage: 'precheck',
        txHex: '0002eb00',
        rxHex: '000114',
        code: null,
      },
    ],
    totalEvents: 1,
    evictedEvents: 0,
    captureIncomplete: false,
  };
}
describe('trusted loading diagnostics DTO', () => {
  it('accepts the source-owned deadline/cancel/material exception classes', () => {
    for (const type of ['OperationDeadline', 'OperationCancelled', 'MaterialLost']) {
      const x = diagnosticFixture();
      x.failure.errorType = type;
      expect(readLoadingDiagnostics(x, 1).failure?.errorType).toBe(type);
    }
  });

  it('preserves exact unexpected reply bytes and first failure without sharing mutable input', () => {
    const x = diagnosticFixture();
    const d = readLoadingDiagnostics(x, 1);
    expect(d.events[0]?.rxHex).toBe('000114');
    expect(d.failure?.code).toBe('unexpected_reply');
    x.events[0]!.rxHex = '0000';
    x.failure.stage = 'closing';
    expect(d.events[0]?.rxHex).toBe('000114');
    expect(d.failure?.stage).toBe('precheck');
  });
  it('accepts an explicitly wrapped ring without inventing completeness', () => {
    const x = diagnosticFixture();
    x.evictedEvents = 9;
    x.totalEvents = 10;
    x.events[0]!.seq = 10;
    expect(readLoadingDiagnostics(x, 1).evictedEvents).toBe(9);
  });
  it('rejects foreign operations, extra fields, invalid counters, hex and time', () => {
    const base = diagnosticFixture();
    const mutations: Array<(x: any) => void> = [
      (x) => (x.operationId = 2),
      (x) => (x.version = 2),
      (x) => (x.totalEvents = 3),
      (x) => (x.events[0].seq = 0),
      (x) => (x.events[0].atMs = NaN),
      (x) => (x.events[0].startedMs = 20),
      (x) => (x.events[0].txHex = 'not hex'),
      (x) => (x.events[0].rxHex = 'a'.repeat(1026)),
      (x) => (x.events[0].extra = 'secret'),
      (x) => (x.failure.message = 'Bearer SECRET'),
      (x) => (x.lastStage = 'device AA:BB:CC:DD:EE:FF'),
      (x) => (x.failure.code = 'Authorization: SECRET'),
      (x) => (x.failure.errorType = 'UnknownType'),
      (x) => (x.events = Array(513).fill(x.events[0])),
      (x) => (x.captureIncomplete = 'false'),
    ];
    for (const mutate of mutations) {
      const x = structuredClone(base);
      mutate(x);
      expect(() => readLoadingDiagnostics(x, 1)).toThrow(/diagnostic/i);
    }
  });
});
