import { describe, it, expect, vi } from 'vitest';
import { NativeJoyConfigurationController } from './native-joy-configuration-controller';
import type {
  NativeJoyConfigurationApi,
  NativeConfigurationCatalog,
  NativeConfigurationSource,
} from '../../native-joy-configuration-types';
const profile = {
  id: 'p',
  name: 'Paper',
  materialId: 218,
  tool: 'pen' as const,
  mode: 'precision' as const,
  pressureRequest: 1,
  provenance: 'imported',
};
const cal = {
  id: 'c',
  capturedAt: '2026-01-01',
  firmwareSelector: 1,
  source: 'captured',
  physicalCalibrationVerified: false as const,
};
const catalog: NativeConfigurationCatalog = {
  profiles: [profile],
  calibrations: [cal],
  selection: { profileId: 'p', calibrationId: 'c' },
  materials: [
    {
      id: 'preset-218',
      name: 'Cardstock',
      sourceMaterialId: 218,
      tool: 'pen',
      mode: 'precision',
      passCount: 2,
      pressureRequests: [180, 220],
      provenance: 'source-backed',
    },
  ],
};
const source: NativeConfigurationSource = {
  svg: '<svg/>',
  materialId: 218,
  mat: { widthIn: 4, heightIn: 6 },
  strokeTools: { '#000000': { tool: 'pen', operation: 'draw' } },
};
function fake() {
  return {
    configurationList: vi.fn(async () => catalog),
    configurationAdopt: vi.fn(async () => catalog),
    configurationSelect: vi.fn(async () => catalog),
    configurationUpdate: vi.fn(async () => catalog),
    configurationCompile: vi.fn(async () => ({
      candidate: { pointCount: 2, tool: 'pen' },
      execution: 'unsupported' as const,
      physicalCalibrationVerified: false as const,
    })),
    configurationCapture: vi.fn(async () => catalog),
    configurationImport: vi.fn(async () => catalog),
    configurationExport: vi.fn(async () => ({ canceled: false })),
  } as unknown as NativeJoyConfigurationApi;
}
describe('native Joy configuration controller', () => {
  it('rejects an obsolete matching preset target if the current workspace has a different identity', async () => {
    const api = fake();
    const c = new NativeJoyConfigurationController(api, vi.fn(), async () => source);
    await c.mount();
    await c.setWorkspaceMaterial({ id: 219, name: 'Other' });
    await c.adopt('preset-218', { id: 218, name: 'Cardstock' }, true);
    expect(api.configurationAdopt).not.toHaveBeenCalled();
  });
  it('adopts only an explicitly confirmed preset for the still-current workspace material', async () => {
    const api = fake() as NativeJoyConfigurationApi & {
      configurationAdopt: ReturnType<typeof vi.fn>;
    };
    api.configurationAdopt = vi.fn(async () => catalog);
    const c = new NativeJoyConfigurationController(api, vi.fn(), async () => source);
    await c.mount();
    await c.setWorkspaceMaterial({ id: 218, name: 'Cardstock' });
    await c.adopt('preset-218', { id: 218, name: 'Cardstock' }, true);
    expect(api.configurationAdopt).toHaveBeenCalledWith({
      catalogId: 'preset-218',
      materialId: 218,
      materialName: 'Cardstock',
      confirmed: true,
    });
  });
  it('does not adopt when confirmation is absent or workspace changes during save', async () => {
    const api = fake();
    const c = new NativeJoyConfigurationController(api, vi.fn(), async () => source);
    await c.mount();
    await c.adopt('x', { id: 218, name: 'Cardstock' }, false);
    expect(api.configurationAdopt).not.toHaveBeenCalled();
    let release!: (v: NativeConfigurationCatalog) => void;
    api.configurationAdopt = vi.fn(
      () =>
        new Promise<NativeConfigurationCatalog>((r) => {
          release = r;
        }),
    );
    await c.setWorkspaceMaterial({ id: 218, name: 'Cardstock' });
    const pending = c.adopt('preset-218', { id: 218, name: 'Cardstock' }, true);
    await Promise.resolve();
    await c.setWorkspaceMaterial({ id: 219, name: 'Vinyl' });
    release(catalog);
    await pending;
    expect(c.snapshot.message).not.toBe('Preset saved for this workspace material.');
  });
  it('loads local catalog only and compiles the current supplied source', async () => {
    const api = fake();
    const changes = vi.fn();
    const controller = new NativeJoyConfigurationController(api, changes, async () => source);
    await controller.mount();
    expect(api.configurationList).toHaveBeenCalledOnce();
    expect(api.configurationCapture).not.toHaveBeenCalled();
    await controller.prepare();
    expect(api.configurationCompile).toHaveBeenCalledWith({
      profileId: 'p',
      calibrationId: 'c',
      source,
    });
    expect(controller.snapshot.result?.execution).toBe('unsupported');
    controller.dispose();
  });
  it('rejects a profile whose material does not match the workspace', async () => {
    const api = fake();
    const controller = new NativeJoyConfigurationController(api, vi.fn(), async () => ({
      ...source,
      materialId: 999,
    }));
    await controller.mount();
    await controller.prepare();
    expect(api.configurationCompile).not.toHaveBeenCalled();
    expect(controller.snapshot.error).toMatch(/material/i);
  });
  it('rejects profile tool mismatches and discards a compile if workspace changes', async () => {
    const api = fake();
    const mismatch = new NativeJoyConfigurationController(api, vi.fn(), async () => ({
      ...source,
      strokeTools: { '#000000': { tool: 'fine_point_blade', operation: 'cut' } },
    }));
    await mismatch.mount();
    await mismatch.prepare();
    expect(api.configurationCompile).not.toHaveBeenCalled();
    expect(mismatch.snapshot.error).toMatch(/tool/i);
    let n = 0;
    const staleApi = fake();
    const stale = new NativeJoyConfigurationController(staleApi, vi.fn(), async () =>
      n++ === 0 ? source : { ...source, svg: '<svg changed/>' },
    );
    await stale.mount();
    await stale.prepare();
    expect(stale.snapshot.result).toBeNull();
    expect(stale.snapshot.error).toMatch(/changed/i);
  });
  it('drops a late metadata response after unmount', async () => {
    let resolve!: (c: NativeConfigurationCatalog) => void;
    const api = fake();
    api.configurationList = vi.fn(
      () =>
        new Promise<NativeConfigurationCatalog>((r) => {
          resolve = r;
        }),
    );
    const changes = vi.fn();
    const controller = new NativeJoyConfigurationController(api, changes, async () => source);
    const mounted = controller.mount();
    controller.dispose();
    resolve(catalog);
    await mounted;
    expect(changes).not.toHaveBeenCalled();
  });
  it('invalidates an existing inspection before importing settings or replacing calibration', async () => {
    for (const action of ['importProfiles', 'capture'] as const) {
      const api = fake();
      const c = new NativeJoyConfigurationController(api, vi.fn(), async () => source);
      await c.mount();
      await c.prepare();
      expect(c.snapshot.result).not.toBeNull();
      await c[action]();
      expect(c.snapshot.result).toBeNull();
    }
  });
});
