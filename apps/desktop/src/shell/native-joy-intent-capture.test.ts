import { it, expect } from 'vitest';
import { installNativeIntentCapture } from './native-joy-intent-capture';
function setup() {
  let listener: (e: any) => void = () => {};
  const sent: unknown[] = [];
  installNativeIntentCapture(
    {
      addEventListener: (_name: any, fn: any) => {
        listener = fn;
      },
    } as any,
    (a) => sent.push(a),
  );
  return {
    fire: (trusted: boolean, button: any) =>
      listener({ isTrusted: trusted, target: { closest: () => button } }),
    sent,
  };
}
const button = (action = 'job-go') => ({
  disabled: false,
  isConnected: true,
  getAttribute: () => action,
});
it('only trusted enabled connected action buttons create receipts', () => {
  const x = setup();
  x.fire(false, button());
  expect(x.sent).toEqual([]);
  x.fire(true, button());
  expect(x.sent).toEqual(['job-go']);
});
it.each(['disabled', 'detached', 'unknown', 'outside'])(
  'revokes on %s real click without approving',
  (mode) => {
    const x = setup(),
      b = button(mode === 'unknown' ? 'approved' : 'job-go');
    if (mode === 'disabled') b.disabled = true;
    if (mode === 'detached') b.isConnected = false;
    x.fire(true, mode === 'outside' ? null : b);
    expect(x.sent).toEqual([null]);
  },
);

it('read-only preview selection neither approves nor revokes a pending intentional action', () => {
  const x = setup();
  const b = {
    disabled: false,
    isConnected: true,
    getAttribute: (key: string) => (key === 'data-native-preview' ? 'true' : null),
  };
  x.fire(true, b);
  expect(x.sent).toEqual([]);
});
