import { useRef, useState } from "react";
import type { Language } from "../../i18n";
import type { AiSvgInput } from "../../ai-svg-generate";
import { aiSvgPreviewSrc } from "../../utils/svg-normalize";

// Three dog SVG icons illustrating each complexity level
function ComplexityDogIcon({ level }: { level: 1 | 2 | 3 }) {
  const fill = "currentColor";
  if (level === 1) {
    return (
      <svg viewBox="0 0 64 72" aria-hidden="true">
        <path fill={fill} d="
          M22 6 C18 3 12 6 12 12 C12 16 14 18 17 19
          L16 22 C12 25 10 31 10 38
          L10 58 C10 61 13 64 16 64
          L24 64 L24 58 L40 58 L40 64 L48 64
          C51 64 54 61 54 58 L54 38
          C54 31 52 25 48 22 L47 19
          C50 18 52 16 52 12
          C52 6 46 3 42 6
          L38 4 C35 1 29 1 26 4 Z
        "/>
      </svg>
    );
  }
  if (level === 2) {
    return (
      <svg viewBox="0 0 64 72" aria-hidden="true">
        <path fill={fill} d="
          M22 6 C18 3 12 6 12 12 C12 16 14 18 17 19
          L16 22 C12 25 10 31 10 38
          L10 58 C10 61 13 64 16 64
          L24 64 L24 58 L40 58 L40 64 L48 64
          C51 64 54 61 54 58 L54 38
          C54 31 52 25 48 22 L47 19
          C50 18 52 16 52 12
          C52 6 46 3 42 6
          L38 4 C35 1 29 1 26 4 Z
        "/>
        <path fill={fill} d="M26 36 C26 34 28 32 32 32 C36 32 38 34 38 36 C38 40 36 42 32 43 C28 42 26 40 26 36 Z"/>
        <path fill={fill} d="M54 42 C58 38 62 40 62 46 C62 50 60 53 56 52 C58 50 58 46 54 42 Z"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 72" aria-hidden="true">
      <ellipse fill={fill} cx="32" cy="50" rx="20" ry="16"/>
      <circle fill={fill} cx="32" cy="22" r="16"/>
      <ellipse fill={fill} cx="22" cy="10" rx="7" ry="9"/>
      <ellipse fill={fill} cx="42" cy="10" rx="7" ry="9"/>
      <path fill={fill} d="M50 48 C56 42 62 44 60 52 C58 58 52 58 50 54 Z"/>
    </svg>
  );
}

type AiPhase =
  | { type: "idle" }
  | { type: "generating"; statusLabel: string }
  | { type: "png-ready"; pngBase64: string }
  | { type: "tracing"; pngBase64: string }
  | { type: "ready"; pngBase64: string; svg: string }
  | { type: "error"; message: string };

export function AiGenerateModal({
  language,
  hasApiKey,
  onGenerate,
  onImport,
  onOpenSettings,
  onClose,
}: {
  language: Language;
  hasApiKey: boolean;
  onGenerate: (input: Omit<AiSvgInput, "settings">) => Promise<string>;
  onImport: (svg: string, prompt: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const nl = language === "nl";
  const [prompt, setPrompt] = useState("");
  const [cutterProof, setCutterProof] = useState(true);
  const [complexity, setComplexity] = useState<1 | 2 | 3>(1);
  const [phase, setPhase] = useState<AiPhase>({ type: "idle" });
  const [displayPct, setDisplayPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const complexityLabels = nl
    ? ["Silhouet", "Stencil", "Multi-vorm"]
    : ["Silhouette", "Stencil", "Multi-shape"];
  const complexityDescs = nl
    ? ["Één gevulde vorm", "Één stuk, weedbaar detail", "2-4 losse vormen"]
    : ["One filled shape", "One piece, weedable detail", "2-4 separate shapes"];

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function animateTo(target: number, durationMs: number) {
    clearTimer();
    const INTERVAL = 80;
    const steps = Math.max(1, Math.round(durationMs / INTERVAL));
    let step = 0;
    setDisplayPct((current) => {
      const start = current;
      const increment = (target - start) / steps;
      clearTimer();
      timerRef.current = setInterval(() => {
        step++;
        setDisplayPct(start + increment * step);
        if (step >= steps) { clearTimer(); setDisplayPct(target); }
      }, INTERVAL);
      return current;
    });
  }

  async function handleGenerate() {
    if (!prompt.trim() || !hasApiKey) return;
    clearTimer();
    setDisplayPct(0);

    const FAKE_DURATION = 30000;
    const FAKE_TARGET = 79;
    const INTERVAL = 200;
    const steps = FAKE_DURATION / INTERVAL;
    const inc = FAKE_TARGET / steps;
    let fakeStep = 0;
    timerRef.current = setInterval(() => {
      fakeStep++;
      setDisplayPct(Math.min(FAKE_TARGET, fakeStep * inc));
      if (fakeStep >= steps) clearTimer();
    }, INTERVAL);

    const modelLabel = nl ? "Afbeelding genereren…" : "Generating image…";
    setPhase({ type: "generating", statusLabel: modelLabel });

    let pngBase64Captured = "";

    try {
      const svg = await onGenerate({
        prompt: prompt.trim(),
        cutterProof,
        complexity,
        language,
        onPreview: (png) => {
          clearTimer();
          pngBase64Captured = png;
          animateTo(80, 1000);
          setTimeout(() => {
            setPhase({ type: "png-ready", pngBase64: png });
          }, 1000);
        },
      });

      clearTimer();
      setPhase({ type: "tracing", pngBase64: pngBase64Captured });
      animateTo(100, 2000);
      setTimeout(() => {
        setDisplayPct(100);
        setPhase({ type: "ready", pngBase64: pngBase64Captured, svg });
      }, 2000);

    } catch (e) {
      clearTimer();
      setPhase({ type: "error", message: e instanceof Error ? e.message : String(e) });
      setDisplayPct(0);
    }
  }

  function handleImport(svg: string) {
    onImport(svg, prompt.trim());
    onClose();
  }

  function handleRegenerate() {
    clearTimer();
    setPhase({ type: "idle" });
    setDisplayPct(0);
    void handleGenerate();
  }

  const isGenerating = phase.type === "generating" || phase.type === "png-ready" || phase.type === "tracing";
  const showBar = phase.type !== "idle" && phase.type !== "error";
  const isReady = phase.type === "ready";

  const statusLabel = (() => {
    if (phase.type === "generating") return phase.statusLabel;
    if (phase.type === "png-ready") return nl ? "Afbeelding ontvangen — vectorpaden traceren…" : "Image received — tracing vector paths…";
    if (phase.type === "tracing") return nl ? "Vectorpaden traceren…" : "Tracing vector paths…";
    if (phase.type === "ready") return nl ? "Klaar — bekijk en importeer het ontwerp" : "Ready — review and import the design";
    return "";
  })();

  return (
    <div
      className="cut-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget && !isGenerating) onClose(); }}
    >
      <div className="cut-modal cut-modal--narrow" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "AI-ontwerp genereren" : "Generate AI design"}</h2>
          {!isGenerating && (
            <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          )}
        </div>

        <div className="cut-modal__body cut-modal__body--col">
          {!hasApiKey && (
            <div className="ai-modal__no-key">
              <p>{nl ? "Geen API-sleutel ingesteld." : "No API key configured."}</p>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onOpenSettings}>
                {nl ? "Instellingen openen" : "Open settings"}
              </button>
            </div>
          )}

          <label className="settings-modal__label" htmlFor="ai-prompt">
            {nl ? "Beschrijving" : "Description"}
          </label>
          <textarea
            id="ai-prompt"
            className="ai-modal__prompt"
            rows={3}
            placeholder={nl ? "Blije hond…" : "Happy dog…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isGenerating) void handleGenerate();
              e.stopPropagation();
            }}
            autoFocus={!isGenerating}
          />

          <div className="ai-modal__complexity">
            <span className="settings-modal__label">{nl ? "Complexiteit" : "Complexity"}</span>
            <div className="ai-modal__complexity-toggles">
              {([1, 2, 3] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  disabled={isGenerating}
                  className={`ai-modal__complexity-btn${complexity === lvl ? " ai-modal__complexity-btn--active" : ""}`}
                  onClick={() => setComplexity(lvl)}
                  title={`${complexityLabels[lvl - 1]} — ${complexityDescs[lvl - 1]}`}
                >
                  <ComplexityDogIcon level={lvl} />
                  <span className="ai-modal__complexity-btn-label">{complexityLabels[lvl - 1]}</span>
                  <span className="ai-modal__complexity-btn-desc">{complexityDescs[lvl - 1]}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="ai-modal__checkbox-label">
            <input type="checkbox" checked={cutterProof} onChange={(e) => setCutterProof(e.target.checked)} disabled={isGenerating} />
            <span>
              {nl ? "Snijveilig" : "Cutter-proof"}
              <em>{nl ? " — ontwerp blijft in één stuk" : " — design stays in one piece"}</em>
            </span>
          </label>

          {showBar && (
            <div className="ai-modal__progress">
              <div className="ai-modal__progress-label">
                {isGenerating && <span className="ai-modal__spinner" aria-hidden="true" />}
                <span>{statusLabel}</span>
              </div>
              <div className="ai-modal__progress-bar-track">
                <div className="ai-modal__progress-bar-fill" style={{ width: `${displayPct}%`, transition: "width 0.4s ease" }} />
              </div>
              <div className="ai-modal__progress-pct">{Math.round(displayPct)}%</div>
            </div>
          )}

          {(phase.type === "png-ready" || phase.type === "tracing" || phase.type === "ready") && (
            <div className={`ai-modal__previews${phase.type === "ready" ? " ai-modal__previews--dual" : ""}`}>
              <div className="ai-modal__preview-col">
                <img
                  src={`data:image/png;base64,${(phase as { pngBase64: string }).pngBase64}`}
                  className="ai-modal__preview-img"
                  alt={nl ? "AI afbeelding" : "AI image"}
                />
                <span className="ai-modal__preview-label">
                  {nl ? "AI afbeelding" : "AI image"}
                </span>
              </div>
              {phase.type === "ready" && (
                <div className="ai-modal__preview-col">
                  <img
                    src={aiSvgPreviewSrc(phase.svg)}
                    className="ai-modal__preview-img"
                    alt={nl ? "Vectortracering" : "Vector trace"}
                  />
                  <span className="ai-modal__preview-label">
                    {nl ? "Vector tracering" : "Vector trace"}
                  </span>
                </div>
              )}
            </div>
          )}

          {phase.type === "error" && <p className="ai-modal__error">{phase.message}</p>}
        </div>

        <div className="cut-modal__footer">
          {isReady ? (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onClose}>
                {nl ? "Annuleren" : "Cancel"}
              </button>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={handleRegenerate}>
                {nl ? "Opnieuw" : "Regenerate"}
              </button>
              <button type="button" className="cut-modal__btn cut-modal__btn--primary" onClick={() => handleImport((phase as { svg: string }).svg)}>
                {nl ? "Importeren" : "Import"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={isGenerating} onClick={onClose}>
                {nl ? "Annuleren" : "Cancel"}
              </button>
              <button
                type="button"
                className="cut-modal__btn cut-modal__btn--primary"
                disabled={isGenerating || !prompt.trim() || !hasApiKey}
                onClick={() => void handleGenerate()}
              >
                {isGenerating ? (nl ? "Bezig…" : "Working…") : (nl ? "Genereren" : "Generate")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
