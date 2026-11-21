import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  JoyProvisioningStore,
  type ProvisioningBundle,
  type SecretProtector,
} from './joy-provisioning-store';

const dirs: string[] = [];
async function fixture(protector = aesProtector()) {
  const dir = await mkdtemp(join(tmpdir(), 'joy-provisioning-'));
  dirs.push(dir);
  return {
    dir,
    path: join(dir, 'provisioning.dat'),
    store: new JoyProvisioningStore(join(dir, 'provisioning.dat'), protector),
  };
}
function aesProtector(): SecretProtector {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(value.length - 16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
const bundle: ProvisioningBundle = {
  format: 1,
  settings8: 'A'.repeat(69),
  seedPrefixBase64: Buffer.alloc(33, 7).toString('base64'),
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('JoyProvisioningStore', () => {
  it('is inert until invoked, saves protected bytes with private modes, and round-trips', async () => {
    const f = await fixture();
    expect(await readdir(f.dir)).toEqual([]);
    await f.store.save(bundle);
    expect(await f.store.load()).toEqual(bundle);
    expect(await f.store.exists()).toBe(true);
    expect((await lstat(f.dir)).mode & 0o777).toBe(0o700);
    expect((await lstat(f.path)).mode & 0o777).toBe(0o600);
    const raw = await readFile(f.path);
    expect(raw.includes(Buffer.from(bundle.settings8))).toBe(false);
    expect(raw.includes(Buffer.from(bundle.seedPrefixBase64))).toBe(false);
  });
  it('denies save before writing when encryption is unavailable', async () => {
    const p = aesProtector();
    p.isEncryptionAvailable = () => false;
    const f = await fixture(p);
    await expect(f.store.save(bundle)).rejects.toThrow();
    expect(await readdir(f.dir)).toEqual([]);
  });
  it('reports missing store as absent', async () => {
    const f = await fixture();
    expect(await f.store.exists()).toBe(false);
  });
  it('rejects corrupt content with a generic error', async () => {
    const f = await fixture();
    await writeFile(f.path, 'corrupt');
    await expect(f.store.load()).rejects.toThrow();
  });
  it('does not replace an existing file when protection fails', async () => {
    const f = await fixture();
    await f.store.save(bundle);
    const before = await readFile(f.path);
    const bad: SecretProtector = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('secret detail');
      },
      decryptString: () => '',
    };
    const store = new JoyProvisioningStore(f.path, bad);
    await expect(store.save(bundle)).rejects.toThrow();
    expect(await readFile(f.path)).toEqual(before);
  });
  it('rejects symlinks for existence and loading', async () => {
    const f = await fixture();
    await writeFile(join(f.dir, 'target'), 'x');
    const { symlink } = await import('node:fs/promises');
    await symlink(join(f.dir, 'target'), f.path);
    expect(await f.store.exists()).toBe(false);
    await expect(f.store.load()).rejects.toThrow();
  });
  it('rejects malformed bundles without exposing payloads', async () => {
    const f = await fixture();
    const bad = [
      { ...bundle, format: 2 },
      { ...bundle, settings8: 'x'.repeat(68) },
      { ...bundle, settings8: 'é'.repeat(69) },
      { ...bundle, seedPrefixBase64: 'x'.repeat(43) + '!' },
    ];
    for (const value of bad)
      await expect(f.store.save(value as ProvisioningBundle)).rejects.toThrow();
    expect(await readdir(f.dir)).toEqual([]);
  });
  it('requires encryption availability before load', async () => {
    const f = await fixture();
    await f.store.save(bundle);
    const p: SecretProtector = { ...aesProtector(), isEncryptionAvailable: () => false };
    await expect(new JoyProvisioningStore(f.path, p).load()).rejects.toThrow();
  });
});
