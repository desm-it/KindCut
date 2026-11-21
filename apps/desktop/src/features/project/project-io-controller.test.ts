import { it, expect } from 'vitest';
import { createProjectIoController, type ProjectIoPorts } from './project-io-controller';
import {
  buildProjectFile,
  DEFAULT_TOOLS,
  DEFAULT_PAPER_COLOR,
  serializeProjectFile,
} from '../../project-file';
function fixture() {
  const events: string[] = [];
  const project = buildProjectFile({
    name: 'Synthetic project',
    selectedMaterialId: 218,
    selectedMatPreset: 'joy-small',
    measurementUnit: 'in',
    tools: DEFAULT_TOOLS,
    paperColor: DEFAULT_PAPER_COLOR,
    importedSvg: null,
    importedSvgs: [],
    workspaceObjects: [],
    selectedObjectId: null,
    selectedSvgId: null,
  });
  let signature = 'snapshot-A',
    saved: string | undefined,
    path: string | null = null;
  const ports: ProjectIoPorts = {
    getApi: () => ({
      open: async () => ({
        canceled: false,
        path: '/synthetic/project.kindcut',
        content: serializeProjectFile(project),
      }),
      openPath: async () => ({
        canceled: false,
        path: '/synthetic/project.kindcut',
        content: serializeProjectFile(project),
      }),
      save: async (input) => {
        events.push('save:' + String(input.currentPath));
        return { canceled: false, path: '/synthetic/saved.kindcut' };
      },
    }),
    document: {
      snapshot: () => project,
      signature: () => signature,
      apply: () => events.push('apply'),
    },
    view: {
      message: () => events.push('message'),
      saving: (v) => events.push('saving:' + v),
      opening: (v) => events.push('opening:' + v),
      enter: () => events.push('enter'),
    },
    session: {
      path: () => path,
      setPath: (p) => (path = p),
      saved: (s) => {
        saved = s;
        events.push('saved');
      },
    },
    recent: {
      record: (p) => events.push('recent:' + p),
      forget: () => events.push('forget'),
      error: () => events.push('recent-error'),
    },
    translate: (key) => key,
    debug: false,
  };
  return {
    ports,
    events,
    edit: () => (signature = 'snapshot-B'),
    saved: () => saved,
    path: () => path,
  };
}
it('saves the captured document signature and supports Save As without overwriting the old path', async () => {
  const f = fixture();
  const api = f.ports.getApi()!;
  f.ports.getApi = () => ({
    ...api,
    save: async (input) => {
      expect(input.currentPath).toBeNull();
      f.edit();
      return { canceled: false, path: '/synthetic/saved.kindcut' };
    },
  });
  expect(await createProjectIoController(f.ports).save({ saveAs: true })).toBe(true);
  expect(f.saved()).toBe('snapshot-A');
  expect(f.path()).toBe('/synthetic/saved.kindcut');
  expect(f.events).toContain('saving:false');
});
it('opens through the real parser and applies before recording recent metadata', async () => {
  const f = fixture();
  await createProjectIoController(f.ports).open();
  expect(f.events.indexOf('apply')).toBeLessThan(
    f.events.indexOf('recent:/synthetic/project.kindcut'),
  );
  expect(f.events.at(-1)).toBe('opening:false');
});
it('canceled save never acknowledges a clean signature or navigates', async () => {
  const f = fixture(),
    api = f.ports.getApi()!;
  f.ports.getApi = () => ({ ...api, save: async () => ({ canceled: true }) });
  expect(await createProjectIoController(f.ports).save()).toBe(false);
  expect(f.saved()).toBeUndefined();
  expect(f.events).not.toContain('enter');
});
it('failed recent-file open removes only that recent entry and always releases busy state', async () => {
  const f = fixture(),
    api = f.ports.getApi()!;
  f.ports.getApi = () => ({
    ...api,
    openPath: async () => {
      throw Error('Synthetic missing file');
    },
  });
  await createProjectIoController(f.ports).openRecent('/synthetic/missing.kindcut');
  expect(f.events).toContain('forget');
  expect(f.events).toContain('recent-error');
  expect(f.events.at(-1)).toBe('opening:false');
});
