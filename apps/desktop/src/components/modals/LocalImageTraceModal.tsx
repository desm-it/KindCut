import { useEffect, useRef, useState } from "react";
import type { Language } from "../../i18n";
import {
  DEFAULT_RASTER_TRACE_OPTIONS,
  normalizeRasterTraceOptions,
  type RasterTraceOptions,
} from "../../local-raster-import";
import { aiSvgPreviewSrc } from "../../utils/svg-normalize";

export type LocalRasterImport = {
  fileName: string;
  fileSize: string;
  mimeType: string;
  base64: string;
};

type TracePhase =
  | { type: "tracing" }
  | { type: "ready"; svg: string }
  | { type: "error"; message: string };

export function LocalImageTraceModal({
  language,
  source,
  onTrace,
  onImport,
  onClose,
}: {
  language: Language;
  source: LocalRasterImport;
  onTrace: (source: LocalRasterImport, traceOptions?: RasterTraceOptions) => Promise<string>;
  onImport: (source: LocalRasterImport, svg: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const nl = language === "nl";
  const [phase, setPhase] = useState<TracePhase>({ type: "tracing" });
  const [latestSvg, setLatestSvg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [displayPct, setDisplayPct] = useState(8);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [traceOptions, setTraceOptions] = useState<RasterTraceOptions>(DEFAULT_RASTER_TRACE_OPTIONS);
  const [retryNonce, setRetryNonce] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const lastSourceRef = useRef<LocalRasterImport | null>(null);
  const lastRetryNonceRef = useRef(retryNonce);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function animateTo(target: number, durationMs: number) {
    clearTimer();
    const interval = 80;
    const steps = Math.max(1, Math.round(durationMs / interval));
    setDisplayPct((current) => {
      const start = current;
      const increment = (target - start) / steps;
      let step = 0;
      timerRef.current = setInterval(() => {
        step += 1;
        setDisplayPct(Math.min(target, start + increment * step));
        if (step >= steps) {
          clearTimer();
          setDisplayPct(target);
        }
      }, interval);
      return current;
    });
  }

  function clearDebounce() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function updateTraceOptions(next: Partial<RasterTraceOptions>) {
    setTraceOptions((current) => normalizeRasterTraceOptions({ ...current, ...next }));
  }

  function resetTraceOptions() {
    setTraceOptions(DEFAULT_RASTER_TRACE_OPTIONS);
  }

  async function runTrace(options: RasterTraceOptions, delayMs: number) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    clearDebounce();
    clearTimer();
    setPhase({ type: "tracing" });
    setDisplayPct(8);

    debounceRef.current = setTimeout(() => {
      animateTo(88, 8000);
      void (async () => {
        try {
          const svg = await onTrace(source, options);
          if (requestIdRef.current !== requestId) return;
          clearTimer();
          setDisplayPct(100);
          setLatestSvg(svg);
          setPhase({ type: "ready", svg });
        } catch (error) {
          if (requestIdRef.current !== requestId) return;
          clearTimer();
          setDisplayPct(0);
          setPhase({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }, delayMs);
  }

  async function handleImport(svg: string) {
    setImporting(true);
    try {
      await onImport(source, svg);
    } catch (error) {
      setPhase({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    const sourceChanged = lastSourceRef.current !== source;
    const retryChanged = lastRetryNonceRef.current !== retryNonce;
    if (sourceChanged) {
      setLatestSvg(null);
    }
    lastSourceRef.current = source;
    lastRetryNonceRef.current = retryNonce;
    void runTrace(traceOptions, sourceChanged || retryChanged ? 0 : 400);
    return () => {
      requestIdRef.current += 1;
      clearDebounce();
      clearTimer();
    };
  }, [source, traceOptions, retryNonce]);

  const isTracing = phase.type === "tracing";
  const isBusy = isTracing || importing;
  const progressPct = phase.type === "ready" ? 100 : displayPct;
  const previewSvg = phase.type === "ready" ? phase.svg : latestSvg;
  const originalSrc = `data:${source.mimeType};base64,${source.base64}`;
  const statusLabel = importing
    ? nl ? "Afbeelding importeren..." : "Importing image..."
    : isTracing
    ? settingsOpen ? (nl ? "Voorbeeld bijwerken..." : "Updating preview...") : (nl ? "Afbeelding vectoriseren..." : "Vectorizing image...")
    : phase.type === "ready"
      ? nl ? "Klaar - bekijk en importeer de tracering" : "Ready - review and import the trace"
      : nl ? "Vectoriseren mislukt" : "Vectorizing failed";

  return (
    <div className="cut-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !isBusy) onClose(); }}>
      <div className="cut-modal cut-modal--narrow" onKeyDown={(event) => event.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "Afbeelding importeren" : "Import image"}</h2>
          {!isBusy ? (
            <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          ) : null}
        </div>

        <div className="cut-modal__body cut-modal__body--col">
          <p className="update-modal__detail">
            {source.fileName} · {source.fileSize}
          </p>

          <div className="ai-modal__progress">
            <div className="ai-modal__progress-label">
              {isBusy ? <span className="ai-modal__spinner" aria-hidden="true" /> : null}
              <span>{statusLabel}</span>
            </div>
            <div className="ai-modal__progress-bar-track">
              <div className="ai-modal__progress-bar-fill" style={{ width: `${progressPct}%`, transition: "width 0.4s ease" }} />
            </div>
            <div className="ai-modal__progress-pct">{Math.round(progressPct)}%</div>
          </div>

          <button
            type="button"
            className="local-trace__settings-toggle"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
          >
            <span>{nl ? "Trace-instellingen" : "Trace settings"}</span>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={settingsOpen ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
            </svg>
          </button>

          {settingsOpen ? (
            <div className="local-trace__settings">
              <label className="local-trace__range">
                <span className="local-trace__range-head">
                  <span>{nl ? "Drempel" : "Threshold"}</span>
                  <strong>{traceOptions.threshold}</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="255"
                  step="1"
                  value={traceOptions.threshold}
                  disabled={importing}
                  onChange={(event) => updateTraceOptions({ threshold: Number(event.currentTarget.value) })}
                />
                <span className="local-trace__range-scale">
                  <span>{nl ? "Minder vulling" : "Less fill"}</span>
                  <span>{nl ? "Meer vulling" : "More fill"}</span>
                </span>
              </label>

              <label className="local-trace__range">
                <span className="local-trace__range-head">
                  <span>{nl ? "Detail" : "Detail"}</span>
                  <strong>{traceOptions.detail}</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={traceOptions.detail}
                  disabled={importing}
                  onChange={(event) => updateTraceOptions({ detail: Number(event.currentTarget.value) })}
                />
                <span className="local-trace__range-scale">
                  <span>{nl ? "Schoner" : "Cleaner"}</span>
                  <span>{nl ? "Meer detail" : "More detail"}</span>
                </span>
              </label>

              <div className="local-trace__settings-row">
                <label className="ai-modal__checkbox-label">
                  <input
                    type="checkbox"
                    checked={traceOptions.invert}
                    disabled={importing}
                    onChange={(event) => updateTraceOptions({ invert: event.currentTarget.checked })}
                  />
                  <span>{nl ? "Omkeren" : "Invert"}</span>
                </label>
                <button type="button" className="local-trace__reset" disabled={importing} onClick={resetTraceOptions}>
                  {nl ? "Reset" : "Reset"}
                </button>
              </div>
            </div>
          ) : null}

          <div className={`ai-modal__previews${previewSvg ? " ai-modal__previews--dual" : ""}`}>
            <div className="ai-modal__preview-col">
              <img
                src={originalSrc}
                className="ai-modal__preview-img"
                alt={nl ? "Originele afbeelding" : "Original image"}
              />
              <span className="ai-modal__preview-label">
                {nl ? "Origineel" : "Original"}
              </span>
            </div>
            {previewSvg ? (
              <div className={`ai-modal__preview-col${isTracing ? " local-trace__preview-col--updating" : ""}`}>
                <img
                  src={aiSvgPreviewSrc(previewSvg)}
                  className="ai-modal__preview-img"
                  alt={nl ? "Vectortracering" : "Vector trace"}
                />
                <span className="ai-modal__preview-label">
                  {isTracing ? (nl ? "Vector tracering bijwerken" : "Updating vector trace") : (nl ? "Vector tracering" : "Vector trace")}
                </span>
              </div>
            ) : null}
          </div>

          {phase.type === "error" ? <p className="ai-modal__error">{phase.message}</p> : null}
        </div>

        <div className="cut-modal__footer">
          <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={isBusy} onClick={onClose}>
            {nl ? "Annuleren" : "Cancel"}
          </button>
          {phase.type === "error" ? (
            <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={isBusy} onClick={() => setRetryNonce((value) => value + 1)}>
              {nl ? "Opnieuw" : "Retry"}
            </button>
          ) : null}
          {phase.type === "ready" ? (
            <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={isBusy} onClick={() => void handleImport(phase.svg)}>
              {importing ? (nl ? "Importeren..." : "Importing...") : (nl ? "Importeren" : "Import")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
