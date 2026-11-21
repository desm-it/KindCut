/** A per-operation mailbox; never grants hardware authority or changes a session generation. */
export class NativeOperationLifecycle<Action extends string> {
  private tail: Promise<void> = Promise.resolve();
  private reservation = false;
  private requested = new Set<Action>();
  settled() {
    return this.tail;
  }
  get reserved() {
    return this.reservation;
  }
  reserve(value: boolean) {
    this.reservation = value;
  }
  has(action: Action) {
    return this.requested.has(action);
  }
  mark(action: Action, value: boolean) {
    if (value) this.requested.add(action);
    else this.requested.delete(action);
  }
  resetRequests() {
    this.requested.clear();
  }
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
