import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export interface JoySettingsProfile {
  id: string;
  name: string;
  provenance: string;
  settings: Record<string, unknown>;
  recipe?: {
    catalogId: string;
    sourceMaterialId: number;
    workspaceMaterialName: string;
    passCount: number;
    pressureRequests: number[];
  };
}
export interface JoyCalibration {
  id: string;
  capturedAt: string;
  deviceFingerprint: string;
  firmwareSelector: number;
  source: string;
  physicalCalibrationVerified: false;
  pressureResponsesHex: string[];
}
export interface JoyConfigurationLibrary {
  schemaVersion: 1;
  kind: 'kindcut_joy_configuration_library';
  profiles: JoySettingsProfile[];
  calibrations: JoyCalibration[];
  selection: { profileId: string; calibrationId: string } | null;
}
export const emptyLibrary = (): JoyConfigurationLibrary => ({
  schemaVersion: 1,
  kind: 'kindcut_joy_configuration_library',
  profiles: [],
  calibrations: [],
  selection: null,
});
const fail = () => new Error('Native Joy configuration library is invalid or unavailable.');
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail();
  return v as Record<string, unknown>;
}
export function exact(v: Record<string, unknown>, keys: string[]) {
  if (Object.keys(v).length !== keys.length || Object.keys(v).some((k) => !keys.includes(k)))
    throw fail();
}
export function identifier(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(v)) throw fail();
  return v;
}
export function calibration(v: unknown): JoyCalibration {
  const c = record(v);
  exact(c, [
    'id',
    'capturedAt',
    'deviceFingerprint',
    'firmwareSelector',
    'source',
    'physicalCalibrationVerified',
    'pressureResponsesHex',
  ]);
  identifier(c.id);
  if (
    typeof c.capturedAt !== 'string' ||
    c.capturedAt.length > 40 ||
    !Number.isFinite(Date.parse(c.capturedAt)) ||
    typeof c.deviceFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(c.deviceFingerprint) ||
    c.firmwareSelector !== 8.164000001 ||
    !['device_pressure_table_read', 'imported_unverified'].includes(String(c.source)) ||
    c.physicalCalibrationVerified !== false
  )
    throw fail();
  if (!Array.isArray(c.pressureResponsesHex) || c.pressureResponsesHex.length !== 16) throw fail();
  c.pressureResponsesHex.forEach((x, n) => {
    if (
      typeof x !== 'string' ||
      !/^[a-f0-9]{22}$/i.test(x) ||
      x.slice(0, 6).toLowerCase() !== `a0${(n + 1).toString(16).padStart(4, '0')}`
    )
      throw fail();
  });
  return structuredClone(c) as unknown as JoyCalibration;
}
export function library(v: unknown): JoyConfigurationLibrary {
  const d = record(v);
  exact(d, ['schemaVersion', 'kind', 'profiles', 'calibrations', 'selection']);
  if (
    d.schemaVersion !== 1 ||
    d.kind !== 'kindcut_joy_configuration_library' ||
    !Array.isArray(d.profiles) ||
    d.profiles.length > 256 ||
    !Array.isArray(d.calibrations) ||
    d.calibrations.length > 32
  )
    throw fail();
  const ids = new Set<string>();
  for (const p0 of d.profiles) {
    const p = record(p0);
    if (
      !['id', 'name', 'provenance', 'settings'].every((k) => k in p) ||
      Object.keys(p).some((k) => !['id', 'name', 'provenance', 'settings', 'recipe'].includes(k))
    )
      throw fail();
    const id = identifier(p.id);
    if (ids.has(id)) throw fail();
    ids.add(id);
    if (
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 128 ||
      typeof p.provenance !== 'string' ||
      p.provenance.length > 256
    )
      throw fail();
    const s = record(p.settings);
    exact(s, [
      'schemaVersion',
      'materialId',
      'tool',
      'operation',
      'mode',
      'context',
      'profileId',
      'pressureRequest',
      'speeds',
      'nonXY',
      'geometry',
    ]);
    if (
      s.profileId !== id ||
      !Number.isSafeInteger(s.materialId) ||
      Number(s.materialId) < 1 ||
      !['pen', 'fine_point_blade'].includes(String(s.tool)) ||
      !Number.isInteger(s.pressureRequest) ||
      Number(s.pressureRequest) < 1 ||
      Number(s.pressureRequest) > 65535
    )
      throw fail();
    if (p.recipe !== undefined) {
      const r = record(p.recipe);
      exact(r, [
        'catalogId',
        'sourceMaterialId',
        'workspaceMaterialName',
        'passCount',
        'pressureRequests',
      ]);
      identifier(r.catalogId);
      if (
        !Number.isSafeInteger(r.sourceMaterialId) ||
        r.sourceMaterialId !== s.materialId ||
        typeof r.workspaceMaterialName !== 'string' ||
        !r.workspaceMaterialName.trim() ||
        r.workspaceMaterialName.length > 128 ||
        !Number.isInteger(r.passCount) ||
        Number(r.passCount) < 1 ||
        Number(r.passCount) > 3 ||
        !Array.isArray(r.pressureRequests) ||
        r.pressureRequests.length !== r.passCount ||
        r.pressureRequests.some(
          (x) => !Number.isInteger(x) || Number(x) < 1 || Number(x) > 65535,
        ) ||
        r.pressureRequests[0] !== s.pressureRequest
      )
        throw fail();
    }
  }
  const cids = new Set<string>();
  for (const c0 of d.calibrations) {
    const c = calibration(c0);
    if (cids.has(c.id)) throw fail();
    cids.add(c.id);
  }
  if (d.selection !== null) {
    const s = record(d.selection);
    exact(s, ['profileId', 'calibrationId']);
    if (!ids.has(identifier(s.profileId)) || !cids.has(identifier(s.calibrationId))) throw fail();
  }
  return structuredClone(d) as unknown as JoyConfigurationLibrary;
}
export async function readConfigurationFile(file: string): Promise<JoyConfigurationLibrary> {
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await h.stat();
    if (!s.isFile() || s.size > 2 * 1024 * 1024) throw fail();
    const data = await h.readFile();
    if (data.length > 2 * 1024 * 1024) throw fail();
    return library(JSON.parse(data.toString('utf8')));
  } finally {
    await h.close();
  }
}
/** Export only to a host-selected path; atomic replace, never follow a target symlink. */
export async function exportConfigurationLibrary(file: string, value: unknown) {
  const next = library(value),
    temp = path.join(path.dirname(file), `.kindcut-export-${randomUUID()}.tmp`);
  try {
    const h = await open(temp, 'wx', 0o600);
    try {
      await h.writeFile(JSON.stringify(next));
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(temp, file);
    const observed = await readConfigurationFile(file);
    if (JSON.stringify(observed) !== JSON.stringify(next)) throw fail();
  } finally {
    await unlink(temp).catch(() => {});
  }
}
/** Main-only, nonsecret typed settings; atomic0600 files, serialized updates. */
export class JoyConfigurationStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  private queue<T>(f: () => Promise<T>): Promise<T> {
    const p = this.tail.then(f);
    this.tail = p.then(
      () => {},
      () => {},
    );
    return p;
  }
  private async read() {
    try {
      return await readConfigurationFile(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyLibrary();
      throw fail();
    }
  }
  load() {
    return this.queue(() => this.read());
  }
  transact(
    change: (
      current: JoyConfigurationLibrary,
    ) => JoyConfigurationLibrary | Promise<JoyConfigurationLibrary>,
  ): Promise<JoyConfigurationLibrary> {
    return this.queue(async () => {
      let temp: string | undefined;
      try {
        const next = library(await change(await this.read()));
        const folder = path.dirname(this.file);
        await mkdir(folder, { recursive: true, mode: 0o700 });
        if (!(await lstat(folder)).isDirectory()) throw fail();
        await chmod(folder, 0o700);
        temp = path.join(folder, `.profiles-${randomUUID()}.tmp`);
        const h = await open(temp, 'wx', 0o600);
        try {
          await h.writeFile(JSON.stringify(next));
          await h.sync();
        } finally {
          await h.close();
        }
        await rename(temp, this.file);
        temp = undefined;
        return next;
      } catch {
        throw fail();
      } finally {
        if (temp) await unlink(temp).catch(() => {});
      }
    });
  }
}
