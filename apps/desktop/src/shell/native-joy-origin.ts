import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RendererEntry } from './window-config';
export function isTrustedJoyUrl(value: string, entry: RendererEntry): boolean {
  try {
    const actual = new URL(value);
    if (entry.type === 'file')
      return (
        actual.protocol === 'file:' &&
        path.resolve(fileURLToPath(actual)) === path.resolve(entry.value)
      );
    const expected = new URL(entry.value);
    return (
      ['http:', 'https:'].includes(expected.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(expected.hostname) &&
      actual.origin === expected.origin
    );
  } catch {
    return false;
  }
}
