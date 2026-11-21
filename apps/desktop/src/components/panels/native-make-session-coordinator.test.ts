import { expect, it } from 'vitest';
import { NativeMakeSessionCoordinator } from './native-make-session-coordinator';

it('ignores setup completion from a closed entry after a fresh entry starts', async () => {
  const c = new NativeMakeSessionCoordinator();
  c.enter(true);
  let release!: (v: boolean) => void;
  const old = c.connect(() => new Promise<boolean>((r) => (release = r)));
  c.enter(false);
  c.enter(true);
  await c.connect(async () => false);
  release(true);
  await old;
  expect(c.ready).toBe(false);
});
it('requires one connection per explicit entry, including a reused device session', async () => {
  const c = new NativeMakeSessionCoordinator();
  let n = 0;
  c.enter(true);
  expect(c.shouldConnect()).toBe(true);
  expect(c.shouldConnect()).toBe(false);
  await c.connect(async () => {
    n++;
    return true;
  });
  c.enter(false);
  c.enter(true);
  expect(c.shouldConnect()).toBe(true);
  await c.connect(async () => {
    n++;
    return true;
  });
  expect(n).toBe(2);
});
it('invalidates prepared source and retry claims on source change and close', () => {
  const c = new NativeMakeSessionCoordinator();
  const a = {},
    b = {};
  c.enter(true);
  expect(c.claimPrepare(a)).toBe(true);
  expect(c.claimPrepare(a)).toBe(false);
  c.invalidateSource(b);
  expect(c.claimPrepare(b)).toBe(true);
  expect(c.claimNext(7)).toBe(true);
  expect(c.claimNext(7)).toBe(false);
  c.enter(false);
  c.enter(true);
  expect(c.claimNext(7)).toBe(true);
  expect(c.claimPrepare(b)).toBe(true);
});
it('binds completion to the current explicit Make source and ignores history', () => {
  const c = new NativeMakeSessionCoordinator(),
    a = {},
    b = {};
  c.enter(true);
  c.observeJob(true, true, a);
  expect(c.finishedFor(a, () => true)).toBe(false);
  c.observeJob(true, false, a);
  expect(c.finishedFor(a, () => true)).toBe(true);
  expect(c.finishedFor(b, () => true)).toBe(false);
  c.enter(false);
  expect(c.finishedFor(a, () => true)).toBe(false);
});

it('keeps completed-source identity after activity stops and never adopts a different source', () => {
  const c = new NativeMakeSessionCoordinator(),
    a = {},
    b = {};
  c.enter(true);
  c.observeJob(true, false, a);
  c.observeJob(false, false, a);
  expect(c.finishedFor(a, () => true)).toBe(true);
  c.observeJob(false, false, b);
  expect(c.finishedFor(b, () => true)).toBe(false);
  c.observeJob(true, false, b);
  c.observeJob(false, false, b);
  expect(c.finishedFor(b, () => true)).toBe(true);
});
it('does not re-arm the same operation on repeated snapshots of the same source', () => {
  const c = new NativeMakeSessionCoordinator(),
    source = {};
  c.enter(true);
  c.invalidateSource(source);
  expect(c.claimNext(9)).toBe(true);
  c.invalidateSource(source);
  expect(c.claimNext(9)).toBe(false);
  c.invalidateSource({});
  expect(c.claimNext(9)).toBe(true);
});
