/** Make-entry readiness is completed by the host, not by early connection metadata. */
export class NativeMakeSetupGate {
  private epoch = 0;
  private pending = false;
  ready = false;
  reset() {
    this.epoch++;
    this.pending = false;
    this.ready = false;
  }
  async run(connect: () => Promise<boolean>, publish: (ready: boolean) => void): Promise<void> {
    if (this.pending) return;
    const epoch = this.epoch;
    this.pending = true;
    this.ready = false;
    publish(false);
    try {
      const ready = await connect();
      if (epoch === this.epoch) {
        this.ready = ready;
        publish(ready);
      }
    } catch {
      if (epoch === this.epoch) {
        this.ready = false;
        publish(false);
      }
    } finally {
      if (epoch === this.epoch) this.pending = false;
    }
  }
}
