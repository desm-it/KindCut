import type { JoyConfigurationService } from './joy-configuration-service';
import type { JoyCalibration } from './joy-configuration-store';
import type { NativeConfigurationSource } from './native-joy-configuration-types';
export interface ConfigurationIpcDependencies {
  register(name: string, handler: (event: unknown, input?: unknown) => Promise<unknown>): void;
  isTrusted(event: unknown): boolean;
  cutterBusy(): boolean;
  service(): JoyConfigurationService;
  native(): {
    loadingApprovalContext(): number;
    captureCalibration(approved: boolean, context: number): Promise<JoyCalibration>;
  };
  confirmRead(): Promise<boolean>;
  readImport(): Promise<unknown | null>;
  writeExport(value: unknown): Promise<boolean>;
}
/** Renderer never supplies file paths, device identity, approvals or raw calibration. */
export function registerNativeJoyConfigurationIpc(d: ConfigurationIpcDependencies) {
  const trusted = (e: unknown) => {
    if (!d.isTrusted(e)) throw new Error('Trusted main-frame sender required.');
  };
  const idle = () => {
    if (d.cutterBusy()) throw new Error('Another cutter session owns the hardware.');
  };
  const add = (name: string, hasInput: boolean, run: (input?: unknown) => Promise<unknown>) =>
    d.register(`native-joy:configuration-${name}`, async (e, input) => {
      trusted(e);
      if (!hasInput && input !== undefined) throw new Error('No renderer fields accepted.');
      try {
        return await run(input);
      } catch {
        throw new Error(
          'Native configuration action failed. Disconnect before importing/preparing; check compatible profiles and calibration.',
        );
      }
    });
  add('list', false, () => d.service().list());
  add('adopt', true, (v) => {
    idle();
    return d
      .service()
      .adopt(v as { catalogId: string; materialId: number; materialName: string; confirmed: true });
  });
  add('import', false, async () => {
    idle();
    const value = await d.readImport();
    if (value === null) return { canceled: true };
    idle();
    return d.service().importLibrary(value);
  });
  add('export', false, async () => ({
    canceled: !(await d.writeExport(await d.service().exportLibrary())),
  }));
  add('select', true, (v) => {
    idle();
    return d.service().select(v);
  });
  add('update', true, async (v) => {
    idle();
    return d.service().update(v);
  });
  add('compile', true, async (v) => {
    idle();
    return d
      .service()
      .compile(
        v as { profileId: string; calibrationId: string; source: NativeConfigurationSource },
      );
  });
  add('capture', false, async () => {
    idle();
    const native = d.native(),
      context = native.loadingApprovalContext();
    if (!(await d.confirmRead())) return { canceled: true };
    idle();
    if (d.native() !== native) throw new Error('Native service changed.');
    const captured = await native.captureCalibration(true, context);
    return d.service().storeCalibration(captured);
  });
}
