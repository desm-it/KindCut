import { it, expect } from 'vitest';
import { NativeMakeSetupGate } from './native-make-setup-gate';
it('does not prepare until the entire host setup resolves and suppresses concurrent entry', async () => {
  const g = new NativeMakeSetupGate();
  let release!: (v: boolean) => void,
    calls = 0;
  const seen: boolean[] = [];
  const run = () => {
    calls++;
    return new Promise<boolean>((r) => (release = r));
  };
  const a = g.run(run, (v) => seen.push(v));
  await g.run(run, (v) => seen.push(v));
  expect(calls).toBe(1);
  expect(g.ready).toBe(false);
  release(true);
  await a;
  expect(g.ready).toBe(true);
  expect(seen).toEqual([false, true]);
});
it('cannot resurrect readiness after close or a replacement entry', async () => {
  const g = new NativeMakeSetupGate();
  let release!: (v: boolean) => void;
  const seen: boolean[] = [];
  const old = g.run(
    () => new Promise((r) => (release = r)),
    (v) => seen.push(v),
  );
  g.reset();
  await g.run(
    async () => false,
    (v) => seen.push(v),
  );
  release(true);
  await old;
  expect(g.ready).toBe(false);
  expect(seen).toEqual([false, false, false]);
});
it('permits an explicit retry after failure and suppresses rejected setup', async () => {
  const g = new NativeMakeSetupGate();
  await g.run(
    async () => {
      throw Error('No connection');
    },
    () => {},
  );
  expect(g.ready).toBe(false);
  await g.run(
    async () => true,
    () => {},
  );
  expect(g.ready).toBe(true);
});
