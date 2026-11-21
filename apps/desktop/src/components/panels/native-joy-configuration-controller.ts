import type {
  NativeConfigurationCatalog,
  NativeConfigurationCompileResult,
  NativeConfigurationSource,
  NativeJoyConfigurationApi,
} from '../../native-joy-configuration-types';
export interface NativeJoyConfigurationState {
  catalog: NativeConfigurationCatalog | null;
  busy: boolean;
  error: string;
  message: string;
  result: NativeConfigurationCompileResult | null;
}
export const nativeJoyConfigurationInitial = (): NativeJoyConfigurationState => ({
  catalog: null,
  busy: false,
  error: '',
  message: '',
  result: null,
});
export class NativeJoyConfigurationController {
  private state = nativeJoyConfigurationInitial();
  private live = false;
  private workspace: { id: number; name: string } | undefined;
  private generation = 0;
  constructor(
    private api: NativeJoyConfigurationApi | undefined,
    private change: (s: NativeJoyConfigurationState) => void,
    private source: () => Promise<NativeConfigurationSource>,
  ) {}
  async setWorkspaceMaterial(value: { id: number; name: string } | undefined) {
    if (this.workspace?.id !== value?.id || this.workspace?.name !== value?.name) {
      this.workspace = value;
      this.generation++;
      this.invalidateInspection();
    }
  }
  async adopt(catalogId: string, target: { id: number; name: string }, confirmed: boolean) {
    const preset = (
      this.state.catalog as
        | (NativeConfigurationCatalog & {
            materials?: Array<{ id: string; sourceMaterialId: number }>;
          })
        | null
    )?.materials?.find((x) => x.id === catalogId);
    if (
      !preset ||
      preset.sourceMaterialId !== target.id ||
      this.workspace?.id !== target.id ||
      this.workspace?.name !== target.name ||
      !confirmed ||
      this.state.busy
    )
      return;
    const api = this.api as
      | (NativeJoyConfigurationApi & {
          configurationAdopt?: (input: {
            catalogId: string;
            materialId: number;
            materialName: string;
            confirmed: true;
          }) => Promise<NativeConfigurationCatalog>;
        })
      | undefined;
    if (!api?.configurationAdopt) return;
    const generation = this.generation;
    this.invalidateInspection();
    await this.run(async () => {
      const c = await api.configurationAdopt!({
        catalogId,
        materialId: target.id,
        materialName: target.name,
        confirmed: true,
      });
      if (generation !== this.generation) throw Error('stale');
      return c;
    }, 'Preset saved for this workspace material.');
  }
  get snapshot() {
    return {
      ...this.state,
      catalog: this.state.catalog
        ? {
            ...this.state.catalog,
            profiles: [...this.state.catalog.profiles],
            calibrations: [...this.state.catalog.calibrations],
          }
        : null,
    };
  }
  private set(p: Partial<NativeJoyConfigurationState>) {
    if (this.live) {
      this.state = { ...this.state, ...p };
      this.change(this.snapshot);
    }
  }
  async mount() {
    this.live = true;
    if (!this.api) return;
    try {
      const catalog = await this.api.configurationList();
      this.set({ catalog });
    } catch {
      this.set({ error: 'Could not load local Native Joy profiles and calibrations.' });
    }
  }
  dispose() {
    this.live = false;
  }
  invalidateInspection() {
    this.set({ result: null, message: '' });
  }
  async select(profileId: string, calibrationId: string) {
    if (!this.api || this.state.busy) return;
    await this.run(
      async () => this.api!.configurationSelect({ profileId, calibrationId }),
      'Selection saved.',
    );
  }
  async importProfiles() {
    if (!this.api || this.state.busy) return;
    this.set({ busy: true, error: '', message: '', result: null });
    try {
      const r = await this.api.configurationImport();
      if (!this.live) return;
      if ('canceled' in r) {
        this.set({ message: 'Import canceled; nothing changed.' });
        return;
      }
      this.set({ catalog: r, message: 'Profiles imported.' });
    } catch {
      this.set({ error: 'Could not import profiles.' });
    } finally {
      this.set({ busy: false });
    }
  }
  async exportCatalog() {
    if (!this.api || this.state.busy) return;
    this.set({ busy: true, error: '', message: '' });
    try {
      const r = await this.api.configurationExport();
      if (this.live) this.set({ message: r.canceled ? 'Export canceled.' : 'Catalog exported.' });
    } catch {
      this.set({ error: 'Could not export profiles.' });
    } finally {
      this.set({ busy: false });
    }
  }
  async capture() {
    if (!this.api || this.state.busy) return;
    this.set({ busy: true, error: '', message: '', result: null });
    try {
      const r = await this.api.configurationCapture();
      if (!this.live) return;
      if ('canceled' in r) this.set({ message: 'Calibration capture canceled; nothing changed.' });
      else
        this.set({
          catalog: r,
          message: 'Calibration captured; physical calibration remains unverified.',
        });
    } catch {
      this.set({ error: 'Could not capture calibration.' });
    } finally {
      this.set({ busy: false });
    }
  }
  async update(profileId: string, pressureRequest: number) {
    if (
      !this.api ||
      this.state.busy ||
      !Number.isInteger(pressureRequest) ||
      pressureRequest <= 0 ||
      pressureRequest > 65535
    ) {
      this.set({ error: 'Native pressure must be an integer from 1 to 65535.' });
      return;
    }
    await this.run(
      async () => this.api!.configurationUpdate({ profileId, pressureRequest }),
      'Native pressure saved.',
    );
  }
  async prepare() {
    if (!this.api || this.state.busy) return;
    const selection = this.state.catalog?.selection;
    const profile = this.state.catalog?.profiles.find((p) => p.id === selection?.profileId);
    if (!selection || !profile) {
      this.set({ error: 'Select a profile and saved calibration first.' });
      return;
    }
    if (!this.state.catalog?.calibrations.some((c) => c.id === selection.calibrationId)) {
      this.set({ error: 'Select a saved calibration first.' });
      return;
    }
    this.set({ busy: true, error: '', message: '', result: null });
    try {
      const source = await this.source();
      if (!this.live) return;
      if (source.materialId !== profile.materialId) throw Error('material');
      if (Object.values(source.strokeTools).some((t) => t.tool !== profile.tool))
        throw Error('tool');
      const result = await this.api.configurationCompile({
        profileId: profile.id,
        calibrationId: selection.calibrationId,
        source,
      });
      if (!this.live) return;
      const current = await this.source();
      if (!this.live) return;
      if (JSON.stringify(current) !== JSON.stringify(source)) throw Error('stale');
      this.set({
        result,
        message: 'Prepared for inspection only. No device action was performed.',
      });
    } catch (e) {
      if (this.live)
        this.set({
          error:
            e instanceof Error && e.message === 'material'
              ? 'Selected profile material does not match the workspace.'
              : e instanceof Error && e.message === 'tool'
                ? 'Selected profile tool does not match the workspace design.'
                : e instanceof Error && e.message === 'stale'
                  ? 'Workspace changed while preparing; prepare again.'
                  : 'Could not prepare this design for inspection.',
        });
    } finally {
      this.set({ busy: false });
    }
  }
  private async run(f: () => Promise<NativeConfigurationCatalog>, message: string) {
    this.set({ busy: true, error: '', message: '', result: null });
    try {
      const catalog = await f();
      this.set({ catalog, message });
    } catch {
      this.set({ error: 'Could not save configuration.' });
    } finally {
      this.set({ busy: false });
    }
  }
}
