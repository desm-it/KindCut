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

  const statusCopy = useMemo(
    () => getFriendlySlicebugStatusCopy(slicebugStatus, slicebugLoading),
    [slicebugLoading, slicebugStatus],
  );

  async function refreshSlicebugStatus() {
    if (!window.cricutCompanion?.slicebug) {
      setSlicebugStatus({
        ok: false,
        executable: null,
        version: null,
        message: "Open this screen in the Electron desktop shell to call SliceBug.",
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
        message: error instanceof Error ? error.message : "Unknown SliceBug error.",
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
        message: "Open this screen in the Electron desktop shell to generate a SliceBug plan.",
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
        message: error instanceof Error ? error.message : "Unknown SliceBug plan error.",
        plan: null,
      });
    } finally {
      setSamplePlanLoading(false);
    }
  }

  async function prepareImportedPlan() {
    if (!importedSvg) {
      setImportMessage("Choose an SVG first, then KindCut can prepare it.");
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
        message: "Open this screen in the Electron desktop shell to prepare a Cricut handoff.",
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
        message: error instanceof Error ? error.message : "KindCut could not prepare that SVG yet.",
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
      setImportMessage("Choose a file that ends in .svg so KindCut can preview it.");
      return;
    }

    try {
      const svg = await file.text();
      const filePreflight = preflightSvg(svg);
      setImportedSvg({
        fileName: file.name,
        fileSize: formatFileSize(file.size),
        svg,
        sizeCopy: getSvgSizeCopy(getSvgSizeInfo(svg)),
        previewHtml: getSandboxedSvgPreview(svg),
        preflight: filePreflight,
      });
      setImportedPlan(null);
      setCutSession(null);
    } catch (error) {
      setImportedSvg(null);
      setImportMessage(error instanceof Error ? error.message : "KindCut could not open that file yet.");
    }
  }

  useEffect(() => {
    void refreshSlicebugStatus();
  }, []);

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
          <p className="eyebrow">Local craft helper</p>
          <h1>{APP_NAME}</h1>
          <p className="lede">
            Describe a card or simple Cricut Joy project, preview what will draw and cut, then save it on this
            computer for later.
          </p>
          <div className="welcome-actions">
            <button type="button" onClick={() => void generateSamplePlan()} disabled={samplePlanLoading}>
              {samplePlanLoading ? "Preparing preview..." : "Try the birthday card"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void refreshSlicebugStatus()}
              disabled={slicebugLoading}
            >
              {slicebugLoading ? "Checking..." : "Check setup again"}
            </button>
          </div>
        </div>

        <aside className={`setup-panel setup-panel--${statusCopy.tone}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <p className="panel-label">Cricut handoff</p>
          <h2>{statusCopy.title}</h2>
          <p>{statusCopy.message}</p>
          {statusCopy.details.length > 0 ? (
            <details>
              <summary>Advanced details</summary>
              <pre>{statusCopy.details.join("\n")}</pre>
            </details>
          ) : null}
        </aside>
      </section>

      <section className="workflow-strip" aria-label="KindCut workflow">
        <span>Describe it</span>
        <span>Preview layers</span>
        <span>Save locally</span>
        <span>Send when ready</span>
      </section>

      <section className="content-grid">
        <article className="panel starter-panel">
          <p className="panel-label">Starter project</p>
          <h2>{sampleProject.name}</h2>
          <p className="soft-copy">
            A small card recipe with pen details and one simple cut border, sized for a beginner-friendly Cricut Joy
            practice run.
          </p>
          <dl className="friendly-list">
            <dt>Machine</dt>
            <dd>{sampleProject.machine.displayName}</dd>
            <dt>Mat</dt>
            <dd>
              {sampleProject.mat.name}, {sampleProject.mat.widthIn} x {sampleProject.mat.heightIn} in
            </dd>
            <dt>Material</dt>
            <dd>{MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.name ?? sampleProject.material.name}</dd>
          </dl>
          <p className="choice-kicker">Adjust these choices before preparing a preview or starting a watched cut.</p>
          <MaterialMatChooser
            selectedMaterialId={selectedMaterialId}
            selectedMatPreset={selectedMatPreset}
            onMaterialChange={setSelectedMaterialId}
            onMatChange={setSelectedMatPreset}
          />
        </article>

        <article className="panel">
          <p className="panel-label">Project check</p>
          <h2>{validation.ok && preflight.ok ? "Looks ready to preview" : "Needs a quick look"}</h2>
          <p className={validation.ok && preflight.ok ? "ok" : "warn"}>
            {validation.ok && preflight.ok
              ? "The sample recipe has the basic size and layer checks it needs."
              : "One part of the sample recipe needs attention."}
          </p>
          {validation.messages.length > 0 ? (
            <ul className="plain-list">
              {validation.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="panel wide-panel import-panel">
          <div className="split-heading">
            <div>
              <p className="panel-label">Your design</p>
              <h2>Bring in an SVG design file</h2>
            </div>
            <label className="file-button">
              Choose SVG
              <input type="file" accept=".svg,image/svg+xml" onChange={(event) => void handleSvgFileChange(event)} />
            </label>
          </div>
          <p className="soft-copy">
            Pick an SVG design file from this computer. KindCut will show a gentle preview and a plain-English check before
            anything is prepared for a cutter.
          </p>

          {importMessage ? <p className="warn import-message">{importMessage}</p> : null}
          {importedSvg ? <ImportedSvgPreview importedSvg={importedSvg} /> : <EmptyImportState />}
          {importedSvg ? (
            <div className="prepare-row">
              <button type="button" onClick={() => void prepareImportedPlan()} disabled={importedPlanLoading}>
                {importedPlanLoading ? "Preparing..." : "Prepare Cricut handoff"}
              </button>
              <p>This makes a local plan only. Cutting starts later, after you press Start cut.</p>
            </div>
          ) : null}
          {importedPlan ? (
            <PlanAndCutMonitor
              result={importedPlan}
              planLabel={importedSvg?.fileName ?? "Imported design"}
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
              <p className="panel-label">Practice preview</p>
              <h2>Prepare the sample card</h2>
            </div>
            <button type="button" onClick={() => void generateSamplePlan()} disabled={samplePlanLoading}>
              {samplePlanLoading ? "Preparing..." : "Prepare preview"}
            </button>
          </div>
          <p className="soft-copy">
            This only prepares a preview file for the sample card with the material and mat you chose. It will not send
            anything to a Cricut machine.
          </p>

          {samplePlan ? <SamplePlanResult result={samplePlan} /> : <EmptyPreviewState />}
        </article>

        <article className="panel wide-panel quiet-panel">
          <p className="panel-label">For later</p>
          <h2>Recipe notes are tucked away</h2>
          <p className="soft-copy">
            Beginner screens stay simple, while the app still keeps the prompt and handoff notes available when someone
            needs to troubleshoot.
          </p>
          <div className="details-grid">
            <details>
              <summary>Design prompt details</summary>
              <pre>{prompt.system}</pre>
            </details>
            <details>
              <summary>Handoff command details</summary>
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

function EmptyImportState() {
  return (
    <div className="import-empty">
      <div className="paper-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>No SVG chosen yet. Start with a file you already have, then KindCut will show it here.</p>
    </div>
  );
}

function ImportedSvgPreview({ importedSvg }: { importedSvg: ImportedSvg }) {
  const friendlyMessages = getFriendlySvgMessages(importedSvg.preflight);
  const isReady = importedSvg.preflight.ok && importedSvg.preflight.warnings.length === 0;

  return (
    <div className="import-preview-grid">
      <div className="svg-preview-frame">
        <iframe title={`Preview of ${importedSvg.fileName}`} sandbox="" srcDoc={importedSvg.previewHtml} />
      </div>

      <div className="import-summary">
        <p className="panel-label">Chosen file</p>
        <h3>{importedSvg.fileName}</h3>
        <dl className="friendly-list compact-list">
          <dt>File</dt>
          <dd>{importedSvg.fileSize}</dd>
          <dt>Artwork</dt>
          <dd>{importedSvg.sizeCopy}</dd>
        </dl>

        <div className={`svg-check svg-check--${isReady ? "ready" : "warning"}`}>
          <h3>{isReady ? "This looks easy to start with" : "A few things may need a look"}</h3>
          {friendlyMessages.length > 0 ? (
            <ul className="plain-list">
              {friendlyMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : (
            <p>KindCut can read this SVG and show it in the preview.</p>
          )}
        </div>

        <details>
          <summary>SVG check details</summary>
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
          <summary>Raw SVG</summary>
          <pre>{importedSvg.svg}</pre>
        </details>
      </div>
    </div>
  );
}

function MaterialMatChooser({
  selectedMaterialId,
  selectedMatPreset,
  onMaterialChange,
  onMatChange,
}: {
  selectedMaterialId: number;
  selectedMatPreset: string;
  onMaterialChange: (materialId: number) => void;
  onMatChange: (matPreset: string) => void;
}) {
  return (
    <div className="choice-panel" aria-label="Material and mat choices">
      <label>
        Material
        <select value={selectedMaterialId} onChange={(event) => onMaterialChange(Number(event.target.value))}>
          {MATERIAL_OPTIONS.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mat
        <select value={selectedMatPreset} onChange={(event) => onMatChange(event.target.value)}>
          {MAT_PRESETS.map((mat) => (
            <option key={mat.id} value={mat.id}>
              {mat.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        {MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.beginnerCopy}{" "}
        {MAT_PRESETS.find((mat) => mat.id === selectedMatPreset)?.beginnerCopy}
      </p>
    </div>
  );
}

function PlanAndCutMonitor({
  result,
  planLabel,
  cutSession,
  cutBusy,
  onStart,
  onContinue,
  onStop,
}: {
  result: SlicebugPlanResult;
  planLabel: string;
  cutSession: CutSessionSnapshot | null;
  cutBusy: boolean;
  onStart: () => void;
  onContinue: () => void;
  onStop: () => void;
}) {
  const copy = getFriendlyPlanResultCopy(result);
  const canStart = result.ok && result.plan && !cutSession;

  return (
    <div className={`sample-result sample-result--${copy.tone}`}>
      <p className="panel-label">Imported SVG handoff</p>
      <h3>{result.ok ? "Ready to send when you are" : copy.title}</h3>
      <p>
        Current plan: <strong>{planLabel}</strong>. {copy.message}
      </p>
      {result.plan ? (
        <dl className="friendly-list compact-list">
          <dt>Layers</dt>
          <dd>{result.plan.pathCount}</dd>
          <dt>Tools</dt>
          <dd>{result.plan.tools.map(formatToolName).join(", ") || "No tools listed"}</dd>
        </dl>
      ) : null}

      {canStart ? (
        <div className="cut-start">
          <button type="button" onClick={onStart} disabled={cutBusy}>
            {cutBusy ? "Starting..." : "Start cut"}
          </button>
          <p>Only press this when the Cricut is nearby, plugged in, and you are ready to watch it.</p>
        </div>
      ) : null}

      {cutSession ? (
        <div className={`cut-monitor cut-monitor--${cutSession.action.tone}`} aria-live="polite">
          <p className="panel-label">Watched Cricut step</p>
          <h3>{cutSession.action.title}</h3>
          <p>{cutSession.action.message}</p>
          <ol className="cut-progress" aria-label="Cutting progress guide">
            <li className="cut-progress__done">Prepare plan</li>
            <li className={cutSession.action.kind === "load-tools" ? "cut-progress__active" : ""}>Load tool</li>
            <li className={cutSession.action.kind === "load-mat" ? "cut-progress__active" : ""}>Load mat</li>
            <li className={cutSession.action.kind === "running" ? "cut-progress__active" : ""}>Cut/draw</li>
            <li className={cutSession.action.kind === "finished" ? "cut-progress__active" : ""}>Finish</li>
          </ol>
          <div className="cut-actions">
            {cutSession.action.requiresContinue ? (
              <button type="button" onClick={onContinue} disabled={cutBusy}>
                Continue
              </button>
            ) : null}
            {cutSession.action.canStop ? (
              <button className="secondary-button" type="button" onClick={onStop} disabled={cutBusy}>
                Stop
              </button>
            ) : null}
          </div>
          <details>
            <summary>Cut details</summary>
            <pre>
              {[
                `${cutSession.command} ${cutSession.args.join(" ")}`,
                cutSession.transcript.trim() || "No SliceBug messages yet.",
              ].join("\n\n")}
            </pre>
          </details>
        </div>
      ) : null}

      {copy.details.length > 0 ? (
        <details>
          <summary>Plan details</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}

function EmptyPreviewState() {
  return (
    <div className="empty-preview">
      <div className="mat-preview" aria-hidden="true">
        <div className="card-preview">
          <span className="cut-line" />
          <span className="pen-line pen-line--short" />
          <span className="pen-line" />
        </div>
      </div>
      <p>Click “Try the birthday card” above to see a friendly layer summary here.</p>
    </div>
  );
}

function SamplePlanResult({ result }: { result: SlicebugPlanResult }) {
  const copy = getFriendlyPlanResultCopy(result);

  return (
    <div className={`sample-result sample-result--${copy.tone}`}>
      <h3>{copy.title}</h3>
      <p>{copy.message}</p>
      {result.plan ? (
        <dl className="friendly-list compact-list">
          <dt>Layers</dt>
          <dd>{result.plan.pathCount}</dd>
          <dt>Tools</dt>
          <dd>{result.plan.tools.map(formatToolName).join(", ") || "No tools listed"}</dd>
        </dl>
      ) : null}
      {copy.details.length > 0 ? (
        <details>
          <summary>Advanced details</summary>
          <pre>{copy.details.join("\n\n")}</pre>
        </details>
      ) : null}
    </div>
  );
}
