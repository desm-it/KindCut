import { NativeMakeSetupGate } from './native-make-setup-gate';

/** Coordinates one renderer Make entry; device and job policy stays with their controllers. */
export class NativeMakeSessionCoordinator {
  private readonly gate = new NativeMakeSetupGate();
  private visible = false;
  private connectionAttempted = false;
  private activeSource: unknown = null;
  private wasActive = false;
  private observedSource: unknown = undefined;
  private preparedSource: unknown = null;
  private nextAttempted: number | null = null;
  ready = false;

  enter(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.gate.reset();
    this.ready = false;
    this.connectionAttempted = false;
    this.preparedSource = null;
    this.activeSource = null;
    this.wasActive = false;
    this.observedSource = undefined;
    this.nextAttempted = null;
  }

  async connect(connect: () => Promise<boolean>): Promise<void> {
    if (!this.visible) return;
    await this.gate.run(connect, (ready) => {
      if (this.visible) this.ready = ready;
    });
  }

  shouldConnect(): boolean {
    if (!this.visible || this.connectionAttempted) return false;
    this.connectionAttempted = true;
    return true;
  }

  observeJob(active: boolean, historical: boolean, source: unknown): void {
    const running = active && !historical;
    if (running && !this.wasActive) this.activeSource = source;
    this.wasActive = running;
  }

  finishedFor(source: unknown, finished: (source: unknown) => boolean): boolean {
    return (
      this.visible && this.activeSource !== null && this.activeSource === source && finished(source)
    );
  }

  invalidateSource(source: unknown): void {
    if (this.preparedSource !== null && this.preparedSource !== source) this.preparedSource = null;
    if (this.observedSource !== source) {
      this.nextAttempted = null;
      this.observedSource = source;
    }
  }

  claimPrepare(source: unknown): boolean {
    if (!this.visible || this.preparedSource === source) return false;
    this.preparedSource = source;
    return true;
  }

  claimNext(operationId: number): boolean {
    if (!this.visible || this.nextAttempted === operationId) return false;
    this.nextAttempted = operationId;
    return true;
  }
}
