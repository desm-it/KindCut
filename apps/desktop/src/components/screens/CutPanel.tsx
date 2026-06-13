import {
  type Language,
  createTranslator,
  getMaterialBeginnerCopy,
  getMatBeginnerCopy,
  getMaterialName,
  getMatName,
  getTranslatedCutActionCopy,
} from "../../i18n";
import { MAT_PRESETS, MATERIAL_OPTIONS } from "@cricut-companion/slicebug-bridge";
import { getFriendlyPlanResultCopy, formatToolName } from "../../onboarding-copy";
import type { CutSessionSnapshot, SlicebugPlanResult } from "../../app-types";
import { DEBUG } from "../../dev-flags";

function getCutActionCopy(
  action: CutSessionSnapshot["action"],
  language: Language,
): { title: string; message: string } {
  return getTranslatedCutActionCopy(action, language);
}

export function MaterialMatChooser({
  language,
  selectedMaterialId,
  selectedMatPreset,
  onMaterialChange,
  onMatChange,
}: {
  language: Language;
  selectedMaterialId: number;
  selectedMatPreset: string;
  onMaterialChange: (materialId: number) => void;
  onMatChange: (matPreset: string) => void;
}) {
  const { t } = createTranslator(language);
  const materialCopy = getMaterialBeginnerCopy(selectedMaterialId, language);
  const matCopy = getMatBeginnerCopy(selectedMatPreset, language);

  return (
    <div className="choice-panel" aria-label={t("choice.aria")}>
      <label>
        {t("choice.material")}
        <select value={selectedMaterialId} onChange={(event) => onMaterialChange(Number(event.target.value))}>
          {MATERIAL_OPTIONS.map((material) => (
            <option key={material.id} value={material.id}>
              {getMaterialName(material.id, language) ?? material.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("choice.mat")}
        <select value={selectedMatPreset} onChange={(event) => onMatChange(event.target.value)}>
          {MAT_PRESETS.map((mat) => (
            <option key={mat.id} value={mat.id}>
              {getMatName(mat.id, language) ?? mat.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        {materialCopy ?? MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.beginnerCopy}{" "}
        {matCopy ?? MAT_PRESETS.find((mat) => mat.id === selectedMatPreset)?.beginnerCopy}
      </p>
    </div>
  );
}

export function PlanAndCutMonitor({
  result,
  planLabel,
  language,
  cutSession,
  cutBusy,
  onStart,
  onContinue,
  onStop,
}: {
  result: SlicebugPlanResult;
  planLabel: string;
  language: Language;
  cutSession: CutSessionSnapshot | null;
  cutBusy: boolean;
  onStart: () => void;
  onContinue: () => void;
  onStop: () => void;
}) {
  const { t } = createTranslator(language);
  const copy = getFriendlyPlanResultCopy(result, language);
  const canStart = result.ok && result.plan && !cutSession;
  const cutActionCopy = cutSession ? getCutActionCopy(cutSession.action, language) : null;

  return (
    <div className={`sample-result sample-result--${copy.tone}`}>
      <p className="panel-label">{t("plan.importedPanelLabel")}</p>
      <h3>{result.ok ? t("plan.readyToSendTitle") : copy.title}</h3>
      <p>
        {t("plan.currentPlan")} <strong>{planLabel}</strong>. {copy.message}
      </p>
      {result.plan ? (
        <dl className="friendly-list compact-list">
          <dt>{t("plan.layers")}</dt>
          <dd>{result.plan.pathCount}</dd>
          <dt>{t("plan.tools")}</dt>
          <dd>{result.plan.tools.map((tool) => formatToolName(tool, language)).join(", ") || t("plan.noTools")}</dd>
        </dl>
      ) : null}

      {canStart ? (
        <div className="cut-start">
          <button type="button" onClick={onStart} disabled={cutBusy}>
            {cutBusy ? t("buttons.starting") : t("buttons.startCut")}
          </button>
          <p>{t("plan.startCutNote")}</p>
        </div>
      ) : null}

      {cutSession && cutActionCopy ? (
        <div className={`cut-monitor cut-monitor--${cutSession.action.tone}`} aria-live="polite">
          <p className="panel-label">{t("cut.panelLabel")}</p>
          <h3>{cutActionCopy.title}</h3>
          <p>{cutActionCopy.message}</p>
          <ol className="cut-progress" aria-label={t("cut.progressLabel")}>
            <li className="cut-progress__done">{t("cut.preparePlan")}</li>
            <li className={cutSession.action.kind === "load-tools" ? "cut-progress__active" : ""}>{t("cut.loadTool")}</li>
            <li className={cutSession.action.kind === "load-mat" ? "cut-progress__active" : ""}>{t("cut.loadMat")}</li>
            <li className={cutSession.action.kind === "running" ? "cut-progress__active" : ""}>{t("cut.cutDraw")}</li>
            <li className={cutSession.action.kind === "finished" ? "cut-progress__active" : ""}>{t("cut.finish")}</li>
          </ol>
          <div className="cut-actions">
            {cutSession.action.requiresContinue ? (
              <button type="button" onClick={onContinue} disabled={cutBusy}>
                {t("buttons.continue")}
              </button>
            ) : null}
            {cutSession.action.canStop ? (
              <button className="secondary-button" type="button" onClick={onStop} disabled={cutBusy}>
                {t("buttons.stop")}
              </button>
            ) : null}
          </div>
          {DEBUG ? (
            <details>
              <summary>{t("details.cut")}</summary>
              <pre>
                {[
                  `${cutSession.command} ${cutSession.args.join(" ")}`,
                  cutSession.transcript.trim() || t("cut.noMessages"),
                ].join("\n\n")}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      {DEBUG && copy.details.length > 0 ? (
        <details>
          <summary>{t("details.plan")}</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function EmptyPreviewState({ language }: { language: Language }) {
  const { t } = createTranslator(language);

  return (
    <div className="empty-preview">
      <div className="mat-preview" aria-hidden="true">
        <div className="card-preview">
          <span className="cut-line" />
          <span className="pen-line pen-line--short" />
          <span className="pen-line" />
        </div>
      </div>
      <p>{t("practice.empty")}</p>
    </div>
  );
}

export function SamplePlanResult({ result, language }: { result: SlicebugPlanResult; language: Language }) {
  const { t } = createTranslator(language);
  const copy = getFriendlyPlanResultCopy(result, language);

  return (
    <div className={`sample-result sample-result--${copy.tone}`}>
      <h3>{copy.title}</h3>
      <p>{copy.message}</p>
      {result.plan ? (
        <dl className="friendly-list compact-list">
          <dt>{t("plan.layers")}</dt>
          <dd>{result.plan.pathCount}</dd>
          <dt>{t("plan.tools")}</dt>
          <dd>{result.plan.tools.map((tool) => formatToolName(tool, language)).join(", ") || t("plan.noTools")}</dd>
        </dl>
      ) : null}
      {DEBUG && copy.details.length > 0 ? (
        <details>
          <summary>{t("details.advanced")}</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}
