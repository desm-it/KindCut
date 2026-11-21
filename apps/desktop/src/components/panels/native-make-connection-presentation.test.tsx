import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeJoySetupView } from './NativeJoySetupPanel';
const base = {
  seamless: true,
  compact: true,
  setup: null,
  busy: false,
  address: 'a',
  devices: [{ id: 'a', name: 'Single Joy', paired: true, connected: false }],
  error: '',
  message: '',
  height: 6.5 as const,
  onHeight: () => {},
  onAddress: () => {},
  onAction: () => {},
};
it('hides a sole device name and separate status in normal Make', () => {
  const h = renderToStaticMarkup(<NativeJoySetupView {...base} />);
  expect(h).not.toContain('Single Joy');
  expect(h).not.toContain('Not connected');
  expect(h).not.toContain('Cricut connection');
});
it('retains multiple-device selection', () => {
  const h = renderToStaticMarkup(
    <NativeJoySetupView
      {...base}
      devices={[...base.devices, { id: 'b', name: 'Second Joy', paired: true, connected: false }]}
    />,
  );
  expect(h).toContain('<select');
  expect(h).toContain('Second Joy');
});
it('retains name and status for advanced users', () => {
  const h = renderToStaticMarkup(<NativeJoySetupView {...base} showAdvancedInfo />);
  expect(h).toContain('Single Joy');
  expect(h).toContain('Not connected');
});
it('does not create a separate red recovery/error block in seamless Make', () => {
  const h = renderToStaticMarkup(
    <NativeJoySetupView {...base} error="Connection failed" connectionNotice="connect_failed" />,
  );
  expect(h).not.toContain('native-joy-recovery');
  expect(h).not.toContain('role="alert"');
});
