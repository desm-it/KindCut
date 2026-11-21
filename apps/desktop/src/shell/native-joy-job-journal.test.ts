import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NativeJoyJobJournal } from './native-joy-job-journal';
const folders: string[] = [];
async function folder() {
  const p = await fs.mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'kindcut-job-journal-'));
  folders.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});
function event(seq: number) {
  return {
    seq,
    atMs: seq,
    startedMs: null,
    kind: 'stage',
    stage: 'sending',
    txHex: null,
    rxHex: null,
    code: null,
  };
}
function state(total: number, from = 1, terminal = false) {
  return {
    operationId: 1,
    phase: terminal ? 'completed' : 'sending',
    active: !terminal,
    sessionRetired: terminal,
    jobStarted: true,
    programDigest: 'a'.repeat(64),
    tool: 'pen',
    acceptedRecords: terminal ? 4 : 1,
    completedPasses: terminal ? 1 : 0,
    totalRecords: 4,
    totalPasses: 1,
    physicalCompletionVerified: false,
    motionStoppedVerified: false,
    diagnostics: {
      version: 1,
      operationId: 1,
      lastStage: 'sending',
      failure: null,
      events: Array.from({ length: total - from + 1 }, (_, i) => event(from + i)),
      totalEvents: total,
      evictedEvents: from - 1,
      captureIncomplete: false,
    },
  };
}

describe('trusted native job journal', () => {
  it('preflights private storage and preserves every incremental event, not live ring eviction', async () => {
    const d = await folder(),
      j = new NativeJoyJobJournal(d);
    await j.preflight();
    await j.observe(state(2));
    await j.observe(state(4, 3));
    await j.observe(state(6, 5, true));
    const r = (await j.readLatest()) as any;
    expect(r.kind).toBe('kindcut_joy_job_diagnostics');
    expect(r.jobStarted).toBe(true);
    expect(r.completeCapture).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await fs.stat(d)).mode & 0o777).toBe(0o700);
    for (const name of await fs.readdir(d))
      expect((await fs.stat(path.join(d, name))).mode & 0o777).toBe(0o600);
    const restarted = new NativeJoyJobJournal(d),
      history = (await restarted.restoreTerminalState()) as any;
    expect(history.historical).toBe(true);
    expect(history.active).toBe(false);
    expect(history.physicalCompletionVerified).toBe(false);
    expect(history.jobStarted).toBe(true);
  });
  it('marks missing sequences and active capture truthfully', async () => {
    const j = new NativeJoyJobJournal(await folder());
    await j.preflight();
    await j.observe(state(3, 2));
    let r = (await j.readLatest()) as any;
    expect(r.completeCapture).toBe(false);
    expect(r.gaps).toEqual([[1, 1]]);
    expect(await j.restoreTerminalState()).toBeNull();
    await j.observe(state(4, 4, true));
    r = (await j.readLatest()) as any;
    expect(r.completeCapture).toBe(false);
    expect(r.gaps).toEqual([[1, 1]]);
  });
  it('rejects changed history and wrong operation without overwriting the accepted journal', async () => {
    const j = new NativeJoyJobJournal(await folder());
    await j.preflight();
    await j.observe(state(2));
    const changed = state(3);
    changed.diagnostics.events[0]!.stage = 'draining';
    await expect(j.observe(changed)).rejects.toThrow();
    const other = state(3);
    other.operationId = 2;
    other.diagnostics.operationId = 2;
    await expect(j.observe(other)).rejects.toThrow();
    expect(((await j.readLatest()) as any).totalEvents).toBe(2);
  });
  it('exports through a host-selected path with readback and refuses symlink reports', async () => {
    const d = await folder(),
      j = new NativeJoyJobJournal(d);
    await j.preflight();
    await j.observe(state(2, 1, true));
    const target = path.join(await folder(), 'export.json');
    await j.exportTo(target);
    expect(JSON.parse(await fs.readFile(target, 'utf8')).jobStarted).toBe(true);
    const pointer = JSON.parse(await fs.readFile(path.join(d, 'latest.json'), 'utf8')),
      report = path.join(d, `job-${pointer.reportId}.json`);
    await fs.unlink(report);
    await fs.symlink(target, report);
    await expect(j.readLatest()).rejects.toThrow();
  });
  it('rejects a symlink directory before job dispatch and never accepts renderer paths', async () => {
    const d = await folder(),
      target = await folder(),
      link = path.join(d, 'link');
    await fs.symlink(target, link);
    await expect(new NativeJoyJobJournal(link).preflight()).rejects.toThrow();
    expect(() => new NativeJoyJobJournal('relative/renderer-path')).toThrow();
  });
});

describe('interrupted observations grant no replay authority', () => {
  it('exposes an active saved attempt as interrupted without falsifying or rewriting its state', async () => {
    const d = await folder(),
      j = new NativeJoyJobJournal(d);
    await j.preflight();
    await j.observe(state(3));
    const restarted = new NativeJoyJobJournal(d),
      before = await restarted.readLatest();
    expect(await restarted.restoreTerminalState()).toBeNull();
    const info = await restarted.recoveryInfo();
    expect(info).toMatchObject({
      status: 'interrupted',
      lastKnownPhase: 'sending',
      jobStarted: true,
      acceptedRecords: 1,
      machineState: 'unknown',
      canResume: false,
      requiresFreshApproval: true,
      captureComplete: false,
    });
    expect(await restarted.readLatest()).toEqual(before);
    expect(before.active).toBe(true);
  });
  it('treats a preflight without a recorded worker result as uncertain, not proof nothing moved', async () => {
    const j = new NativeJoyJobJournal(await folder());
    await j.preflight();
    expect(await j.recoveryInfo()).toMatchObject({
      status: 'interrupted',
      operationId: null,
      lastKnownPhase: 'not_started',
      jobStarted: false,
      machineState: 'unknown',
      canResume: false,
      captureComplete: false,
    });
  });
  it('returns no observation when absent and keeps terminal physical state unknown', async () => {
    const d = await folder(),
      j = new NativeJoyJobJournal(d);
    expect(await j.recoveryInfo()).toBeNull();
    await j.preflight();
    await j.observe(state(2, 1, true));
    expect(await new NativeJoyJobJournal(d).recoveryInfo()).toMatchObject({
      status: 'completed',
      captureComplete: true,
      machineState: 'unknown',
      canResume: false,
    });
  });
});
