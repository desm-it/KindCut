import { useState } from "react";
import type { Language } from "../../i18n";
import type { AiProvider, AiProviderSettings, OpenAiImageModel } from "../../ai-svg-generate";

export function SettingsModal({
  language,
  settings,
  onSave,
  onClose,
}: {
  language: Language;
  settings: AiProviderSettings;
  onSave: (settings: AiProviderSettings) => void;
  onClose: () => void;
}) {
  const nl = language === "nl";
  const [draft, setDraft] = useState<AiProviderSettings>(settings);

  return (
    <div className="cut-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cut-modal cut-modal--narrow" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "Instellingen" : "Settings"}</h2>
          <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>
        <div className="cut-modal__body cut-modal__body--col">
          <p className="settings-modal__label">{nl ? "AI-dienst" : "AI service"}</p>
          <p className="settings-modal__hint">
            {nl
              ? "OpenAI: genereert een PNG en vectoriseert automatisch. Recraft: genereert direct een SVG."
              : "OpenAI: generates a PNG and auto-vectorises. Recraft: generates SVG directly."}
          </p>
          <select
            className="settings-modal__input settings-modal__select"
            value={draft.activeProvider}
            onChange={(e) => setDraft((d) => ({ ...d, activeProvider: e.target.value as AiProvider }))}
          >
            <option value="openai">OpenAI — GPT Image → vectortrace</option>
            <option value="recraft">Recraft — native SVG (recraftv4_1_vector)</option>
          </select>

          <p className="settings-modal__label settings-modal__label--mt">OpenAI API key</p>
          <p className="settings-modal__hint">
            {nl ? "Vereist voor OpenAI. Alleen lokaal opgeslagen." : "Required for OpenAI. Stored locally only."}
          </p>
          <input
            type="password"
            className="settings-modal__input"
            value={draft.openaiKey}
            onChange={(e) => setDraft((d) => ({ ...d, openaiKey: e.target.value }))}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
          />

          {draft.activeProvider === "openai" && (
            <>
              <p className="settings-modal__label settings-modal__label--mt">
                {nl ? "Afbeeldingsmodel" : "Image model"}
              </p>
              <p className="settings-modal__hint">
                {nl
                  ? "GPT Image genereert een PNG die automatisch wordt gevectoriseerd. Alle complexiteitsniveaus gebruiken dit model."
                  : "GPT Image generates a PNG that is automatically vectorised. All complexity levels use this model."}
              </p>
              <select
                className="settings-modal__input settings-modal__select"
                value={draft.openaiImageModel ?? "gpt-image-2"}
                onChange={(e) => setDraft((d) => ({ ...d, openaiImageModel: e.target.value as OpenAiImageModel }))}
              >
                <option value="gpt-image-2">GPT Image 2 — {nl ? "nieuwste" : "latest"}</option>
                <option value="gpt-image-1.5">GPT Image 1.5</option>
                <option value="gpt-image-1">GPT Image 1</option>
              </select>
            </>
          )}

          <p className="settings-modal__label settings-modal__label--mt">Recraft API key</p>
          <p className="settings-modal__hint">
            {nl
              ? "Vereist voor Recraft. Gespecialiseerde vector-AI. Alleen lokaal opgeslagen."
              : "Required for Recraft. Dedicated vector AI. Stored locally only."}
          </p>
          <input
            type="password"
            className="settings-modal__input"
            value={draft.recraftKey}
            onChange={(e) => setDraft((d) => ({ ...d, recraftKey: e.target.value }))}
            placeholder="recraft_..."
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="cut-modal__footer">
          <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onClose}>
            {nl ? "Annuleren" : "Cancel"}
          </button>
          <button type="button" className="cut-modal__btn cut-modal__btn--primary" onClick={() => onSave(draft)}>
            {nl ? "Opslaan" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
