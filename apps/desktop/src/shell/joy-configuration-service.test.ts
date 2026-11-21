import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JoyConfigurationService } from './joy-configuration-service';
import { emptyLibrary, library, type JoyConfigurationLibrary } from './joy-configuration-store';
const fixture = JSON.parse(
  readFileSync(new URL('../../native-tests/configuration.synthetic.json', import.meta.url), 'utf8'),
);
function harness() {
  let data: JoyConfigurationLibrary = {
    ...emptyLibrary(),
    profiles: [
      {
        id: 'p',
        name: 'SYNTHETIC TEST ONLY',
        provenance: 'synthetic_test',
        settings: {
          ...fixture.settings,
          profileId: 'p',
          materialId: 1,
          tool: 'pen',
          operation: 'draw',
          pressureRequest: 180,
        },
      },
    ],
    calibrations: [
      {
        id: 'c',
        capturedAt: '2026-01-01T00:00:00.000Z',
        deviceFingerprint: 'a'.repeat(64),
        firmwareSelector: 8.164000001,
        source: 'imported_unverified',
        physicalCalibrationVerified: false,
        pressureResponsesHex: fixture.rows,
      },
    ],
  };
  const requests: Record<string, unknown>[] = [];
  const api = new JoyConfigurationService({
    store: {
      load: async () => structuredClone(data),
      transact: async (f) => {
        data = library(await f(structuredClone(data)));
        return structuredClone(data);
      },
    },
    offline: async (r) => {
      requests.push(r);
      return r.action === 'validate'
        ? { settings: r.settings }
        : {
            execution: 'unsupported',
            safetyValidated: false,
            configurationValidated: false,
            configurationBodyTemplates: [],
          };
    },
    capture: async () => {
      throw Error('No hardware');
    },
  });
  return { api, requests };
}
const source = (materialId: number, tool: 'pen' | 'fine_point_blade') => ({
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M50 50 L80 50"/></svg>',
  materialId,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: {
    '#112233': { tool, operation: tool === 'pen' ? ('draw' as const) : ('cut' as const) },
  },
});
describe('persisted configuration and source recipe compiler', () => {
  it('loads only local metadata and exposes the complete source catalog', async () => {
    const h = harness();
    const c = await h.api.list();
    expect(c.materials).toHaveLength(173);
    expect(new Set(c.materials!.map((m) => m.sourceMaterialId)).size).toBe(96);
    expect(c.materials!.filter((m) => m.passCount > 1)).toHaveLength(17);
    expect(h.requests).toEqual([]);
  });
  it('binds selected persisted settings and calibration to the planner', async () => {
    const h = harness();
    const r = await h.api.compile({ profileId: 'p', calibrationId: 'c', source: source(1, 'pen') });
    expect(r.execution).toBe('unsupported');
    expect(h.requests).toHaveLength(1);
    expect((h.requests[0]!.plan as any).coordinateFrame).toBe('kindcut_canvas_pt72_v1');
  });
  it('requires explicit confirmation and exact source identity, never fuzzy remapping', async () => {
    const h = harness();
    const m = (await h.api.list()).materials![0]!;
    for (const input of [
      { catalogId: m.id, materialId: m.sourceMaterialId, materialName: m.name, confirmed: false },
      { catalogId: m.id, materialId: 78, materialName: m.name, confirmed: true },
    ])
      await expect(h.api.adopt(input as any)).rejects.toThrow();
    expect(h.requests).toEqual([]);
    const adopted = await h.api.adopt({
      catalogId: m.id,
      materialId: m.sourceMaterialId,
      materialName: m.name,
      confirmed: true,
    });
    const p = adopted.profiles.find((p) => p.sourceMaterialId === m.sourceMaterialId)!;
    expect(p.passCount).toBe(m.passCount);
    expect(p.pressureRequests).toEqual(m.pressureRequests);
    expect(adopted.selection).toBeNull();
  });
  it.each([2, 3])('compiles EVERY pass of an actual %i-pass source recipe', async (count) => {
    const h = harness();
    const m = (await h.api.list()).materials!.find(
      (m) => m.passCount === count && m.sourceMaterialId !== 535,
    )!;
    const c = await h.api.adopt({
      catalogId: m.id,
      materialId: m.sourceMaterialId,
      materialName: m.name,
      confirmed: true,
    });
    const p = c.profiles.find((p) => p.sourceMaterialId === m.sourceMaterialId)!;
    await h.api.select({ profileId: p.id, calibrationId: 'c' });
    const r = await h.api.compile({
      profileId: p.id,
      calibrationId: 'c',
      source: source(m.sourceMaterialId, m.tool),
    });
    const calls = h.requests.filter((r) => r.action === 'compile');
    expect(calls).toHaveLength(count);
    expect(calls.map((r) => (r.settings as any).pressureRequest)).toEqual(m.pressureRequests);
    expect(r.passes?.map((p) => p.passNumber)).toEqual(
      Array.from({ length: count }, (_, i) => i + 1),
    );
    expect(r.candidate.passPlan).toEqual({
      count,
      pressures: m.pressureRequests,
      execution: 'unsupported',
    });
  });
  it('rejects a scalar override of a multi-pass recipe BEFORE worker access', async () => {
    const h = harness();
    const m = (await h.api.list()).materials!.find((m) => m.passCount === 2)!;
    const c = await h.api.adopt({
      catalogId: m.id,
      materialId: m.sourceMaterialId,
      materialName: m.name,
      confirmed: true,
    });
    const p = c.profiles.find((p) => p.sourceMaterialId === m.sourceMaterialId)!;
    const before = h.requests.length;
    await expect(h.api.update({ profileId: p.id, pressureRequest: 200 })).rejects.toThrow();
    expect(h.requests.length).toBe(before);
    expect((await h.api.list()).profiles.find((x) => x.id === p.id)?.pressureRequests).toEqual(
      m.pressureRequests,
    );
  });
  it('keeps the single-pass recipe and scalar override consistent', async () => {
    const h = harness();
    const m = (await h.api.list()).materials!.find((m) => m.passCount === 1)!;
    const c = await h.api.adopt({
      catalogId: m.id,
      materialId: m.sourceMaterialId,
      materialName: m.name,
      confirmed: true,
    });
    const p = c.profiles.find((p) => p.sourceMaterialId === m.sourceMaterialId)!;
    const updated = await h.api.update({ profileId: p.id, pressureRequest: 190 });
    expect(updated.profiles.find((x) => x.id === p.id)?.pressureRequests).toEqual([190]);
  });
  it('rejects workspace material mismatch before compilation', async () => {
    const h = harness();
    await expect(
      h.api.compile({ profileId: 'p', calibrationId: 'c', source: source(999, 'pen') }),
    ).rejects.toThrow();
    expect(h.requests).toEqual([]);
  });
  it.each([
    ['pen', 218],
    ['pen', 19],
    ['fine_point_blade', 211],
    ['fine_point_blade', 20],
  ] as const)(
    'automatically preserves exact bundled %s material %i recipes',
    async (tool, materialId) => {
      const h = harness();
      const result = await h.api.ensureMakeSelection(materialId, [tool]);
      const selected = await h.api.exportLibrary();
      const p = selected.profiles.find((p) => p.id === result.profileId)!;
      const catalog = (await h.api.list()).materials!.filter(
        (m) => m.sourceMaterialId === materialId && m.tool === tool,
      );
      expect(catalog).toHaveLength(1);
      expect(p.settings.materialId).toBe(materialId);
      expect(p.settings.tool).toBe(tool);
      expect(p.settings).toMatchObject({
        materialId,
        tool,
        operation: tool === 'pen' ? 'draw' : 'cut',
      });
      expect(p.recipe).toMatchObject({
        catalogId: catalog[0]!.id,
        sourceMaterialId: materialId,
        passCount: catalog[0]!.passCount,
        pressureRequests: catalog[0]!.pressureRequests,
      });
      expect(selected.selection).toEqual({ profileId: result.profileId, calibrationId: 'c' });
    },
  );
  it('never overwrites an existing recipe and preserves multipass pressure ordering', async () => {
    const h = harness();
    const catalog = (await h.api.list()).materials!.find(
      (m) => m.sourceMaterialId === 218 && m.tool === 'pen',
    )!;
    const before = await h.api.exportLibrary();
    const custom = {
      ...before.profiles[0]!,
      id: 'custom218',
      name: 'My recipe',
      settings: {
        ...before.profiles[0]!.settings,
        profileId: 'custom218',
        materialId: 218,
        tool: 'pen',
        pressureRequest: 100,
      },
      recipe: {
        catalogId: catalog.id,
        sourceMaterialId: 218,
        workspaceMaterialName: 'Mine',
        passCount: 1,
        pressureRequests: [100],
      },
    };
    const data = {
      ...before,
      profiles: [...before.profiles, custom],
      selection: { profileId: 'custom218', calibrationId: 'c' },
    };
    const isolated = new JoyConfigurationService({
      store: {
        load: async () => structuredClone(data),
        transact: async (f) => library(await f(structuredClone(data))),
      },
      offline: async (r) => r,
      capture: async () => {
        throw Error();
      },
    });
    const result = await isolated.ensureMakeSelection(218, ['pen']);
    expect(result.profileId).toBe('custom218');
    expect((await isolated.exportLibrary()).profiles.find((p) => p.id === 'custom218')).toEqual(
      custom,
    );
  });
  it('fails closed without exactly one calibration or exact catalog mapping', async () => {
    const h = harness();
    const empty = await h.api.exportLibrary();
    empty.calibrations = [];
    const isolated = new JoyConfigurationService({
      store: {
        load: async () => structuredClone(empty),
        transact: async (f) => library(await f(structuredClone(empty))),
      },
      offline: async (r) => r,
      capture: async () => {
        throw Error();
      },
    });
    await expect(isolated.ensureMakeSelection(218, ['pen'])).rejects.toThrow();
    await expect(h.api.ensureMakeSelection(999999, ['pen'])).rejects.toThrow();
  });
});

it('switches a previously selected different material to the exact new material instead of retaining its tool-kind match', async () => {
  const h = harness();
  await h.api.select({ profileId: 'p', calibrationId: 'c' });
  const selected = await h.api.ensureMakeSelection(218, ['pen', 'fine_point_blade']);
  const lib = await h.api.exportLibrary();
  expect(lib.profiles.find((p) => p.id === selected.profileId)!.settings.materialId).toBe(218);
  expect(selected.calibrationId).toBe('c');
});

it('automatic Make binds calibration to the connected device rather than a different saved device', async () => {
  const h = harness();
  await h.api.storeCalibration({
    ...(await h.api.exportLibrary()).calibrations[0]!,
    id: 'device-b',
    deviceFingerprint: 'b'.repeat(64),
  });
  const selection = await h.api.ensureMakeSelection(218, ['pen'], {
    deviceFingerprint: 'b'.repeat(64),
    firmwareSelector: 8.164000001,
  });
  expect(selection.calibrationId).toBe('device-b');
  await expect(
    h.api.ensureMakeSelection(218, ['pen'], {
      deviceFingerprint: 'c'.repeat(64),
      firmwareSelector: 8.164000001,
    }),
  ).rejects.toThrow();
});
it('automatic Make never resolves ambiguous saved calibration by guessing', async () => {
  const h = harness();
  const c = (await h.api.exportLibrary()).calibrations[0]!;
  await h.api.storeCalibration({ ...c, id: 'duplicate' });
  await expect(
    h.api.ensureMakeSelection(218, ['pen'], {
      deviceFingerprint: c.deviceFingerprint,
      firmwareSelector: c.firmwareSelector,
    }),
  ).rejects.toThrow();
});
