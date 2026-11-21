import { describe, expect, it } from 'vitest';
import { routeCutterBackend } from './cutter-routing';

describe('routeCutterBackend', () => {
  it('blocks Auto cuts because native cutting is not supported and fallback must be explicit', () => {
    expect(routeCutterBackend('auto', 'cut', false)).toBe('blocked');
    expect(routeCutterBackend('auto', 'cut', true)).toBe('blocked');
  });
  it('routes supported Auto status to native and unsupported status to SliceBug', () => {
    expect(routeCutterBackend('auto', 'status', true)).toBe('native');
    expect(routeCutterBackend('auto', 'status', false)).toBe('slicebug');
  });
  it('never routes native-only to SliceBug', () => {
    expect(routeCutterBackend('native', 'cut', false)).toBe('blocked');
    expect(routeCutterBackend('native', 'cut', true)).toBe('native');
  });
  it('honors explicit SliceBug', () => {
    expect(routeCutterBackend('slicebug', 'cut', true)).toBe('slicebug');
  });
});
