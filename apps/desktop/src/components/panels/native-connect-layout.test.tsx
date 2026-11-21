import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeJoySetupView } from './NativeJoySetupPanel';
it('Connect is not gated by successful tool-plan preparation', () => {
  const tree = NativeJoySetupView({
    compact: true,
    allowConnect: false,
    setup: {
      enabled: true,
      runtimeAvailable: true,
      provisioned: true,
      provisioningSource: 'bundled',
      session: null,
      experimental: true,
      platform: 'darwin',
    },
    loading: null,
    devices: [{ id: '01:02:03:04:05:06', name: 'Joy', paired: true, connected: false }],
    address: '01:02:03:04:05:06',
    busy: false,
    height: 12,
    message: '',
    error: '',
    onHeight: () => {},
    onAddress: () => {},
    onAction: () => {},
  } as any);
  const h = renderToStaticMarkup(tree);
  expect(h).not.toContain('Prepare the tool plan before connecting');
  const locate = (n: any): any => {
    if (!n || typeof n !== 'object') return null;
    if (n.type === 'button' && n.props.children === 'Connect…') return n;
    for (const c of Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]) {
      const found = locate(c);
      if (found) return found;
    }
    return null;
  };
  expect(locate(tree)?.props.disabled).toBe(false);
});

it('setup describes general saved-recipe blade jobs, not a restricted first-cut-only mode', () => {
  const h = renderToStaticMarkup(
    <NativeJoySetupView
      setup={null}
      busy={false}
      address=""
      error=""
      message=""
      height={12}
      onHeight={() => {}}
      onAddress={() => {}}
      onAction={() => {}}
    />,
  );
  expect(h).toContain('Native pen and fine-point blade jobs use saved material recipes');
  expect(h).not.toContain('General native cutting is not enabled');
  expect(h).not.toContain('restricted first-cut trial');
});
