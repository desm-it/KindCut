import { describe, it, expect } from 'vitest';
import {
  ADVANCED_INFO_STORAGE_KEY,
  loadAdvancedInfoPreference,
  saveAdvancedInfoPreference,
} from './advanced-info-preference';
function storage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(ADVANCED_INFO_STORAGE_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  };
}
describe('advanced info preference', () => {
  it('defaults off and persists across reload', () => {
    const s = storage();
    expect(loadAdvancedInfoPreference(s)).toBe(false);
    saveAdvancedInfoPreference(true, s);
    expect(loadAdvancedInfoPreference(s)).toBe(true);
    saveAdvancedInfoPreference(false, s);
    expect(loadAdvancedInfoPreference(s)).toBe(false);
  });
  it('fails safely when storage is blocked', () => {
    expect(
      loadAdvancedInfoPreference({
        getItem() {
          throw Error('blocked');
        },
      }),
    ).toBe(false);
    expect(() =>
      saveAdvancedInfoPreference(true, {
        setItem() {
          throw Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});

it('also catches browsers that throw when the localStorage property itself is read', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      get localStorage() {
        throw Error('blocked property');
      },
    },
  });
  try {
    expect(() => loadAdvancedInfoPreference()).not.toThrow();
    expect(loadAdvancedInfoPreference()).toBe(false);
    expect(() => saveAdvancedInfoPreference(true)).not.toThrow();
  } finally {
    if (old) Object.defineProperty(globalThis, 'window', old);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
