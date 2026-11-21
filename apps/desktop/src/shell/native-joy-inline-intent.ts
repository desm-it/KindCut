import { AsyncLocalStorage } from 'node:async_hooks';
import { isNativeIntent, type NativeIntent } from './native-joy-intent-capture';
export { NATIVE_INTENTS, isNativeIntent, type NativeIntent } from './native-joy-intent-capture';
type Receipt = { action: NativeIntent; binding: string; at: number; version: number };
type Scope = {
  action: NativeIntent;
  at: number;
  used: boolean;
  closed: boolean;
  frame: object;
  version: number;
  epoch: number;
};
/** Host-only, frame/state-bound and one-use. Never exposed by contextBridge. */
export class NativeJoyInlineIntent {
  private tickets = new WeakMap<object, Receipt>();
  private versions = new WeakMap<object, number>();
  private epoch = 0;
  private scope = new AsyncLocalStorage<Scope>();
  constructor(private readonly now: () => number = Date.now) {}
  record(frame: object, action: NativeIntent, binding: string): void {
    if (!isNativeIntent(action) || typeof binding !== 'string' || !binding || binding.length > 4096)
      throw Error('Invalid user action.');
    const at = this.now();
    if (!Number.isFinite(at)) throw Error('Invalid action time.');
    const version = (this.versions.get(frame) ?? 0) + 1;
    this.versions.set(frame, version);
    this.tickets.set(frame, { action, binding, at, version });
  }
  revoke(frame: object): void {
    this.tickets.delete(frame);
    this.versions.set(frame, (this.versions.get(frame) ?? 0) + 1);
  }
  clear(): void {
    this.tickets = new WeakMap();
    this.epoch++;
  }
  private fresh(at: number): boolean {
    const age = this.now() - at;
    return Number.isFinite(age) && age >= 0 && age <= 5000;
  }
  async run<T>(
    frame: object,
    action: NativeIntent,
    binding: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const t = this.tickets.get(frame);
    this.tickets.delete(frame);
    if (!t || t.action !== action || t.binding !== binding || !this.fresh(t.at))
      throw Error('Choose the action in the Make window to continue.');
    const ctx: Scope = {
      action,
      at: t.at,
      used: false,
      closed: false,
      frame,
      version: t.version,
      epoch: this.epoch,
    };
    return this.scope.run(ctx, async () => {
      try {
        return await fn();
      } finally {
        ctx.closed = true;
      }
    });
  }
  assertCurrent(action: NativeIntent): boolean {
    const ctx = this.scope.getStore();
    if (
      !ctx ||
      ctx.closed ||
      !ctx.used ||
      ctx.action !== action ||
      ctx.epoch !== this.epoch ||
      this.versions.get(ctx.frame) !== ctx.version ||
      !this.fresh(ctx.at)
    )
      throw Error('Fresh confirmation in the Make window is required.');
    return true;
  }
  approve(action: NativeIntent): boolean {
    const ctx = this.scope.getStore();
    if (
      !ctx ||
      ctx.closed ||
      ctx.used ||
      ctx.action !== action ||
      ctx.epoch !== this.epoch ||
      this.versions.get(ctx.frame) !== ctx.version ||
      !this.fresh(ctx.at)
    )
      throw Error('Fresh confirmation in the Make window is required.');
    ctx.used = true;
    return true;
  }
}
