import type { NativeJoySetup } from '../../shell/native-joy-service';
export function nativeJoyControls(
  setup: NativeJoySetup | null,
  busy: boolean,
  address: string,
  loadingActive = false,
) {
  const mac = setup?.platform === 'darwin';
  const ready = Boolean(mac && setup?.enabled && setup.runtimeAvailable && setup.provisioned);
  const idle = !busy && !loadingActive;
  return {
    connect:
      idle && ready && !setup?.session && /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(address),
    poll: idle && Boolean(ready && setup?.session),
    load: idle && Boolean(ready && setup?.session),
    unload: idle && Boolean(ready && setup?.session),
    disconnect: !busy && Boolean(mac),
    import: idle && Boolean(mac && setup?.runtimeAvailable && !setup.session),
    refresh: idle,
    startLoading: idle && Boolean(ready && setup?.session),
    cancelLoading: !busy && loadingActive,
    finishLoading: !busy && loadingActive,
  };
}
