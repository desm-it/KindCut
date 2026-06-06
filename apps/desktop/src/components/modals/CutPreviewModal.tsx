import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Language, TranslationKey } from "../../i18n";
import { getMatName, getMaterialName, createTranslator } from "../../i18n";
import { getMatDimensionsInches } from "../../workspace-utils";
import { MATERIAL_OPTIONS } from "@cricut-companion/slicebug-bridge";
import type { CutSessionSnapshot, SlicebugPlanResult } from "../../app-types";
import { DEBUG } from "../../dev-flags";
import {
  MatIcon,
  MaterialIcon,
  ToolGlyph,
  materialCategoryOf,
  matPresetToVariant,
  prettyToolName,
  type CutToolKind,
} from "../workspace/CraftIcons";

export type CutTool = { tool: CutToolKind; color: string };

// The active step given the live session. Steps are: [start][mat][…tools][finish].
// `toolIndex` (how many tools the machine has moved through) puts us on the right tool step.
function activeStepIndex(cutSession: CutSessionSnapshot | null, toolCount: number, toolIndex: number): number {
  const finishIdx = 2 + toolCount;
  if (!cutSession || cutSession.status === "idle") return 0; // before "Start cutting"
  if (cutSession.status === "finished") return finishIdx;
  // Connecting (running, but no machine output yet) is still the very start — the mat
  // hasn't been requested, so don't jump ahead to the tool phase.
  if (cutSession.status === "running" && cutSession.transcript.trim() === "") return 0;
  const toolStep = 2 + Math.min(Math.max(toolIndex, 0), Math.max(toolCount - 1, 0));
  switch (cutSession.action.kind) {
    case "load-mat":
      return 1;
    case "load-tools":
    case "replace-tool":
    case "press-go":
    case "running":
      return toolStep; // the specific tool currently being loaded / drawn / cut
    case "unload":
    case "finished":
      return finishIdx;
    default:
      return 0;
  }
}

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" /></svg>
);
const FINISH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
);
// Generic brown mat used in the timeline (the big, correctly-coloured MatIcon only
// appears in the centre detail when the mat step is active).
const GENERIC_MAT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16M12 3v18" /></svg>
);
const ERROR_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
);
const STOP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" /></svg>
);

function CutSpinner({ small }: { small?: boolean }) {
  return <span className={`cut-spinner${small ? " cut-spinner--sm" : ""}`} aria-hidden="true" />;
}

// Friendly illustrations for the "is your cutter ready?" help panel.
const POWER_ILLO = (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="23" fill="#eef6ea" stroke="#4f7b47" strokeWidth="3" />
    <path d="M32 17v15" fill="none" stroke="#4f7b47" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M22 26a13 13 0 1 0 20 0" fill="none" stroke="#4f7b47" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);
const BLUETOOTH_ILLO = (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="23" fill="#eaf2fb" stroke="#3b6fb0" strokeWidth="3" />
    <path d="M24 40l16-16-8-8v32l8-8-16-16" fill="none" stroke="#3b6fb0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The "is your cutter ready?" guide. Shown both when connecting hangs (mode "waiting",
// still trying) and when the device connection fails outright (mode "failed", retry).
function CutConnectionHelp({ t, mode }: { t: (k: TranslationKey) => string; mode: "waiting" | "failed" }) {
  return (
    <div className="cut-detail cut-detail--help">
      <p className="cut-detail__name">{t("cut.connectHelpTitle")}</p>
      <p className="cut-detail__hint">{t("cut.connectHelpIntro")}</p>
      <div className="cut-conncheck">
        <div className="cut-conncheck__item">
          <span className="cut-conncheck__illo">{POWER_ILLO}</span>
          <span className="cut-conncheck__label">{t("cut.checkPower")}</span>
        </div>
        <div className="cut-conncheck__item">
          <span className="cut-conncheck__illo">{BLUETOOTH_ILLO}</span>
          <span className="cut-conncheck__label">{t("cut.checkBluetooth")}</span>
        </div>
      </div>
      {mode === "failed" ? (
        <p className="cut-conncheck__foot">{t("cut.connectRetryHint")}</p>
      ) : (
        <p className="cut-conncheck__foot">
          <CutSpinner small />
          {t("cut.connectHelpHint")}
        </p>
      )}
    </div>
  );
}

// SliceBug's CricutDevice plugin crashes (rather than waits) when no machine is reachable,
// so an early cut error with these signatures means "can't reach the cutter", not a real fault.
function isCutterConnectionFailure(transcript: string): boolean {
  return /plugin stdout closed|eoferror|could not keep the cut session|failed to connect|no device/i.test(transcript);
}

// Parse a SliceBug tool description ("pen (#0000ff)", "fine_point_blade") into a CutTool.
function parseToolDesc(desc: string): CutTool | null {
  const pen = desc.match(/pen\s*\(\s*([^)]+?)\s*\)/i);
  if (pen?.[1]) return { tool: "pen", color: pen[1].trim() };
  if (/blade|fine[\s_]*point|\bcut\b/i.test(desc)) return { tool: "fine_point_blade", color: "#6a4d38" };
  if (/\bpen\b|marker/i.test(desc)) return { tool: "pen", color: "#6a4d38" };
  return null;
}

// Work out which tool the machine is on (and which one it's asking for) from the transcript.
// SliceBug prints "Clamp …: <tool>" up front and "Replace the <x> with <y>." on each change,
// so the number of replacements = how far through the tool list we are.
function parseToolProgress(transcript: string, cutTools: CutTool[]): { index: number; requested: CutTool | null } {
  const replaces = [...transcript.matchAll(/replace\s+the\s+.+?\s+with\s+([^.\n]+)/gi)];
  const index = Math.min(replaces.length, Math.max(cutTools.length - 1, 0));
  let requested: CutTool | null = null;
  const lastReplaceDesc = replaces[replaces.length - 1]?.[1];
  if (lastReplaceDesc) {
    requested = parseToolDesc(lastReplaceDesc);
  } else {
    const clampDesc = transcript.match(/clamp[^:]*:\s*([^\n]+)/i)?.[1];
    if (clampDesc) requested = parseToolDesc(clampDesc);
  }
  return { index, requested: requested ?? cutTools[index] ?? null };
}

// Arrow showing the mat moving into (load) or out of (unload) the machine.
function MatArrow({ dir }: { dir: "in" | "out" }) {
  return (
    <span className={`cut-detail__arrow cut-detail__arrow--${dir}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {/* Load = mat feeds up into the machine; unload = mat comes back down/out. */}
        {dir === "in" ? <path d="M12 20V8M7 13l5-5 5 5" /> : <path d="M12 4v12M7 11l5 5 5-5" />}
      </svg>
    </span>
  );
}

type StepKind = "start" | "mat" | "tool" | "finish";
type Step = { key: string; kind: StepKind; label: string; tool?: CutTool };

// The cut sequence: Start cutting → Load mat → Load each tool (pen colour / blade) → Finish.
// Derived from the used tools so it shows before cutting begins.
function buildSteps(t: (k: TranslationKey) => string, cutTools: CutTool[]): Step[] {
  return [
    { key: "start", kind: "start", label: t("cut.startCutting") },
    { key: "mat", kind: "mat", label: t("cut.loadMat") },
    ...cutTools.map<Step>((tl, i) => ({
      key: `tool-${i}`,
      kind: "tool",
      label: `${t("cut.load")} ${prettyToolName(tl.tool)}`,
      tool: tl,
    })),
    { key: "finish", kind: "finish", label: t("cut.finish") },
  ];
}

function stepTimelineIcon(step: Step): ReactNode {
  switch (step.kind) {
    case "start":
      return PLAY_ICON;
    case "mat":
      return GENERIC_MAT_ICON;
    case "tool":
      return step.tool ? <ToolGlyph tool={step.tool.tool} color={step.tool.color} /> : null;
    case "finish":
      return FINISH_ICON;
  }
}

// Bottom timeline: icons only (labels live in the centre detail). The current step is
// highlighted; earlier steps are done, later steps upcoming.
function CutTimeline({ steps, current, finished, error }: { steps: Step[]; current: number; finished: boolean; error: boolean }) {
  return (
    <ol className={`cut-steps${error ? " cut-steps--error" : ""}`}>
      {steps.map((step, i) => {
        const state = finished || i < current ? "done" : i === current ? "active" : "upcoming";
        return (
          <li key={step.key} className={`cut-step cut-step--${state}`} title={step.label}>
            <span className="cut-step__tile" aria-hidden="true">{stepTimelineIcon(step)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Big centre view of whatever the user should do right now.
function CutStepDetail({ language, matPreset, cutSession, steps, current, requestedTool, showConnectionHelp }: { language: Language; matPreset: string; cutSession: CutSessionSnapshot | null; steps: Step[]; current: number; requestedTool: CutTool | null; showConnectionHelp: boolean }) {
  const { t } = createTranslator(language);
  const status = cutSession?.status;
  const kind = cutSession?.action.kind;
  const busy = status === "running";
  const transcript = cutSession?.transcript ?? "";
  const connecting = busy && transcript.trim() === "";

  // Failed to reach the cutter → show the connection guide with a retry hint.
  if (status === "error" && isCutterConnectionFailure(transcript)) {
    return <CutConnectionHelp t={t} mode="failed" />;
  }
  // Connecting too long → swap the spinner for the same guide, still trying.
  if (connecting && showConnectionHelp) {
    return <CutConnectionHelp t={t} mode="waiting" />;
  }

  let visual: ReactNode;
  let name: string;
  let hint = "";

  if (!cutSession || status === "idle") {
    visual = <span className="cut-detail__glyph cut-detail__glyph--play">{PLAY_ICON}</span>;
    name = t("cut.startCutting");
    hint = t("cut.startHint");
  } else if (status === "finished") {
    // Truly done (process exited after unload) → congratulate.
    visual = <span className="cut-detail__glyph cut-detail__glyph--done">{FINISH_ICON}</span>;
    name = t("cut.doneTitle");
    hint = t("cut.doneHint");
  } else if (status === "stopped") {
    visual = <span className="cut-detail__glyph cut-detail__glyph--error">{STOP_ICON}</span>;
    name = t("cut.stoppedTitle");
    hint = t("cut.stoppedHint");
  } else if (status === "error") {
    visual = <span className="cut-detail__glyph cut-detail__glyph--error">{ERROR_ICON}</span>;
    name = t("cutAction.error.title");
    hint = t("cutAction.error.message");
  } else if (kind === "unload") {
    // Cut done, mat still in the machine — eject it with the software Unload button.
    visual = (
      <span className="cut-detail__glyph cut-detail__glyph--mat">
        <MatIcon variant={matPresetToVariant(matPreset)} height={92} />
        <MatArrow dir="out" />
      </span>
    );
    name = t("cut.unloadTitle");
    hint = t("cut.unloadHint");
  } else if (busy) {
    visual = <CutSpinner />;
    name = connecting ? t("cut.connecting") : t("cut.working");
  } else if (kind === "load-mat") {
    visual = (
      <span className="cut-detail__glyph cut-detail__glyph--mat">
        <MatIcon variant={matPresetToVariant(matPreset)} height={92} />
        <MatArrow dir="in" />
      </span>
    );
    name = t("cut.loadMat");
    hint = t("cut.loadMatHint");
  } else if (kind === "load-tools" || kind === "replace-tool" || kind === "press-go") {
    // Show the exact tool the machine is asking for: a pen in its colour, or the blade.
    const tool = requestedTool ?? steps[current]?.tool ?? null;
    visual = (
      <span className="cut-detail__glyph cut-detail__glyph--tool">
        {tool ? <ToolGlyph tool={tool.tool} color={tool.color} /> : <ToolGlyph tool="pen" color="#6a4d38" />}
      </span>
    );
    name = tool ? `${t("cut.load")} ${prettyToolName(tool.tool)}` : t("cutAction.load-tools.title");
    hint = t("cutAction.load-tools.message");
  } else {
    visual = <span className="cut-detail__glyph cut-detail__glyph--play">{PLAY_ICON}</span>;
    name = cutSession.action.title;
    hint = cutSession.action.message ?? "";
  }

  return (
    <div className={`cut-detail${status === "error" || status === "stopped" ? " cut-detail--error" : ""}`}>
      <div className="cut-detail__visual">{visual}</div>
      <p className="cut-detail__name">{name}</p>
      {hint && <p className="cut-detail__hint">{hint}</p>}
    </div>
  );
}

export function CutPreviewModal({
  language,
  preview,
  cutBusy,
  cutSession,
  materialId,
  cutTools,
  onClose,
  onConfirmCut,
  onContinueCut,
  onStopCut,
}: {
  language: Language;
  preview: { plan: SlicebugPlanResult; svg: string; matPreset: string; paperColor: string };
  cutBusy: boolean;
  cutSession: CutSessionSnapshot | null;
  materialId: number;
  cutTools: CutTool[];
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

  const { t } = createTranslator(language);
  const [confirmStop, setConfirmStop] = useState(false);
  const steps = buildSteps(t, cutTools);
  const toolProgress = parseToolProgress(cutSession?.transcript ?? "", cutTools);
  const current = activeStepIndex(cutSession, cutTools.length, toolProgress.index);
  const isUnloading = cutSession?.action.kind === "unload";

  // Verbose machine output is for debugging only — keep it out of the grandma-friendly UI.
  useEffect(() => {
    if (DEBUG && cutSession?.transcript) console.log("[cut transcript]\n" + cutSession.transcript);
  }, [cutSession?.transcript]);

  // Connecting = running, but no machine output yet. If that lasts >15s the cutter is
  // probably off or not paired, so we show a friendly "is it ready?" guide.
  const connecting = cutSession?.status === "running" && (cutSession.transcript.trim() === "");
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  useEffect(() => {
    if (!connecting) {
      setShowConnectionHelp(false);
      return;
    }
    const id = setTimeout(() => setShowConnectionHelp(true), 15_000);
    return () => clearTimeout(id);
  }, [connecting]);

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
            {plan.ok ? (
              <>
                {/* Material + the tools that will run, as icon tiles (path count omitted). */}
                <div className="cut-modal__tiles">
                  <div className="cut-modal__tile">
                    <MaterialIcon kind={materialCategoryOf(materialId)} />
                    <span>{getMaterialName(materialId, language) ?? MATERIAL_OPTIONS.find((m) => m.id === materialId)?.name ?? (nl ? "Materiaal" : "Material")}</span>
                  </div>
                  {cutTools.map((tl, i) => (
                    <div className="cut-modal__tile" key={i}>
                      <ToolGlyph tool={tl.tool} color={tl.color} />
                      <span>{prettyToolName(tl.tool)}</span>
                    </div>
                  ))}
                </div>

                {/* Big detail of the current step in the middle, the icon-only timeline at the bottom. */}
                <CutStepDetail language={language} matPreset={matPreset} cutSession={cutSession} steps={steps} current={current} requestedTool={toolProgress.requested} showConnectionHelp={showConnectionHelp} />
                <CutTimeline steps={steps} current={current} finished={isFinished} error={isError} />
              </>
            ) : (
              <p className="cut-modal__plan-error">{plan.message}</p>
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
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={cutBusy} onClick={() => setConfirmStop(true)}>
                {nl ? "Stop" : "Stop"}
              </button>
              {needsContinue && (
                <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={cutBusy} onClick={onContinueCut}>
                  {isUnloading ? t("cut.unloadBtn") : nl ? "Doorgaan" : "Continue"}
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

        {confirmStop && (
          <div className="cut-stop-warn" role="alertdialog" aria-modal="true">
            <div className="cut-stop-warn__panel">
              <span className="cut-stop-warn__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3.5 1.8 20.5h20.4z" /><path d="M12 10v4.5M12 17.5v.5" />
                </svg>
              </span>
              <h3 className="cut-stop-warn__title">{t("cut.stopWarnTitle")}</h3>
              <p className="cut-stop-warn__body">{t("cut.stopWarnBody")}</p>
              <div className="cut-stop-warn__actions">
                <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={cutBusy} onClick={() => setConfirmStop(false)}>
                  {t("cut.stopWarnKeep")}
                </button>
                <button type="button" className="cut-modal__btn cut-modal__btn--danger" disabled={cutBusy} onClick={() => { setConfirmStop(false); onStopCut(); }}>
                  {t("cut.stopWarnConfirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
