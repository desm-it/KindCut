import { NativeMakeSessionCoordinator } from './native-make-session-coordinator';
import { nativeMakeFinishedForSource } from './native-make-completion';
import { isNativeMakeMaterial } from '../../workspace-materials';
import { nativeMakePreviewFocus } from './native-make-preview-focus';
import { createPortal } from 'react-dom';
import { makeNextAction } from './native-make-next-action';
import { NativeJobController, initialJobPanel } from './native-joy-job-controller';
import type { ReactNode } from 'react';
import type { Language } from '../../i18n';
import {
  compileNativeMakeDesign,
  NativeMakePreview,
  NativeMakeToolPlans,
  type NativeMakeDesign,
  type NativeMakePreviewSource,
} from '../modals/native-make-design';
import type { JobPanelState } from './native-joy-job-controller';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { NativeJoySetup, NativeJoyLoadingState } from '../../shell/native-joy-service';
import type { NativeJoyLoadingDiagnostics } from '../../shell/native-joy-loading-diagnostics';
import { NativeJoyJobPanel } from './NativeJoyJobPanel';
import { nativeJoyControls } from './native-joy-controls';
import {
  NativeJoyPanelController,
  nativeJoyPanelInitialState,
  type NativeJoyPanelApi,
  type NativeJoyPanelAction,
  type NativeJoyPanelDevice,
  type NativeJoyConnectionNotice,
} from './native-joy-panel-controller';
import {
  NativeJoyConfigurationPanel,
  nativeJoyConfigurationApi,
} from './NativeJoyConfigurationPanel';
import type {
  NativeConfigurationSource,
  NativeJoyConfigurationApi,
} from '../../native-joy-configuration-types';
type Action = NativeJoyPanelAction;
type Api = NativeJoyPanelApi;
type Device = NativeJoyPanelDevice;
interface ViewProps {
  seamless?: boolean;
  language?: Language;
  showAdvancedInfo?: boolean;
  connectionNotice?: NativeJoyConnectionNotice;
  compact?: boolean;
  allowConnect?: boolean;
  setup: NativeJoySetup | null;
  busy: boolean;
  address: string;
  devices?: Device[];
  error: string;
  message: string;
  loading?: NativeJoyLoadingState | null;
  height: 6.5 | 12;
  onHeight(value: 6.5 | 12): void;
  onAddress(value: string): void;
  onAction(action: Action): void;
}
export function NativeJoySetupView(p: ViewProps) {
  const c = nativeJoyControls(p.setup, p.busy, p.address, Boolean(p.loading?.active)),
    button = (action: Action, label: string) => (
      <button
        type="button"
        className={`cut-modal__btn cut-modal__btn--${p.compact && !p.address && action === 'refresh' ? 'primary' : 'secondary'}`}
        disabled={
          action === 'export-diagnostics' ? p.busy || Boolean(p.loading?.active) : !c[action]
        }
        data-native-intent={
          action === 'connect' ? 'connect' : action === 'disconnect' ? 'disconnect' : undefined
        }
        onClick={() => p.onAction(action)}
      >
        {label}
      </button>
    );
  const diagnostic = p.loading?.diagnostics as NativeJoyLoadingDiagnostics | undefined;
  const terminal = Boolean(p.loading && !p.loading.active && p.loading.phase !== 'idle');
  const recovery =
    p.connectionNotice && !p.setup?.session && !p.loading?.active && !p.busy ? (
      <section
        className={`native-joy-recovery native-joy-recovery--${p.connectionNotice === 'connect_failed' ? 'warning' : 'info'}`}
        role={p.connectionNotice === 'connect_failed' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <div className="native-joy-recovery__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4" />
          </svg>
        </div>
        <div className="native-joy-recovery__body">
          <h4>
            {p.connectionNotice === 'connect_failed'
              ? 'Let’s reconnect your Cricut'
              : p.connectionNotice === 'not_found'
                ? 'Let’s find your Cricut'
                : 'Check Bluetooth access'}
          </h4>
          <p>
            {p.connectionNotice === 'connect_failed'
              ? 'The connection didn’t go through. A fresh start can help.'
              : p.connectionNotice === 'not_found'
                ? 'No paired Cricut Joy appeared in this search.'
                : 'KindCut couldn’t search for paired devices. Check Bluetooth and app permissions.'}
          </p>
          <ol>
            {p.connectionNotice === 'connect_failed' ? (
              <>
                <li>Unplug your Cricut’s power cable, wait a few seconds, then plug it back in.</li>
                <li>
                  Keep the mat and carriage area clear. When the power light is on, try again.
                </li>
              </>
            ) : (
              <>
                <li>Connect the power cable and turn on your Cricut.</li>
                <li>
                  {p.connectionNotice === 'search_failed'
                    ? 'On your Mac, turn on Bluetooth and allow KindCut in System Settings → Privacy & Security → Bluetooth.'
                    : 'On your Mac, open System Settings → Bluetooth and pair your Cricut Joy.'}
                </li>
                <li>
                  Then search again. Already paired? You don’t need to remove or pair it again.
                </li>
              </>
            )}
          </ol>
          <button
            type="button"
            data-native-intent={p.connectionNotice === 'connect_failed' ? 'connect' : undefined}
            className="native-joy-recovery__action"
            disabled={p.connectionNotice === 'connect_failed' ? !c.connect : !c.refresh}
            onClick={() =>
              p.onAction(p.connectionNotice === 'connect_failed' ? 'connect' : 'refresh')
            }
          >
            {p.connectionNotice === 'connect_failed' ? 'Try again' : 'Search again'}
            <span aria-hidden="true"> →</span>
          </button>
          <small>Nothing reconnects or starts a job automatically.</small>
        </div>
      </section>
    ) : null;

  if (p.compact && p.seamless) {
    const multiple = (p.devices?.length ?? 0) > 1;
    if (!multiple && !p.showAdvancedInfo) return null;
    return (
      <section className="native-make__connection" aria-label="Cricut connection">
        <div className="native-make__connection-head">
          <strong>
            {p.devices?.find((d) => d.id === p.address)?.name ??
              (p.devices?.length === 1 ? p.devices[0]!.name : 'Cricut Joy')}
          </strong>
          <span>
            {p.busy
              ? p.language === 'nl'
                ? 'Verbinden…'
                : 'Connecting…'
              : p.setup?.session
                ? p.language === 'nl'
                  ? 'Verbonden'
                  : 'Connected'
                : p.language === 'nl'
                  ? 'Niet verbonden'
                  : 'Not connected'}
          </span>
        </div>
        {!p.setup?.session && multiple && (
          <select
            aria-label={p.language === 'nl' ? 'Kies je Cricut' : 'Choose your Cricut'}
            value={p.address}
            disabled={p.busy}
            onChange={(e) => p.onAddress(e.target.value)}
          >
            <option value="">
              {p.language === 'nl' ? 'Kies je Cricut' : 'Choose your Cricut'}
            </option>
            {p.devices?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </section>
    );
  }

  if (p.compact)
    return (
      <section aria-label="Native Joy setup" className="native-make__connection">
        <div className="native-make__connection-head">
          <strong>Joy</strong>
          <span className={p.setup?.session ? 'native-make__connected' : 'native-make__muted'}>
            {p.setup?.session ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {!p.setup?.session && (
          <>
            <div className="native-make__device-row">
              <select
                aria-label="Your Joy"
                value={p.address}
                onChange={(e) => p.onAddress(e.target.value)}
                disabled={p.busy || Boolean(p.loading?.active) || !p.devices?.length}
              >
                <option value="">
                  {p.devices?.length ? 'Choose your Joy' : 'Choose a paired Joy'}
                </option>
                {p.devices?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {button('refresh', 'Find Joy')}
              <button
                type="button"
                className={`cut-modal__btn cut-modal__btn--${p.address ? 'primary' : 'secondary'}`}
                disabled={!c.connect}
                data-native-intent="connect"
                onClick={() => p.onAction('connect')}
              >
                Connect…
              </button>
            </div>
          </>
        )}
        {p.setup?.session && button('disconnect', 'Disconnect')}
        {p.loading?.active && (
          <div role="alert">
            A separate mat-loading session is active. End that session before starting a tool plan.
            {p.loading.phase === 'waiting_for_go'
              ? button('finishLoading', 'End separate loading session')
              : button('cancelLoading', 'Cancel separate loading')}
          </div>
        )}
        {recovery}
        {p.error && <p role="alert">{p.error}</p>}
        {p.showAdvancedInfo && (
          <details className="native-make__diagnostics">
            <summary>Connection diagnostics</summary>
            <p>
              Runtime: {p.setup?.runtimeAvailable ? 'installed' : 'unavailable'}. Loading stage:{' '}
              {p.loading?.phase ?? 'idle'}.
            </p>
            {p.message && <p>{p.message}</p>}
            {terminal && <p>Previous standalone loading attempt — not the current job.</p>}
            {diagnostic && (
              <p>
                {diagnostic.totalEvents} events; {diagnostic.evictedEvents} evicted. Capture{' '}
                {diagnostic.captureIncomplete ? 'incomplete' : 'complete'}.
              </p>
            )}
            {button('export-diagnostics', 'Export diagnostics…')}
          </details>
        )}
      </section>
    );
  return (
    <section aria-label="Native Joy setup" aria-busy={p.busy}>
      <h3 className="settings-modal__label">Native Joy setup</h3>
      <p className="settings-modal__hint">
        Experimental · original Joy · macOS Bluetooth. Native pen and fine-point blade jobs use
        saved material recipes with separate tool confirmations. No automatic scanning or
        connection.
      </p>
      {p.setup ? (
        <div className="settings-modal__hint">
          <p>
            Platform: {p.setup.platform === 'darwin' ? 'macOS' : p.setup.platform} · Native:{' '}
            {p.setup.enabled ? 'enabled' : 'disabled'}
          </p>
          <p>
            Runtime: {p.setup.runtimeAvailable ? 'installed' : 'missing'} · Provisioning:{' '}
            {p.setup.provisioningSource === 'bundled'
              ? 'included Joy profile'
              : p.setup.provisioned
                ? 'saved'
                : 'missing'}
          </p>
          {p.setup.provisioningSource === 'bundled' && (
            <p>
              Original Joy compatibility profile included. No key import or Cricut software is
              needed.
            </p>
          )}
          <p>Session: {p.setup.session ? 'connected (ready)' : 'disconnected'}</p>
          {p.setup.session && (
            <p>
              Firmware selector: {p.setup.session.firmwareSelector} · Status:{' '}
              {p.setup.session.status.status_byte_1} / {p.setup.session.status.status_byte_2}
            </p>
          )}
          {p.setup.platform !== 'darwin' && (
            <p>Native Joy currently requires macOS. Use SliceBug on this platform.</p>
          )}
          {!p.setup.runtimeAvailable && (
            <p>Native runtime is missing. Build/install a KindCut version that includes it.</p>
          )}
          {!p.setup.enabled && p.setup.platform === 'darwin' && (
            <p>
              Native Joy is currently unavailable in this app build. Use SliceBug, or install a
              build with Native Joy support.
            </p>
          )}
        </div>
      ) : (
        <p className="settings-modal__hint">Local setup metadata has not loaded.</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {button('refresh', 'Find my Joy')}
      </div>
      <label className="settings-modal__label" htmlFor="native-joy-device">
        Your Joy
      </label>
      <select
        id="native-joy-device"
        className="settings-modal__input"
        value={p.address}
        onChange={(e) => p.onAddress(e.target.value)}
        disabled={p.busy || Boolean(p.loading?.active) || !p.devices?.length}
      >
        <option value="">{p.devices?.length ? 'Choose your Joy' : 'No paired Joy found'}</option>
        {p.devices?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.connected ? 'Bluetooth connected' : 'paired'}
          </option>
        ))}
      </select>
      <p className="settings-modal__hint">
        Turn on your Joy; pair new devices in macOS Bluetooth settings, then choose Find my Joy. No
        address entry is available.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {button('connect', 'Connect…')}
        {button('poll', 'Read device status')}
        {button('disconnect', 'Disconnect')}
      </div>
      {recovery}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{button('unload', 'Unload mat')}</div>
      <p className="settings-modal__hint">
        Unload is an explicit idle-session control; it is not part of normal loading or a guarantee
        of physical ejection.
      </p>
      <section aria-label="Native Joy mat loading">
        <h4>Load mat and align</h4>
        <p className="settings-modal__hint">
          Remove the BLADE HOUSING and keep the front and back of the Joy clear. Loading uses the
          sensor-arm, grip and alignment sequence; it does not start a job or cut. Cancel requests
          session cleanup, but physical stopping is not verified.
        </p>
        <label htmlFor="native-joy-mat-size">Mat length</label>
        <select
          id="native-joy-mat-size"
          value={p.height}
          onChange={(e) => p.onHeight(Number(e.target.value) as 6.5 | 12)}
          disabled={p.busy || Boolean(p.loading?.active)}
        >
          <option value={6.5}>6.5 in</option>
          <option value={12}>12 in</option>
        </select>
        {!p.loading?.active ? (
          button('load', 'Load mat')
        ) : (
          <>
            <p role="status">
              Stage:{' '}
              {p.loading.phase === 'loading_and_aligning'
                ? 'Preparing sensor and loading'
                : p.loading.phase === 'waiting_for_mat'
                  ? 'Sensor armed — insert mat now'
                  : p.loading.phase === 'gripped'
                    ? 'Mat detected — grip not independently verified'
                    : p.loading.phase === 'measuring_y'
                      ? 'Measuring mat length'
                      : p.loading.phase === 'positioning'
                        ? 'Positioning mat and carriage'
                        : p.loading.phase === 'waiting_for_go'
                          ? 'Ready — retained loading session'
                          : p.loading.phase === 'releasing'
                            ? 'Ending loading session'
                            : p.loading.phase}
            </p>
            {p.loading.phase === 'waiting_for_mat' && (
              <p>
                Insert the mat now. The sensor-arm step was acknowledged; the blink is requested,
                not independently confirmed as visible.
              </p>
            )}
            {p.loading.phase === 'waiting_for_go' && (
              <p>
                The protocol reached its ready wait. Physical alignment is not verified; the session
                remains held.
              </p>
            )}
            <p>
              No job will start. End loading session explicitly to retire this retained session;
              this does not guarantee physical unloading.
            </p>
            {p.loading.phase === 'waiting_for_go' && button('finishLoading', 'End loading session')}
            {button('cancelLoading', 'Cancel loading')}
          </>
        )}
      </section>
      {terminal && (
        <section
          aria-label="Loading result"
          role={p.loading?.phase === 'failed' ? 'alert' : undefined}
        >
          <h4>
            {p.loading?.phase === 'failed'
              ? 'Loading failed'
              : p.loading?.phase === 'cancelled'
                ? 'Loading canceled'
                : 'Loading session completed'}
          </h4>
          {p.loading?.historical && (
            <p>Previous attempt · restored diagnostic history. No session is resumed.</p>
          )}
          <p>
            {p.message ||
              `The loading operation ended. Physical loading, alignment and stopping are not verified.`}
          </p>
          {diagnostic ? (
            <>
              <p>
                Diagnostics v{diagnostic.version} · last stage:{' '}
                {diagnostic.failure?.stage || diagnostic.lastStage} · {diagnostic.totalEvents}{' '}
                events captured
                {diagnostic.evictedEvents
                  ? ` · ${diagnostic.evictedEvents} older events evicted`
                  : ''}
              </p>
              {(diagnostic.captureIncomplete || diagnostic.evictedEvents > 0) && (
                <p>Diagnostic capture is incomplete; some events may be missing.</p>
              )}
              {diagnostic.failure && (
                <p>
                  Failure: {diagnostic.failure.code} ({diagnostic.failure.errorType})
                </p>
              )}
              <details>
                <summary>Last captured exchange</summary>
                {[...diagnostic.events].reverse().find((e) => e.kind === 'exchange') ? (
                  <p>
                    {(() => {
                      const e = [...diagnostic.events]
                        .reverse()
                        .find((v) => v.kind === 'exchange')!;
                      return (
                        <>
                          Stage: {e.stage}
                          <br />
                          Request: <code>{e.txHex ?? 'unavailable'}</code>
                          <br />
                          Reply: <code>{e.rxHex ?? 'unavailable'}</code>
                        </>
                      );
                    })()}
                  </p>
                ) : (
                  <p>No exchange was captured.</p>
                )}
              </details>
            </>
          ) : (
            <p>Diagnostic details are unavailable for this operation.</p>
          )}
        </section>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="cut-modal__btn cut-modal__btn--secondary"
          disabled={p.busy || Boolean(p.loading?.active)}
          onClick={() => p.onAction('export-diagnostics')}
        >
          Export loading diagnostics…
        </button>
      </div>
      <details>
        <summary>Advanced compatibility import</summary>
        <p className="settings-modal__hint">
          Optional override only. Normal Joy setup uses the included profile.
        </p>
        {button('import', 'Import material / settings / keys…')}
      </details>
      {p.busy && <p role="status">Working…</p>}
      {p.message && <p role="status">{p.message}</p>}
      {p.error && <p role="alert">{p.error}</p>}
    </section>
  );
}
export function NativeJoySetupPanel({
  mode = 'settings',
  makeVisible = true,
  actionContainer,
  language = 'en',
  showAdvancedInfo = false,
  materialControl,
  previewSource,
  api = typeof window === 'undefined' ? undefined : window.cricutCompanion?.nativeJoy,
  configurationApi = typeof window === 'undefined'
    ? undefined
    : nativeJoyConfigurationApi(window.cricutCompanion?.nativeJoy),
  workspaceMaterial,
  onOpenSettings,
  source = async () => {
    throw Error('Current workspace design is unavailable.');
  },
}: {
  makeVisible?: boolean;
  actionContainer?: HTMLElement | null;
  mode?: 'settings' | 'make';
  language?: Language;
  showAdvancedInfo?: boolean;
  materialControl?: ReactNode;
  previewSource?: () => Promise<NativeMakePreviewSource>;
  api?: Api;
  configurationApi?: NativeJoyConfigurationApi;
  source?: () => Promise<NativeConfigurationSource>;
  workspaceMaterial?: { id: number; name: string };
  onOpenSettings?: () => void;
}) {
  const [state, setState] = useState(nativeJoyPanelInitialState);
  const [design, setDesign] = useState<NativeMakeDesign | null>(null),
    [designError, setDesignError] = useState(''),
    [hovered, setHovered] = useState<number | null>(null),
    [jobState, setJobState] = useState<JobPanelState | null>(null);
  useEffect(() => {
    if (mode !== 'make') return;
    let current = true;
    void (previewSource ?? source)()
      .then((s) => compileNativeMakeDesign(s))
      .then((d) => {
        if (current) {
          setDesign(d);
          setDesignError('');
          setHovered(null);
        }
      })
      .catch((e) => {
        if (current) {
          setDesign(null);
          setDesignError(e instanceof Error ? e.message : 'Design preview unavailable.');
        }
      });
    return () => {
      current = false;
    };
  }, [source, previewSource, mode]);
  const liveJob = jobState?.job ?? null,
    frozenDesign = useRef<NativeMakeDesign | null>(null);
  useEffect(() => {
    if (liveJob?.active) {
      if (!frozenDesign.current) frozenDesign.current = design;
    } else frozenDesign.current = null;
  }, [liveJob?.active, design]);
  const displayDesign = liveJob?.active ? (frozenDesign.current ?? design) : design;
  const plannedTools = useMemo(
    () =>
      displayDesign?.tools.map((t) => ({
        tool: t.tool,
        color: t.paths[0]?.color ?? displayDesign.behindColor,
      })),
    [displayDesign],
  );
  const previewFocus = nativeMakePreviewFocus(liveJob, hovered, displayDesign?.tools.length ?? 0);
  const [jobBusy, setJobBusy] = useState(false);
  const priorJobBusy = useRef(false);
  const owner = useRef<NativeJoyPanelController | null>(null);
  useEffect(() => {
    const controller = new NativeJoyPanelController(api, setState);
    owner.current = controller;
    void controller.mount();
    return () => {
      controller.dispose();
      if (owner.current === controller) owner.current = null;
    };
  }, [api]);
  const jobOwner = useRef<NativeJobController | null>(null),
    [jobReady, setJobReady] = useState(false);
  const onJobController = useCallback((c: NativeJobController | null) => {
    jobOwner.current = c;
    setJobReady(Boolean(c));
  }, []);
  const coordinator = useRef(new NativeMakeSessionCoordinator());
  const [makeSetupDone, setMakeSetupDone] = useState(false);
  useEffect(() => {
    coordinator.current.enter(makeVisible && mode === 'make');
    setMakeSetupDone(false);
    return () => {
      coordinator.current.enter(false);
    };
  }, [makeVisible, mode, api]);
  const connectMake = useCallback(
    () =>
      coordinator.current
        .connect(async () => {
          const c = owner.current;
          if (!c) return false;
          const ready = await c.connectForMake();
          return (
            ready === true &&
            owner.current === c &&
            Boolean(c.snapshot.setup?.session) &&
            !c.snapshot.error
          );
        })
        .then(() => setMakeSetupDone(coordinator.current.ready)),
    [],
  );
  useEffect(() => {
    coordinator.current.observeJob(Boolean(liveJob?.active), Boolean(liveJob?.historical), source);
  }, [liveJob?.active, liveJob?.historical, source]);
  const finishedForFooter = coordinator.current.finishedFor(source, (s) =>
    nativeMakeFinishedForSource(liveJob, s, s, makeVisible),
  );
  useEffect(() => {
    if (!makeVisible) {
      setMakeSetupDone(false);
      return;
    }
    if (
      mode !== 'make' ||
      !jobReady ||
      state.busy ||
      liveJob?.active ||
      state.loading?.active ||
      !coordinator.current.shouldConnect()
    )
      return;
    void connectMake();
  }, [makeVisible, mode, state.busy, state.loading?.active, jobReady, liveJob?.active]);
  useEffect(() => {
    const c = jobOwner.current;
    if (
      mode !== 'make' ||
      !makeVisible ||
      !makeSetupDone ||
      !jobReady ||
      !state.setup?.session ||
      state.busy ||
      state.loading?.active ||
      !c ||
      c.state.busy ||
      c.state.cancelPending ||
      c.state.stale ||
      !workspaceMaterial ||
      !isNativeMakeMaterial(workspaceMaterial.id)
    )
      return;
    const j = c.state.job;
    coordinator.current.invalidateSource(source);
    if (j?.active) {
      if (
        j.phase !== 'retained_ready' ||
        !j.workflow ||
        j.workflow.actionIndex + 1 >= j.workflow.actionCount ||
        !coordinator.current.claimNext(j.operationId)
      )
        return;
      void (async () => {
        await c.run('prepare');
        if (jobOwner.current === c && c.state.preview && !c.state.error && !c.state.stale)
          await c.run('arm-next');
      })();
      return;
    }
    if (!c.state.preview && coordinator.current.claimPrepare(source)) void c.run('prepare');
  }, [
    mode,
    makeVisible,
    makeSetupDone,
    jobReady,
    state.setup?.session,
    state.busy,
    jobState,
    source,
  ]);
  const next =
    workspaceMaterial && !isNativeMakeMaterial(workspaceMaterial.id)
      ? {
          action: null,
          label: language === 'nl' ? 'Kies materiaal' : 'Choose material',
          disabled: true,
          intent: undefined,
        }
      : makeNextAction(
          jobState ?? initialJobPanel(),
          Boolean(state.setup?.session),
          state.busy,
          language,
          plannedTools?.[liveJob?.workflow?.actionIndex ?? 0]?.color,
          !finishedForFooter,
        );
  const footerAction = actionContainer
    ? createPortal(
        <button
          type="button"
          className="cut-modal__btn cut-modal__btn--primary"
          data-native-intent={next.intent}
          disabled={
            next.disabled ||
            !api ||
            Boolean(state.loading?.active) ||
            Boolean(state.setup && (!state.setup.enabled || !state.setup.runtimeAvailable))
          }
          onClick={() => {
            if (next.action === 'connect') void connectMake();
            else if (next.action) void jobOwner.current?.run(next.action);
          }}
        >
          {next.label}
        </button>,
        actionContainer,
      )
    : null;
  const updateJobBusy = useCallback((busy: boolean) => {
    setJobBusy(busy);
    if (priorJobBusy.current && !busy) void owner.current?.mount();
    priorJobBusy.current = busy;
  }, []);
  const setup = (
    <NativeJoySetupView
      {...state}
      seamless={mode === 'make'}
      language={language}
      showAdvancedInfo={showAdvancedInfo}
      compact={mode === 'make'}
      allowConnect={Boolean(jobState?.preview)}
      busy={state.busy || jobBusy}
      onHeight={(height) => owner.current?.setHeight(height)}
      onAddress={(address) => owner.current?.setAddress(address)}
      onAction={(action) => {
        void owner.current?.run(action);
      }}
    />
  );
  const config = (
    <NativeJoyConfigurationPanel
      api={configurationApi}
      setup={state.setup}
      busy={state.busy || jobBusy || Boolean(state.loading?.active)}
      source={source}
      workspaceMaterial={workspaceMaterial}
    />
  );
  const unsupportedMaterial = Boolean(
    workspaceMaterial && !isNativeMakeMaterial(workspaceMaterial.id),
  );
  const makeConnection = {
    onOpenSettings,
    busy: state.busy,
    cancelling: state.connectionCancelling,
    onRetry: () => {
      void connectMake();
    },
    onCancel: api?.cancelMakeConnection
      ? () => {
          void owner.current?.cancelConnection();
        }
      : undefined,
    notice: state.connectionNotice,
    connectionError: state.error,
    error:
      state.error ||
      designError ||
      (unsupportedMaterial
        ? language === 'nl'
          ? 'Kies een ondersteund materiaal voor dit gereedschapsplan.'
          : 'Choose a supported material for this tool plan.'
        : ''),
    preparing: Boolean(
      (jobState?.busy && (!liveJob?.active || liveJob.phase === 'retained_ready')) ||
      (state.setup?.session &&
        !liveJob?.active &&
        !jobState?.preview &&
        !jobState?.error &&
        !designError &&
        !state.error &&
        !unsupportedMaterial &&
        !finishedForFooter),
    ),
    finished: finishedForFooter,
  };
  const job = (
    <NativeJoyJobPanel
      makeConnection={mode === 'make' ? makeConnection : undefined}
      matVariant={displayDesign?.matVariant}
      seamless={mode === 'make'}
      language={language}
      onControllerReady={onJobController}
      showAdvancedInfo={showAdvancedInfo}
      compact={mode === 'make'}
      setup={state.setup}
      source={source}
      onBusyChange={updateJobBusy}
      onStateChange={setJobState}
      plannedTools={plannedTools}
    />
  );
  if (mode === 'make')
    return (
      <div className="native-make__workspace">
        {footerAction}
        <NativeMakePreview design={displayDesign} selected={previewFocus} language={language} />
        <div className="native-make__plan cut-modal__info">
          <fieldset
            className="native-make__material-lock"
            disabled={jobBusy || Boolean(state.loading?.active)}
          >
            {materialControl}
          </fieldset>
          {setup}
          {job}
          <NativeMakeToolPlans
            showAdvancedInfo={showAdvancedInfo}
            design={displayDesign}
            selected={previewFocus}
            onHover={setHovered}
            language={language}
            job={liveJob?.active || !jobState?.preview ? liveJob : null}
            workflow={jobState?.job?.workflow ?? jobState?.preview?.workflow}
          />
          {showAdvancedInfo && (
            <details className="native-make__advanced">
              <summary>
                {language === 'nl'
                  ? 'Materiaal- en kalibratie-instellingen'
                  : 'Material & calibration settings'}
              </summary>
              {config}
            </details>
          )}
        </div>
      </div>
    );
  return (
    <>
      {setup}
      {config}
      {job}
    </>
  );
}
