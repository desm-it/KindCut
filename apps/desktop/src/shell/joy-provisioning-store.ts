import { randomUUID } from 'node:crypto';
import { open, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

export interface ProvisioningBundle {
  format: 1;
  settings8: string;
  seedPrefixBase64: string;
}
export interface SecretProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const genericError = () => new Error('Provisioning data is unavailable or invalid');

function validate(value: unknown): asserts value is ProvisioningBundle {
  if (!value || typeof value !== 'object') throw genericError();
  const b = value as Record<string, unknown>;
  if (
    b.format !== 1 ||
    typeof b.settings8 !== 'string' ||
    b.settings8.length < 69 ||
    b.settings8.length > 2 * 1024 * 1024 ||
    !/^[\x00-\x7f]*$/.test(b.settings8)
  )
    throw genericError();
  if (
    typeof b.seedPrefixBase64 !== 'string' ||
    b.seedPrefixBase64.length !== 44 ||
    !/^[A-Za-z0-9+/]{44}$/.test(b.seedPrefixBase64)
  )
    throw genericError();
  const decoded = Buffer.from(b.seedPrefixBase64, 'base64');
  if (decoded.length !== 33 || decoded.toString('base64') !== b.seedPrefixBase64)
    throw genericError();
}

export class JoyProvisioningStore {
  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
  ) {}

  async save(bundle: ProvisioningBundle): Promise<void> {
    validate(bundle);
    let tempPath: string | undefined;
    try {
      if (!this.protector.isEncryptionAvailable()) throw genericError();
      const encrypted = this.protector.encryptString(JSON.stringify(bundle));
      if (
        !Buffer.isBuffer(encrypted) ||
        encrypted.length === 0 ||
        encrypted.length > MAX_FILE_BYTES
      )
        throw genericError();
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await import('node:fs/promises').then(({ chmod }) => chmod(dirname(this.filePath), 0o700));
      tempPath = join(dirname(this.filePath), `.${basename(this.filePath)}.${randomUUID()}.tmp`);
      const handle = await open(tempPath, 'wx', 0o600);
      try {
        await handle.writeFile(encrypted);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const check = await readRegularBounded(tempPath);
      if (!check.equals(encrypted)) throw genericError();
      await rename(tempPath, this.filePath);
      tempPath = undefined;
      const finalBytes = await readRegularBounded(this.filePath);
      if (!finalBytes.equals(encrypted)) throw genericError();
      await import('node:fs/promises').then(({ chmod }) => chmod(this.filePath, 0o600));
    } catch {
      throw genericError();
    } finally {
      if (tempPath) await unlink(tempPath).catch(() => undefined);
    }
  }

  async load(): Promise<ProvisioningBundle> {
    try {
      if (!this.protector.isEncryptionAvailable()) throw genericError();
      const encrypted = await readRegularBounded(this.filePath);
      const plain = this.protector.decryptString(encrypted);
      const parsed: unknown = JSON.parse(plain);
      validate(parsed);
      return parsed;
    } catch {
      throw genericError();
    }
  }

  async exists(): Promise<boolean> {
    try {
      const stat = await lstat(this.filePath);
      return stat.isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return false;
    }
  }
}

async function readRegularBounded(path: string): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FILE_BYTES) throw genericError();
  const handle = await open(path, 'r');
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size > MAX_FILE_BYTES) throw genericError();
    const data = await handle.readFile();
    if (data.length > MAX_FILE_BYTES) throw genericError();
    return data;
  } finally {
    await handle.close();
  }
}
