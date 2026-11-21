import { routeCutterBackend } from './cutter-routing';
export type CutterBackend = 'auto' | 'native' | 'slicebug';

export interface CutterEntryPorts<T> {
  acquire(): boolean;
  release(): void;
  readBackend(): Promise<CutterBackend>;
  nativeOwnsHardware(): boolean;
  confirmFallback(): Promise<boolean>;
  confirmDisconnect(): Promise<boolean>;
  disconnectNative(): Promise<void>;
  start(): Promise<T>;
}

export async function acquireCutterEntry<T>(ports: CutterEntryPorts<T>): Promise<T> {
  // This must happen before the first await so overlapping IPC calls cannot both enter.
  if (!ports.acquire()) throw new Error('A cutter session is already starting.');
  try {
    const backend = await ports.readBackend();
    if (!['auto', 'native', 'slicebug'].includes(backend))
      throw new Error('Invalid cutter backend. Re-select it in Settings.');
    const route = routeCutterBackend(backend, 'cut', false);
    if (route === 'blocked' && backend === 'native') {
      throw new Error(
        'Native cutting is not available yet. Choose SliceBug in Settings to cut, or Auto for supported native operations.',
      );
    }
    if (backend === 'auto' && !(await ports.confirmFallback())) {
      throw new Error(
        'Cut canceled. Choose SliceBug in Settings or explicitly confirm this SliceBug cut.',
      );
    }
    if (ports.nativeOwnsHardware()) {
      if (!(await ports.confirmDisconnect()))
        throw new Error('Cut canceled; the native session remains connected.');
      await ports.disconnectNative();
    }
    if (ports.nativeOwnsHardware())
      throw new Error('Native hardware ownership could not be released.');
    return await ports.start();
  } finally {
    ports.release();
  }
}
