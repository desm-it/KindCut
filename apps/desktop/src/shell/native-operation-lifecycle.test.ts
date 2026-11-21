import { it, expect } from 'vitest';
import { NativeOperationLifecycle } from './native-operation-lifecycle';
it('serializes actual work and retains the mailbox after a failed action', async () => {
  const owner = new NativeOperationLifecycle<'go'>(),
    events: string[] = [];
  let finish!: () => void;
  const first = owner.enqueue(async () => {
    events.push('first');
    await new Promise<void>((r) => (finish = r));
    throw Error('synthetic action failure');
  });
  const second = owner.enqueue(async () => {
    events.push('second');
    return 42;
  });
  await Promise.resolve();
  expect(events).toEqual(['first']);
  finish();
  await expect(first).rejects.toThrow();
  expect(await second).toBe(42);
  expect(events).toEqual(['first', 'second']);
});
it('keeps reservations and action receipts private to each operation owner', () => {
  const loading = new NativeOperationLifecycle<'go'>(),
    job = new NativeOperationLifecycle<'go'>();
  loading.reserve(true);
  loading.mark('go', true);
  expect(job.reserved).toBe(false);
  expect(job.has('go')).toBe(false);
  loading.resetRequests();
  expect(loading.has('go')).toBe(false);
  expect(loading.reserved).toBe(true);
  loading.reserve(false);
  expect(loading.reserved).toBe(false);
});
