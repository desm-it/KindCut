import { useRef, useState } from 'react';
import type { Language } from '../../i18n';
import {
  type AiProvider,
  type AiProviderSettings,
  type OpenAiImageModel,
  DEFAULT_OPENAI_IMAGE_MODEL,
  OPENAI_IMAGE_MODEL_LABELS,
} from '../../ai-svg-generate';

type Tab = 'cutter' | 'ai';
export function SettingsModal({
  language,
  settings,
  onSave,
  onClose,
  backend,
  onBackendChange,
  backendLoadError,
  onOpenNativeMake,
  showAdvancedInfo = false,
  onShowAdvancedInfoChange,
}: {
  onOpenNativeMake?: () => void;
  showAdvancedInfo?: boolean;
  onShowAdvancedInfoChange?: (value: boolean) => void;
  language: Language;
  backend: 'auto' | 'native' | 'slicebug';
  onBackendChange: (value: 'auto' | 'native' | 'slicebug') => Promise<void> | void;
  backendLoadError?: string;
  settings: AiProviderSettings;
  onSave: (settings: AiProviderSettings) => void;
  onClose: () => void;
}) {
  const nl = language === 'nl';
  const [tab, setTab] = useState<Tab>('cutter');
  const [draft, setDraft] = useState<AiProviderSettings>(settings);
  const [backendSaving, setBackendSaving] = useState(false);
  const [backendError, setBackendError] = useState('');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs: Tab[] = ['cutter', 'ai'];
  const tabName = (t: Tab) =>
    t === 'cutter' ? (nl ? 'Plotter' : 'Cutter') : nl ? 'AI-diensten' : 'AI services';
  async function changeBackend(value: 'auto' | 'native' | 'slicebug') {
    setBackendSaving(true);
    setBackendError('');
    try {
      await onBackendChange(value);
    } catch {
      setBackendError(
        nl
          ? 'Plotterkeuze opslaan mislukt. De vorige keuze blijft actief.'
          : 'Could not save the cutter backend. Your previous selection is unchanged.',
      );
    } finally {
      setBackendSaving(false);
    }
  }
  function onTabKeyDown(e: React.KeyboardEvent) {
    const current = tabs.indexOf(tab);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % tabs.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (current + tabs.length - 1) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      setTab(tabs[next]!);
      tabRefs.current[next]?.focus();
    }
  }
  return (
    <div
      className="cut-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cut-modal settings-modal" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <div>
            <h2 className="cut-modal__title">{nl ? 'Instellingen' : 'Settings'}</h2>
            <p className="settings-modal__hint">
              {nl
                ? 'Beheer plotterverbinding en AI-instellingen.'
                : 'Manage cutter connection and AI preferences.'}
            </p>
          </div>
          <button
            type="button"
            className="cut-modal__close"
            onClick={onClose}
            aria-label={nl ? 'Sluiten' : 'Close'}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        <div
          className="settings-modal__tabs"
          role="tablist"
          aria-label={nl ? 'Instellingencategorie' : 'Settings category'}
          onKeyDown={onTabKeyDown}
        >
          {tabs.map((t, i) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`settings-tab-${t}`}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={`settings-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
            >
              {tabName(t)}
            </button>
          ))}
        </div>
        <div className="cut-modal__body settings-modal__body">
          <section
            id="settings-panel-cutter"
            role="tabpanel"
            aria-labelledby="settings-tab-cutter"
            hidden={tab !== 'cutter'}
          >
            <div className="settings-modal__connection-summary">
              <h3>{nl ? 'Jouw Cricut' : 'Your Cricut'}</h3>
              <p className="settings-modal__hint">
                {nl
                  ? 'Bekijk je ontwerp en gereedschappen in Make.'
                  : 'Preview your design and tool plan in Make, then follow each step.'}
              </p>
              <button
                type="button"
                className="cut-modal__btn cut-modal__btn--primary"
                data-native-intent="connect"
                disabled={!onOpenNativeMake}
                onClick={onOpenNativeMake}
              >
                {nl ? 'Make openen' : 'Open Make'}
              </button>
            </div>
            {backendLoadError && <p role="alert">{backendLoadError}</p>}
            <label className="settings-modal__advanced-toggle">
              <input
                type="checkbox"
                checked={showAdvancedInfo}
                onChange={(e) => onShowAdvancedInfoChange?.(e.target.checked)}
              />{' '}
              {nl ? 'Geavanceerde informatie tonen' : 'Show advanced info'}
            </label>
            {showAdvancedInfo && (
              <>
                <p className="settings-modal__label">{nl ? 'Cutterbackend' : 'Cutter backend'}</p>
                <p className="settings-modal__hint">
                  {nl
                    ? 'Automatisch kiest de ondersteunde verbinding. Native Make ondersteunt Joy-pen- en mesopdrachten met opgeslagen materiaalinstellingen.'
                    : 'Auto selects a supported connection. Native Make supports Joy pen and fine-point blade jobs with saved material settings.'}
                </p>
                <select
                  aria-label={nl ? 'Cutterbackend' : 'Cutter backend'}
                  disabled={backendSaving}
                  className="settings-modal__input settings-modal__select"
                  value={backend}
                  onChange={(e) =>
                    void changeBackend(e.target.value as 'auto' | 'native' | 'slicebug')
                  }
                >
                  <option value="auto">Auto ({nl ? 'aanbevolen' : 'recommended'})</option>
                  <option value="native">Native ({nl ? 'Cricut Joy' : 'Cricut Joy'})</option>
                  <option value="slicebug">SliceBug</option>
                </select>
                {backendSaving && (
                  <p role="status">{nl ? 'Plotterkeuze opslaan…' : 'Saving cutter choice…'}</p>
                )}
                {(backendError || backendLoadError) && (
                  <p role="alert">{backendError || backendLoadError}</p>
                )}
                <p className="settings-modal__hint">
                  {nl
                    ? 'De backendkeuze wordt direct opgeslagen; de AI-opslaanknop wijzigt deze keuze niet.'
                    : 'Backend choice saves immediately; the AI Save button does not change it.'}
                </p>
              </>
            )}
          </section>
          <section
            id="settings-panel-ai"
            role="tabpanel"
            aria-labelledby="settings-tab-ai"
            hidden={tab !== 'ai'}
          >
            <p className="settings-modal__label">{nl ? 'AI-dienst' : 'AI service'}</p>
            <p className="settings-modal__hint">
              {nl
                ? 'OpenAI genereert een PNG en vectoriseert automatisch. Recraft genereert direct een SVG.'
                : 'OpenAI generates a PNG and auto-vectorises. Recraft generates SVG directly.'}
            </p>
            <select
              aria-label={nl ? 'AI-dienst' : 'AI service'}
              className="settings-modal__input settings-modal__select"
              value={draft.activeProvider}
              onChange={(e) =>
                setDraft((d) => ({ ...d, activeProvider: e.target.value as AiProvider }))
              }
            >
              <option value="openai">OpenAI — GPT Image → vectortrace</option>
              <option value="recraft">Recraft — native SVG (recraftv4_1_vector)</option>
            </select>
            <label className="settings-modal__label settings-modal__label--mt" htmlFor="openai-key">
              OpenAI API key
            </label>
            <p className="settings-modal__hint">
              {nl
                ? 'Vereist voor OpenAI. Alleen lokaal opgeslagen.'
                : 'Required for OpenAI. Stored locally only.'}
            </p>
            <input
              id="openai-key"
              type="password"
              className="settings-modal__input"
              value={draft.openaiKey}
              onChange={(e) => setDraft((d) => ({ ...d, openaiKey: e.target.value }))}
              placeholder="sk-..."
              autoComplete="new-password"
              spellCheck={false}
            />
            {draft.activeProvider === 'openai' && (
              <>
                <label
                  className="settings-modal__label settings-modal__label--mt"
                  htmlFor="openai-model"
                >
                  {nl ? 'Afbeeldingsmodel' : 'Image model'}
                </label>
                <p className="settings-modal__hint">
                  {nl
                    ? 'GPT Image genereert een PNG die automatisch wordt gevectoriseerd. Flare is snel; Sunburst is preciezer voor details.'
                    : 'GPT Image generates a PNG that is automatically vectorised. Flare is fast; Sunburst is more precise for detail.'}
                </p>
                <select
                  id="openai-model"
                  className="settings-modal__input settings-modal__select"
                  value={draft.openaiImageModel ?? DEFAULT_OPENAI_IMAGE_MODEL}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      openaiImageModel: e.target.value as OpenAiImageModel,
                    }))
                  }
                >
                  <option value="gpt-image-2.5-flare">
                    {OPENAI_IMAGE_MODEL_LABELS['gpt-image-2.5-flare']} —{' '}
                    {nl ? 'snel, aanbevolen' : 'fast, recommended'}
                  </option>
                  <option value="gpt-image-2.5-sunburst">
                    {OPENAI_IMAGE_MODEL_LABELS['gpt-image-2.5-sunburst']} —{' '}
                    {nl ? 'meest precies, trager' : 'most precise, slower'}
                  </option>
                  <option value="gpt-image-2">{OPENAI_IMAGE_MODEL_LABELS['gpt-image-2']}</option>
                  <option value="gpt-image-1.5">
                    {OPENAI_IMAGE_MODEL_LABELS['gpt-image-1.5']}
                  </option>
                  <option value="gpt-image-1">{OPENAI_IMAGE_MODEL_LABELS['gpt-image-1']}</option>
                </select>
              </>
            )}
            <label
              className="settings-modal__label settings-modal__label--mt"
              htmlFor="recraft-key"
            >
              Recraft API key
            </label>
            <p className="settings-modal__hint">
              {nl
                ? 'Gespecialiseerde vector-AI. Alleen lokaal opgeslagen.'
                : 'Dedicated vector AI. Stored locally only.'}
            </p>
            <input
              id="recraft-key"
              type="password"
              className="settings-modal__input"
              value={draft.recraftKey}
              onChange={(e) => setDraft((d) => ({ ...d, recraftKey: e.target.value }))}
              placeholder="recraft_..."
              autoComplete="new-password"
              spellCheck={false}
            />
          </section>
        </div>
        <div className="cut-modal__footer">
          <button
            type="button"
            className="cut-modal__btn cut-modal__btn--secondary"
            onClick={onClose}
          >
            {nl ? 'Sluiten' : 'Close'}
          </button>
          {tab === 'ai' && (
            <button
              type="button"
              className="cut-modal__btn cut-modal__btn--primary"
              onClick={() => onSave(draft)}
            >
              {nl ? 'AI-instellingen opslaan' : 'Save AI settings'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
