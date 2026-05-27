import { useEffect, useMemo, useState } from "react";
import { buildBeginnerProject, joyStandardMat, validateProject } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "@cricut-companion/ai-designer";
import { buildPlanCommand } from "@cricut-companion/slicebug-bridge";
import { preflightSvg } from "@cricut-companion/svg-preflight";
import {
  APP_NAME,
  formatToolName,
  getFriendlyPlanResultCopy,
  getFriendlySlicebugStatusCopy,
} from "./onboarding-copy";

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
      setSamplePlan(await window.cricutCompanion.slicebug.generateSamplePlan());
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

  useEffect(() => {
    void refreshSlicebugStatus();
  }, []);

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
            <dd>{sampleProject.material.name}</dd>
          </dl>
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
            This only prepares a preview file for the sample card. It will not send anything to a Cricut machine.
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
      <p>Start with the birthday card to see a friendly layer summary here.</p>
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
