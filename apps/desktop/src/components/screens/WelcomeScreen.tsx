import { LANGUAGES, type Language, createTranslator } from "../../i18n";
import { APP_NAME, getFriendlySlicebugStatusCopy } from "../../onboarding-copy";

function LanguageSelector({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const { t } = createTranslator(language);

  return (
    <label className="language-selector">
      <span>{t("language.label")}</span>
      <select value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
        {LANGUAGES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {t(candidate === "nl" ? "language.nl" : "language.en")}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WelcomeScreen({
  language,
  statusCopy,
  statusDetailsLabel,
  samplePlanLoading,
  slicebugLoading,
  onLanguageChange,
  onNewProject,
  onOpenProject,
  onExampleProject,
  onCheckSetup,
}: {
  language: Language;
  statusCopy: ReturnType<typeof getFriendlySlicebugStatusCopy>;
  statusDetailsLabel: string;
  samplePlanLoading: boolean;
  slicebugLoading: boolean;
  onLanguageChange: (language: Language) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onExampleProject: () => void;
  onCheckSetup: () => void;
}) {
  const { t } = createTranslator(language);

  return (
    <main className="app-shell welcome-shell">
      <div className="native-window-drag-zone app-drag" aria-hidden="true" />
      <section className="welcome-screen" aria-label={t("welcome.eyebrow")}>
        <div className="welcome-screen__top no-drag">
          <p className="eyebrow">{t("welcome.eyebrow")}</p>
          <LanguageSelector language={language} onLanguageChange={onLanguageChange} />
        </div>

        <div className="welcome-hero">
          <div>
            <h1>{APP_NAME}</h1>
            <p className="lede">{t("welcome.lede")}</p>
          </div>
          <div className="welcome-card-stack" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="welcome-project-actions no-drag">
          <button className="project-choice project-choice--primary" type="button" onClick={onNewProject}>
            <span>{t("welcome.newProject")}</span>
            <small>{t("welcome.newProjectCopy")}</small>
          </button>
          <button className="project-choice" type="button" onClick={onOpenProject}>
            <span>{t("welcome.openProject")}</span>
            <small>{t("welcome.openProjectCopy")}</small>
          </button>
          <button className="project-choice" type="button" onClick={onExampleProject} disabled={samplePlanLoading}>
            <span>{samplePlanLoading ? t("buttons.preparingPreview") : t("welcome.exampleProject")}</span>
            <small>{t("welcome.exampleProjectCopy")}</small>
          </button>
        </div>

        <aside className={`setup-panel setup-panel--${statusCopy.tone} no-drag`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <p className="panel-label">{t("status.panelLabel")}</p>
            <h2>{statusCopy.title}</h2>
            <p>{statusCopy.message}</p>
            <button className="secondary-button" type="button" onClick={onCheckSetup} disabled={slicebugLoading}>
              {slicebugLoading ? t("buttons.checking") : t("buttons.checkSetupAgain")}
            </button>
            {statusCopy.details.length > 0 ? (
              <details>
                <summary>{statusDetailsLabel}</summary>
                <pre>{statusCopy.details.join("\n")}</pre>
              </details>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
