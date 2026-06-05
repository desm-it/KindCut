import type { Language } from "../../i18n";
import { getMatName } from "../../i18n";
import { getMatDimensionsInches } from "../../workspace-utils";
import { MATERIAL_OPTIONS } from "@cricut-companion/slicebug-bridge";
import type { CutSessionSnapshot, SlicebugPlanResult } from "../../app-types";
import { DEBUG } from "../../dev-flags";

export function CutPreviewModal({
  language,
  preview,
  cutBusy,
  cutSession,
  onClose,
  onConfirmCut,
  onContinueCut,
  onStopCut,
}: {
  language: Language;
  preview: { plan: SlicebugPlanResult; svg: string; matPreset: string; paperColor: string };
  cutBusy: boolean;
  cutSession: CutSessionSnapshot | null;
  onClose: () => void;
  onConfirmCut: () => void;
  onContinueCut: () => void;
  onStopCut: () => void;
}) {
  const nl = language === "nl";
  const { plan, svg, matPreset, paperColor } = preview;
  const matDims = getMatDimensionsInches(matPreset);
  const aspectRatio = matDims.width / matDims.height;
  const previewH = 320;
  const previewW = Math.round(previewH * aspectRatio);

  const isCutting = cutSession !== null && cutSession.status !== "finished" && cutSession.status !== "error" && cutSession.status !== "stopped";
  const isFinished = cutSession?.status === "finished";
  const isError = cutSession?.status === "error";
  const needsContinue = cutSession?.action.requiresContinue ?? false;

  return (
    <div className="cut-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !isCutting) onClose(); }}>
      <div className="cut-modal" onKeyDown={(e) => e.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">{nl ? "Snijden voorbereiden" : "Prepare cut"}</h2>
          {!isCutting && (
            <button type="button" className="cut-modal__close" onClick={onClose} aria-label={nl ? "Sluiten" : "Close"}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 3l10 10M13 3L3 13"/>
              </svg>
            </button>
          )}
        </div>

        <div className="cut-modal__body">
          <div className="cut-modal__preview-area">
            <div
              className="cut-modal__mat"
              style={{ width: previewW, height: previewH, backgroundColor: paperColor }}
              aria-label={nl ? "Matvoorbeeld" : "Mat preview"}
            >
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                width={previewW}
                height={previewH}
                alt=""
                style={{ width: previewW, height: previewH, display: "block" }}
              />
            </div>
            <p className="cut-modal__mat-label">{matDims.width} × {matDims.height} in · {getMatName(matPreset, language)}</p>
          </div>

          <div className="cut-modal__info">
            {plan.ok && plan.plan ? (
              <div className="cut-modal__plan-summary">
                <div className="cut-modal__plan-row">
                  <span>{nl ? "Materiaal" : "Material"}</span>
                  <strong>{MATERIAL_OPTIONS.find((m) => m.id === plan.plan!.material.type)?.name ?? `ID ${plan.plan.material.type}`}</strong>
                </div>
                <div className="cut-modal__plan-row">
                  <span>{nl ? "Paden" : "Paths"}</span>
                  <strong>{plan.plan.pathCount}</strong>
                </div>
                {plan.plan.tools.length > 0 && (
                  <div className="cut-modal__plan-row">
                    <span>{nl ? "Gereedschap" : "Tools"}</span>
                    <strong>{plan.plan.tools.join(", ")}</strong>
                  </div>
                )}
              </div>
            ) : (
              <p className="cut-modal__plan-error">{plan.message}</p>
            )}

            {cutSession && (
              <div className={`cut-modal__status cut-modal__status--${cutSession.action.tone}`}>
                <p className="cut-modal__status-title">{cutSession.action.title}</p>
                {cutSession.action.message && <p className="cut-modal__status-message">{cutSession.action.message}</p>}
                {DEBUG && cutSession.transcript && (
                  <pre className="cut-modal__transcript">{cutSession.transcript}</pre>
                )}
              </div>
            )}

            {isFinished && (
              <div className="cut-modal__eject">
                <span className="cut-modal__eject-badge">{nl ? "Laatste stap" : "Final step"}</span>
                <p className="cut-modal__eject-title">{nl ? "Werp de mat uit" : "Eject the mat"}</p>
                <p className="cut-modal__eject-msg">
                  {nl
                    ? "Druk op de knipperende Laden/Ontladen-knop (⤒⤓) op je Cricut om de mat uit te werpen, en haal je werk er voorzichtig af."
                    : "Press the flashing Load/Unload button (⤒⤓) on your Cricut to eject the mat, then gently peel your project off."}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="cut-modal__footer">
          {!isCutting && !isFinished && (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" onClick={onClose}>
                {nl ? "Annuleren" : "Cancel"}
              </button>
              <button
                type="button"
                className="cut-modal__btn cut-modal__btn--primary"
                disabled={!plan.ok || !plan.plan || cutBusy}
                onClick={onConfirmCut}
              >
                {cutBusy ? (nl ? "Bezig…" : "Working…") : (nl ? "Start snijden" : "Start cutting")}
              </button>
            </>
          )}
          {isCutting && (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={cutBusy} onClick={onStopCut}>
                {nl ? "Stop" : "Stop"}
              </button>
              {needsContinue && (
                <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={cutBusy} onClick={onContinueCut}>
                  {nl ? "Doorgaan" : "Continue"}
                </button>
              )}
            </>
          )}
          {(isFinished || isError) && (
            <button type="button" className="cut-modal__btn cut-modal__btn--primary" onClick={onClose}>
              {isFinished ? (nl ? "Klaar" : "Done") : (nl ? "Sluiten" : "Close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
