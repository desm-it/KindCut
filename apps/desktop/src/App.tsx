import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { buildBeginnerProject, joyStandardMat, validateProject } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "@cricut-companion/ai-designer";
import { MAT_PRESETS, MATERIAL_OPTIONS, buildPlanCommand } from "@cricut-companion/slicebug-bridge";
import { preflightSvg } from "@cricut-companion/svg-preflight";
import {
  APP_NAME,
  formatToolName,
  getFriendlyPlanResultCopy,
  getFriendlySlicebugStatusCopy,
} from "./onboarding-copy";
import { formatFileSize, getFriendlySvgMessages, getSvgSizeCopy, getSvgSizeInfo } from "./svg-import";
import {
  LANGUAGES,
  type Language,
  createTranslator,
  getMatBeginnerCopy,
  getMatName,
  getMaterialBeginnerCopy,
  getMaterialName,
  loadLanguagePreference,
  saveLanguagePreference,
  translateValidationMessage,
} from "./i18n";

type SlicebugStatus = {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
};

type SlicebugPlanResult = {
  ok: boolean;
  executable: string;
  inputSvgPath: string;
  outputPlanPath: string;
  stdout: string;
  stderr: string;
  message: string;
  plan: null | {
    mat: { width: number; height: number };
    material: { width: number; height: number; type: number };
    pathCount: number;
    tools: string[];
  };
};

type CutSessionSnapshot = {
  id: string;
  status: "idle" | "running" | "waiting" | "finished" | "error" | "stopped" | "blocked";
  action: {
    kind: string;
    title: string;
    message: string;
    requiresContinue: boolean;
    canStop: boolean;
    tone: "neutral" | "waiting" | "running" | "success" | "error";
  };
  transcript: string;
  command: string;
  args: string[];
  planPath: string;
};

type ImportedSvg = {
  fileName: string;
  fileSize: string;
  svg: string;
  sizeCopy: string;
  previewHtml: string;
  preflight: ReturnType<typeof preflightSvg>;
};

const sampleProject = buildBeginnerProject({
  name: "Dog birthday card",
  machine: "cricut_joy",
  mat: joyStandardMat,
  materialId: 218,
  prompt: "Create a cute dog birthday card with black pen details and a red cut border.",
});

const validation = validateProject(sampleProject);
const prompt = createDesignPrompt(sampleProject);
const preflight = preflightSvg(`<svg width="288" height="240"><path d="M 10 10 L 40 40" stroke="#000" fill="none" /></svg>`);
const planCommand = buildPlanCommand({
  slicebugExecutable: "slicebug",
  inputSvgPath: "examples/dog-card.svg",
  outputPlanPath: "examples/dog-card.json",
  materialId: sampleProject.material.id,
  matPreset: "joy-standard",
  colorMap: {
    "000000": "pen",
    ff0000: "fine_point_blade",
  },
});

export function App() {
  const [language, setLanguage] = useState<Language>(() => loadLanguagePreference());
  const [slicebugStatus, setSlicebugStatus] = useState<SlicebugStatus | null>(null);
  const [slicebugLoading, setSlicebugLoading] = useState(false);
  const [samplePlan, setSamplePlan] = useState<SlicebugPlanResult | null>(null);
  const [samplePlanLoading, setSamplePlanLoading] = useState(false);
  const [importedSvg, setImportedSvg] = useState<ImportedSvg | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState(218);
  const [selectedMatPreset, setSelectedMatPreset] = useState("joy-standard");
  const [importedPlan, setImportedPlan] = useState<SlicebugPlanResult | null>(null);
  const [importedPlanLoading, setImportedPlanLoading] = useState(false);
  const [cutSession, setCutSession] = useState<CutSessionSnapshot | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const { t } = useMemo(() => createTranslator(language), [language]);

  const statusCopy = useMemo(
    () => getFriendlySlicebugStatusCopy(slicebugStatus, slicebugLoading, language),
    [language, slicebugLoading, slicebugStatus],
  );

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguagePreference(window.localStorage, nextLanguage);
  }

  async function refreshSlicebugStatus() {
    if (!window.cricutCompanion?.slicebug) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message:
          language === "nl"
            ? "Open dit scherm in de Electron-desktopapp om SliceBug te gebruiken."
            : "Open this screen in the Electron desktop shell to call SliceBug.",
      });
      return;
    }

    setSlicebugLoading(true);
    try {
      setSlicebugStatus(await window.cricutCompanion.slicebug.getStatus());
    } catch (error) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message:
          error instanceof Error
            ? error.message
            : language === "nl"
              ? "Onbekende SliceBug-fout."
              : "Unknown SliceBug error.",
      });
    } finally {
      setSlicebugLoading(false);
    }
  }

  async function generateSamplePlan() {
    if (!window.cricutCompanion?.slicebug) {
      setSamplePlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message:
          language === "nl"
            ? "Open dit scherm in de Electron-desktopapp om een SliceBug-plan te maken."
            : "Open this screen in the Electron desktop shell to generate a SliceBug plan.",
        plan: null,
      });
      return;
    }

    setSamplePlanLoading(true);
    try {
      setSamplePlan(
        await window.cricutCompanion.slicebug.generateSamplePlan({
          materialId: selectedMaterialId,
          matPreset: selectedMatPreset,
        }),
      );
    } catch (error) {
      setSamplePlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message:
          error instanceof Error
            ? error.message
            : language === "nl"
              ? "Onbekende SliceBug-planfout."
              : "Unknown SliceBug plan error.",
        plan: null,
      });
    } finally {
      setSamplePlanLoading(false);
    }
  }

  async function prepareImportedPlan() {
    if (!importedSvg) {
      setImportMessage(t("import.chooseSvgFile"));
      return;
    }

    if (!window.cricutCompanion?.slicebug) {
      setImportedPlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message: t("import.openInShellPlan"),
        plan: null,
      });
      return;
    }

    setImportedPlanLoading(true);
    setImportedPlan(null);
    setCutSession(null);
    try {
      setImportedPlan(
        await window.cricutCompanion.slicebug.createPlan({
          svg: importedSvg.svg,
          fileName: importedSvg.fileName,
          materialId: selectedMaterialId,
          matPreset: selectedMatPreset,
        }),
      );
    } catch (error) {
      setImportedPlan({
        ok: false,
        executable: "",
        inputSvgPath: "",
        outputPlanPath: "",
        stdout: "",
        stderr: "",
        message: error instanceof Error ? error.message : t("import.planError"),
        plan: null,
      });
    } finally {
      setImportedPlanLoading(false);
    }
  }

  async function startCutSession(planPath: string) {
    if (!window.cricutCompanion?.slicebug) {
      return;
    }
    setCutBusy(true);
    try {
      setCutSession(await window.cricutCompanion.slicebug.startCutSession(planPath));
    } finally {
      setCutBusy(false);
    }
  }

  async function continueCutSession() {
    if (!window.cricutCompanion?.slicebug) {
      return;
    }
    setCutBusy(true);
    try {
      setCutSession(await window.cricutCompanion.slicebug.continueCutSession());
    } finally {
      setCutBusy(false);
    }
  }

  async function stopCutSession() {
    if (!window.cricutCompanion?.slicebug) {
      return;
    }
    setCutBusy(true);
    try {
      setCutSession(await window.cricutCompanion.slicebug.stopCutSession());
    } finally {
      setCutBusy(false);
    }
  }

  async function handleSvgFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportMessage(null);

    if (!file.name.toLowerCase().endsWith(".svg")) {
      setImportedSvg(null);
      setImportMessage(t("import.invalidSvg"));
      return;
    }

    try {
      const svg = await file.text();
      const filePreflight = preflightSvg(svg);
      setImportedSvg({
        fileName: file.name,
        fileSize: formatFileSize(file.size),
        svg,
        sizeCopy: getSvgSizeCopy(getSvgSizeInfo(svg), language),
        previewHtml: getSandboxedSvgPreview(svg),
        preflight: filePreflight,
      });
      setImportedPlan(null);
      setCutSession(null);
    } catch (error) {
      setImportedSvg(null);
      setImportMessage(error instanceof Error ? error.message : t("import.openError"));
    }
  }

  useEffect(() => {
    void refreshSlicebugStatus();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = APP_NAME;
  }, [language]);

  useEffect(() => {
    if (!window.cricutCompanion?.slicebug || !cutSession || !["running", "waiting"].includes(cutSession.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void window.cricutCompanion?.slicebug.getCutSession().then((snapshot) => {
        if (snapshot) {
          setCutSession(snapshot);
        }
      });
    }, 800);

    return () => window.clearInterval(timer);
  }, [cutSession]);

  return (
    <main className="app-shell">
      <section className="welcome">
        <div className="welcome-copy">
          <div className="welcome-topline">
            <p className="eyebrow">{t("welcome.eyebrow")}</p>
            <LanguageSelector language={language} onLanguageChange={handleLanguageChange} />
          </div>
          <h1>{APP_NAME}</h1>
          <p className="lede">{t("welcome.lede")}</p>
          <div className="welcome-actions">
            <button type="button" onClick={() => void generateSamplePlan()} disabled={samplePlanLoading}>
              {samplePlanLoading ? t("buttons.preparingPreview") : t("buttons.tryBirthdayCard")}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void refreshSlicebugStatus()}
              disabled={slicebugLoading}
            >
              {slicebugLoading ? t("buttons.checking") : t("buttons.checkSetupAgain")}
            </button>
          </div>
        </div>

        <aside className={`setup-panel setup-panel--${statusCopy.tone}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <p className="panel-label">{t("status.panelLabel")}</p>
          <h2>{statusCopy.title}</h2>
          <p>{statusCopy.message}</p>
          {statusCopy.details.length > 0 ? (
            <details>
              <summary>{t("details.advanced")}</summary>
              <pre>{statusCopy.details.join("\n")}</pre>
            </details>
          ) : null}
        </aside>
      </section>

      <section className="workflow-strip" aria-label={t("workflow.label")}>
        <span>{t("workflow.describe")}</span>
        <span>{t("workflow.preview")}</span>
        <span>{t("workflow.save")}</span>
        <span>{t("workflow.send")}</span>
      </section>

      <section className="content-grid">
        <article className="panel starter-panel">
          <p className="panel-label">{t("starter.panelLabel")}</p>
          <h2>{t("starter.sampleName")}</h2>
          <p className="soft-copy">{t("starter.description")}</p>
          <dl className="friendly-list">
            <dt>{t("starter.machine")}</dt>
            <dd>{sampleProject.machine.displayName}</dd>
            <dt>{t("starter.mat")}</dt>
            <dd>
              {getMatName("joy-standard", language) ?? sampleProject.mat.name}, {sampleProject.mat.widthIn} x{" "}
              {sampleProject.mat.heightIn} in
            </dd>
            <dt>{t("starter.material")}</dt>
            <dd>
              {getMaterialName(selectedMaterialId, language) ??
                MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.name ??
                sampleProject.material.name}
            </dd>
          </dl>
          <p className="choice-kicker">{t("starter.choiceKicker")}</p>
          <MaterialMatChooser
            language={language}
            selectedMaterialId={selectedMaterialId}
            selectedMatPreset={selectedMatPreset}
            onMaterialChange={setSelectedMaterialId}
            onMatChange={setSelectedMatPreset}
          />
        </article>

        <article className="panel">
          <p className="panel-label">{t("projectCheck.panelLabel")}</p>
          <h2>{validation.ok && preflight.ok ? t("projectCheck.readyTitle") : t("projectCheck.warningTitle")}</h2>
          <p className={validation.ok && preflight.ok ? "ok" : "warn"}>
            {validation.ok && preflight.ok
              ? t("projectCheck.readyMessage")
              : t("projectCheck.warningMessage")}
          </p>
          {validation.messages.length > 0 ? (
            <ul className="plain-list">
              {validation.messages.map((message) => (
                <li key={message}>{translateValidationMessage(message, language)}</li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="panel wide-panel import-panel">
          <div className="split-heading">
            <div>
              <p className="panel-label">{t("import.panelLabel")}</p>
              <h2>{t("import.title")}</h2>
            </div>
            <label className="file-button">
              {t("buttons.chooseSvg")}
              <input type="file" accept=".svg,image/svg+xml" onChange={(event) => void handleSvgFileChange(event)} />
            </label>
          </div>
          <p className="soft-copy">{t("import.description")}</p>

          {importMessage ? <p className="warn import-message">{importMessage}</p> : null}
          {importedSvg ? <ImportedSvgPreview importedSvg={importedSvg} language={language} /> : <EmptyImportState language={language} />}
          {importedSvg ? (
            <div className="prepare-row">
              <button type="button" onClick={() => void prepareImportedPlan()} disabled={importedPlanLoading}>
                {importedPlanLoading ? t("buttons.preparing") : t("buttons.prepareHandoff")}
              </button>
              <p>{t("import.prepareNote")}</p>
            </div>
          ) : null}
          {importedPlan ? (
            <PlanAndCutMonitor
              result={importedPlan}
              planLabel={importedSvg?.fileName ?? (language === "nl" ? "Geimporteerd ontwerp" : "Imported design")}
              language={language}
              cutSession={cutSession}
              cutBusy={cutBusy}
              onStart={() => void startCutSession(importedPlan.outputPlanPath)}
              onContinue={() => void continueCutSession()}
              onStop={() => void stopCutSession()}
            />
          ) : null}
        </article>

        <article className="panel wide-panel">
          <div className="split-heading">
            <div>
              <p className="panel-label">{t("practice.panelLabel")}</p>
              <h2>{t("practice.title")}</h2>
            </div>
            <button type="button" onClick={() => void generateSamplePlan()} disabled={samplePlanLoading}>
              {samplePlanLoading ? t("buttons.preparing") : t("buttons.preparePreview")}
            </button>
          </div>
          <p className="soft-copy">{t("practice.description")}</p>

          {samplePlan ? <SamplePlanResult result={samplePlan} language={language} /> : <EmptyPreviewState language={language} />}
        </article>

        <article className="panel wide-panel quiet-panel">
          <p className="panel-label">{t("later.panelLabel")}</p>
          <h2>{t("later.title")}</h2>
          <p className="soft-copy">{t("later.description")}</p>
          <div className="details-grid">
            <details>
              <summary>{t("details.designPrompt")}</summary>
              <pre>{prompt.system}</pre>
            </details>
            <details>
              <summary>{t("details.handoffCommand")}</summary>
              <pre>
                {planCommand.command} {planCommand.args.join(" ")}
              </pre>
            </details>
          </div>
        </article>
      </section>
    </main>
  );
}

function getSandboxedSvgPreview(svg: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        display: grid;
        place-items: center;
        background: #fffdf9;
      }

      svg {
        max-width: 92%;
        max-height: 92%;
        overflow: visible;
      }

      svg [stroke]:not([stroke="none"]) {
        vector-effect: non-scaling-stroke;
      }
    </style>
  </head>
  <body>${svg}</body>
</html>`;
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

function EmptyImportState({ language }: { language: Language }) {
  const { t } = createTranslator(language);

  return (
    <div className="import-empty">
      <div className="paper-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{t("import.empty")}</p>
    </div>
  );
}

function ImportedSvgPreview({ importedSvg, language }: { importedSvg: ImportedSvg; language: Language }) {
  const { t } = createTranslator(language);
  const friendlyMessages = getFriendlySvgMessages(importedSvg.preflight, language);
  const isReady = importedSvg.preflight.ok && importedSvg.preflight.warnings.length === 0;

  return (
    <div className="import-preview-grid">
      <div className="svg-preview-frame">
        <iframe title={t("import.previewTitle", { fileName: importedSvg.fileName })} sandbox="" srcDoc={importedSvg.previewHtml} />
      </div>

      <div className="import-summary">
        <p className="panel-label">{t("import.chosenFile")}</p>
        <h3>{importedSvg.fileName}</h3>
        <dl className="friendly-list compact-list">
          <dt>{t("import.file")}</dt>
          <dd>{importedSvg.fileSize}</dd>
          <dt>{t("import.artwork")}</dt>
          <dd>{importedSvg.sizeCopy}</dd>
        </dl>

        <div className={`svg-check svg-check--${isReady ? "ready" : "warning"}`}>
          <h3>{isReady ? t("import.readyTitle") : t("import.warningTitle")}</h3>
          {friendlyMessages.length > 0 ? (
            <ul className="plain-list">
              {friendlyMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : (
            <p>{t("import.readyMessage")}</p>
          )}
        </div>

        <details>
          <summary>{t("details.svgCheck")}</summary>
          <pre>
            {[
              importedSvg.preflight.issues.length > 0
                ? `Issues:\n${importedSvg.preflight.issues.join("\n")}`
                : "Issues: none",
              importedSvg.preflight.warnings.length > 0
                ? `Warnings:\n${importedSvg.preflight.warnings.join("\n")}`
                : "Warnings: none",
            ].join("\n\n")}
          </pre>
        </details>

        <details>
          <summary>{t("details.rawSvg")}</summary>
          <pre>{importedSvg.svg}</pre>
        </details>
      </div>
    </div>
  );
}

function MaterialMatChooser({
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

function PlanAndCutMonitor({
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
          <details>
            <summary>{t("details.cut")}</summary>
            <pre>
              {[
                `${cutSession.command} ${cutSession.args.join(" ")}`,
                cutSession.transcript.trim() || t("cut.noMessages"),
              ].join("\n\n")}
            </pre>
          </details>
        </div>
      ) : null}

      {copy.details.length > 0 ? (
        <details>
          <summary>{t("details.plan")}</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}

function getCutActionCopy(
  action: CutSessionSnapshot["action"],
  language: Language,
): { title: string; message: string } {
  const { t } = createTranslator(language);

  switch (action.kind) {
    case "finished":
      return { title: t("cutAction.finished.title"), message: t("cutAction.finished.message") };
    case "load-mat":
      return { title: t("cutAction.load-mat.title"), message: t("cutAction.load-mat.message") };
    case "load-tools":
      return { title: t("cutAction.load-tools.title"), message: t("cutAction.load-tools.message") };
    case "press-go":
      return { title: t("cutAction.press-go.title"), message: t("cutAction.press-go.message") };
    case "replace-tool":
      return { title: t("cutAction.replace-tool.title"), message: t("cutAction.replace-tool.message") };
    case "running":
      return { title: t("cutAction.running.title"), message: t("cutAction.running.message") };
    case "error":
      return { title: t("cutAction.error.title"), message: t("cutAction.error.message") };
    default:
      return { title: t("cutAction.idle.title"), message: t("cutAction.idle.message") };
  }
}

function EmptyPreviewState({ language }: { language: Language }) {
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

function SamplePlanResult({ result, language }: { result: SlicebugPlanResult; language: Language }) {
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
      {copy.details.length > 0 ? (
        <details>
          <summary>{t("details.advanced")}</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}
