import type { Language } from "../../i18n";
import { createTranslator } from "../../i18n";

// Save / Don't save / Cancel prompt shown before an action that would discard the current
// project (reload, Home, open another, start new). `neverSaved` switches the wording to make
// clear the whole project has never been saved yet.
export function UnsavedChangesModal({
  language,
  neverSaved,
  busy,
  onSave,
  onDiscard,
  onCancel,
}: {
  language: Language;
  neverSaved: boolean;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const { t } = createTranslator(language);
  return (
    <div className="cut-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" onKeyDown={(e) => e.stopPropagation()}>
        <span className="confirm-modal__icon confirm-modal__icon--warn" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5 1.8 20.5h20.4z" /><path d="M12 10v4.5M12 17.5v.5" />
          </svg>
        </span>
        <h2 className="confirm-modal__title">{t("unsaved.title")}</h2>
        <p className="confirm-modal__body">{neverSaved ? t("unsaved.bodyNever") : t("unsaved.bodySaved")}</p>
        <div className="confirm-modal__actions">
          <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={busy} onClick={onCancel}>
            {t("unsaved.cancel")}
          </button>
          <button type="button" className="cut-modal__btn cut-modal__btn--danger-soft" disabled={busy} onClick={onDiscard}>
            {t("unsaved.discard")}
          </button>
          <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={busy} onClick={onSave}>
            {t("unsaved.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
