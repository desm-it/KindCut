import { LANGUAGES, type Language, createTranslator } from "../../i18n";
import { APP_NAME, getFriendlySlicebugStatusCopy } from "../../onboarding-copy";
import { DEBUG } from "../../dev-flags";

// Friendly craft scene: a card on a Cricut mat with a flower, drawn line and sparkles.
function WelcomeArt() {
  return (
    <svg className="welcome-art" viewBox="0 0 260 240" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="welcome-art-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f6e7d2" />
          <stop offset="100%" stopColor="#f6e7d2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="130" cy="118" r="118" fill="url(#welcome-art-bg)" />
      {/* Cutting mat */}
      <g transform="rotate(-7 130 130)">
        <rect x="46" y="70" width="168" height="128" rx="14" fill="#7cbf6b" />
        <rect x="46" y="70" width="168" height="128" rx="14" fill="none" stroke="#5fa24f" strokeWidth="3" />
        {/* Card on the mat */}
        <rect x="70" y="88" width="120" height="92" rx="6" fill="#fffdf9" stroke="#e2d2b8" strokeWidth="2" />
        {/* Hand-drawn pen line */}
        <path d="M86 110 q10 -10 20 0 t20 0 t20 0" stroke="#6a8540" strokeWidth="3.4" strokeLinecap="round" fill="none" />
        {/* Daisy flower */}
        <g transform="translate(132 150)">
          {Array.from({ length: 8 }).map((_, i) => (
            <ellipse key={i} cx="0" cy="-17" rx="7" ry="13" fill="#fff6ea" stroke="#caa06f" strokeWidth="1.6"
              transform={`rotate(${i * 45})`} />
          ))}
          <circle cx="0" cy="0" r="10" fill="#8f4f2b" />
        </g>
      </g>
      {/* Sparkles */}
      <g stroke="#d99a52" strokeWidth="3" strokeLinecap="round">
        <path d="M214 56 v14 M207 63 h14" />
        <path d="M40 150 v10 M35 155 h10" />
      </g>
      <circle cx="206" cy="180" r="4" fill="#e0b277" />
      <circle cx="52" cy="64" r="3.5" fill="#bcd9ab" />
    </svg>
  );
}

// Circular connection status badge: check when connected, warning when not, spinner
// while checking.
function ConnectionBadge({ tone }: { tone: string }) {
  return (
    <span className={`connection-badge connection-badge--${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {tone === "ready" ? (
          <path d="M5 13l4 4 10-11" />
        ) : tone === "warning" ? (
          <>
            <path d="M12 3l9 16H3z" />
            <path d="M12 9v4" />
            <path d="M12 16.5h.01" />
          </>
        ) : (
          <path d="M21 12a9 9 0 1 0-3 6.7" />
        )}
      </svg>
    </span>
  );
}

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
  slicebugBootstrapLoading,
  showBootstrapSetup,
  onLanguageChange,
  onNewProject,
  onOpenProject,
  onExampleProject,
  onCheckSetup,
  onBootstrapSetup,
}: {
  language: Language;
  statusCopy: ReturnType<typeof getFriendlySlicebugStatusCopy>;
  statusDetailsLabel: string;
  samplePlanLoading: boolean;
  slicebugLoading: boolean;
  slicebugBootstrapLoading: boolean;
  showBootstrapSetup: boolean;
  onLanguageChange: (language: Language) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onExampleProject: () => void;
  onCheckSetup: () => void;
  onBootstrapSetup: () => void;
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
          <WelcomeArt />
        </div>

        <div className="welcome-project-actions no-drag">
          <button className="project-choice project-choice--primary" type="button" onClick={onNewProject}>
            <span className="project-choice__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="project-choice__text">
              <span>{t("welcome.newProject")}</span>
              <small>{t("welcome.newProjectCopy")}</small>
            </span>
          </button>
          <button className="project-choice" type="button" onClick={onOpenProject}>
            <span className="project-choice__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </span>
            <span className="project-choice__text">
              <span>{t("welcome.openProject")}</span>
              <small>{t("welcome.openProjectCopy")}</small>
            </span>
          </button>
          <button className="project-choice" type="button" onClick={onExampleProject} disabled={samplePlanLoading}>
            <span className="project-choice__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2.4 5 5.6.6-4.2 3.7 1.2 5.5L12 18l-5 2.8 1.2-5.5L4 11.6 9.6 11z" />
              </svg>
            </span>
            <span className="project-choice__text">
              <span>{samplePlanLoading ? t("buttons.preparingPreview") : t("welcome.exampleProject")}</span>
              <small>{t("welcome.exampleProjectCopy")}</small>
            </span>
          </button>
        </div>

        <aside className={`setup-panel setup-bar setup-panel--${statusCopy.tone} no-drag`} aria-live="polite">
          <ConnectionBadge tone={statusCopy.tone} />
          <p className="setup-bar__text">
            <strong className="setup-bar__title">{statusCopy.title}</strong>{" "}
            <span className="setup-bar__msg">{statusCopy.message}</span>
          </p>
          {statusCopy.tone === "warning" && showBootstrapSetup ? (
            <button className="secondary-button setup-bar__btn" type="button" onClick={onBootstrapSetup} disabled={slicebugBootstrapLoading}>
              {slicebugBootstrapLoading ? t("buttons.settingUp") : t("buttons.setupCricutHelper")}
            </button>
          ) : statusCopy.tone === "warning" ? (
            <button className="secondary-button setup-bar__btn" type="button" onClick={onCheckSetup} disabled={slicebugLoading}>
              {slicebugLoading ? t("buttons.checking") : t("buttons.checkSetupAgain")}
            </button>
          ) : null}
          {DEBUG && statusCopy.details.length > 0 ? (
            <details className="setup-bar__details">
              <summary>{statusDetailsLabel}</summary>
              <pre>{statusCopy.details.join("\n")}</pre>
            </details>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
