import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NativeJoyLoadingJournal } from './native-joy-loading-journal';
import type { NativeJoyLoadingState } from './native-joy-service';
async function fixture() {
  const base = process.env.TMPDIR ?? path.resolve('node_modules/.cache');
  await fs.mkdir(base, { recursive: true });
  const folder = await fs.mkdtemp(path.join(base, 'joy-diagnostic-test-'));
  return { folder, j: new NativeJoyLoadingJournal(path.join(folder, 'diagnostics')) };
}
function state(seq = 1, evicted = 0): NativeJoyLoadingState {
  return {
    operationId: 1,
    phase: 'failed',
    active: false,
    sessionRetired: true,
    physicalLoadingVerified: false,
    physicalAlignmentVerified: false,
    motionStoppedVerified: false,
    jobStarted: false,
    diagnostics: {
      version: 1,
      operationId: 1,
      lastStage: 'closing',
      failure: { stage: 'precheck', code: 'unexpected_reply', errorType: 'ValueError' },
      events: [
        {
          seq,
          atMs: seq * 10,
          startedMs: seq * 10 - 1,
          kind: 'exchange',
          stage: 'precheck',
          txHex: '0002eb00',
          rxHex: '000114',
          code: null,
        },
      ],
      totalEvents: seq,
      evictedEvents: evicted,
      captureIncomplete: false,
    },
  };
}
describe('private durable loading journal', () => {
  it('restores terminal diagnostics as read-only history, never as an active hardware owner', async () => {
    const f = await fixture();
    try {
      await f.j.prepare(12);
      await f.j.record(state());
      const restored = await new NativeJoyLoadingJournal(f.j.directory).restoreTerminalState();
      expect(restored?.phase).toBe('failed');
      expect(restored?.active).toBe(false);
      expect(restored?.historical).toBe(true);
      expect(restored?.diagnostics?.failure?.stage).toBe('precheck');
      expect(restored?.jobStarted).toBe(false);
      await f.j.prepare(12);
      const active = state();
      active.active = true;
      active.phase = 'waiting_for_go';
      active.sessionRetired = false;
      await f.j.record(active);
      expect(await new NativeJoyLoadingJournal(f.j.directory).restoreTerminalState()).toBe(null);
    } finally {
      await fs.rm(f.folder, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked latest pointer before reading its target', async () => {
    const f = await fixture();
    try {
      await f.j.prepare(12);
      await f.j.record(state());
      const pointer = path.join(f.j.directory, 'latest.json'),
        copy = path.join(f.folder, 'pointer-copy.json');
      await fs.copyFile(pointer, copy);
      await fs.rm(pointer);
      await fs.symlink(copy, pointer);
      await expect(new NativeJoyLoadingJournal(f.j.directory).readLatest()).rejects.toThrow(
        /diagnostic/i,
      );
    } finally {
      await fs.rm(f.folder, { recursive: true, force: true });
    }
  });
  it('reconstructs more than one ring window without losing the prefix', async () => {
    const f = await fixture();
    try {
      await f.j.prepare(12);
      const a = state();
      a.active = true;
      a.phase = 'waiting_for_go';
      a.sessionRetired = false;
      a.diagnostics!.failure = null;
      a.diagnostics!.events = Array.from({ length: 512 }, (_, i) => ({
        ...a.diagnostics!.events[0]!,
        seq: i + 1,
        atMs: i + 1,
        startedMs: i,
      }));
      a.diagnostics!.totalEvents = 512;
      await f.j.record(a);
      const b = state();
      b.diagnostics!.events = Array.from({ length: 512 }, (_, i) => ({
        ...b.diagnostics!.events[0]!,
        seq: i + 513,
        atMs: i + 513,
        startedMs: i + 512,
      }));
      b.diagnostics!.evictedEvents = 512;
      b.diagnostics!.totalEvents = 1024;
      await f.j.record(b);
      const r = await f.j.readLatest();
      expect(r.events).toHaveLength(1024);
      expect(r.completeCapture).toBe(true);
    } finally {
      await fs.rm(f.folder, { recursive: true, force: true });
    }
  });

  it('creates nothing at construction; persists complete failed trace privately, reloads and exports', async () => {
    const f = await fixture();
    try {
      await expect(fs.stat(f.j.directory)).rejects.toThrow();
      await f.j.prepare(12);
      await f.j.record(state());
      const r = await f.j.readLatest();
      expect(r.failure?.stage).toBe('precheck');
      expect(r.completeCapture).toBe(true);
      expect(r.events[0]?.rxHex).toBe('000114');
      expect((await fs.stat(f.j.directory)).mode & 0o777).toBe(0o700);
      const reloaded = new NativeJoyLoadingJournal(f.j.directory);
      expect(await reloaded.readLatest()).toEqual(r);
      const out = path.join(f.folder, 'export.json');
      await reloaded.exportTo(out);
      expect(JSON.parse(await fs.readFile(out, 'utf8'))).toEqual(r);
      expect((await fs.stat(out)).mode & 0o777).toBe(0o600);
    } finally {
      await fs.rm(f.folder, { recursive: true, force: true });
    }
  });
  it('merges earlier polls through ring evictions and distinguishes a genuine missing prefix', async () => {
    const f = await fixture();
    try {
      await f.j.prepare(12);
      const first = state();
      first.active = true;
      first.phase = 'waiting_for_mat';
      first.sessionRetired = false;
      await f.j.record(first);
      await f.j.record(state(2, 1));
      const r = await f.j.readLatest();
      expect(r.events.map((e: any) => e.seq)).toEqual([1, 2]);
      expect(r.completeCapture).toBe(true);
      await f.j.prepare(12);
      await f.j.record(state(2, 1));
      const lost = await f.j.readLatest();
      expect(lost.completeCapture).toBe(false);
      expect(lost.gaps).toEqual([[1, 1]]);
      expect(lost.reportId).not.toBe(r.reportId);
    } finally {
      await fs.rm(f.folder, { recursive: true, force: true });
    }
  });
  it('rejects cross-attempt mutation and does not export tampered metadata or follow a directory symlink', async () => {
    const f = await fixture();
    try {
      await f.j.prepare(12);
      await f.j.record(state());
      const mutated = state();
      mutated.diagnostics!.events[0]!.rxHex = 'ffff';
      await expect(f.j.record(mutated)).rejects.toThrow(/diagnostic/i);
      const r = await f.j.readLatest();
      const file = path.join(f.j.directory, `loading-${r.reportId}.json`);
      await fs.writeFile(file, JSON.stringify({ ...r, secret: 'DO_NOT_EXPORT' }));
      await expect(
        new NativeJoyLoadingJournal(f.j.directory).exportTo(path.join(f.folder, 'out.json')),
      ).rejects.toThrow(/diagnostic/i);
      const link = path.join(f.folder, 'link');
      await fs.symlink(f.j.directory, link);
      await expect(new NativeJoyLoadingJournal(link).prepare(12)).rejects.toThrow(/diagnostic/i);
    } finally {
      await fs.rm(f.folder, { recursive: true, force: true });
    }
  });
});
