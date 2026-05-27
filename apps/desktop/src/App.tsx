import { useEffect, useState } from "react";
import { buildBeginnerProject, joyStandardMat, validateProject } from "@cricut-companion/craft-core";
import { createDesignPrompt } from "@cricut-companion/ai-designer";
import { buildPlanCommand } from "@cricut-companion/slicebug-bridge";
import { preflightSvg } from "@cricut-companion/svg-preflight";

type SlicebugStatus = {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
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

  useEffect(() => {
    void refreshSlicebugStatus();
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Local-first Cricut companion</p>
        <h1>Make Cricut projects without learning Cricut jargon.</h1>
        <p>
          Start with a plain-language idea, generate a craft-ready SVG, preview draw/cut layers, save it locally,
          then send it through SliceBug when ready.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Starter recipe</h2>
          <dl>
            <dt>Project</dt>
            <dd>{sampleProject.name}</dd>
            <dt>Machine</dt>
            <dd>{sampleProject.machine.displayName}</dd>
            <dt>Mat</dt>
            <dd>{sampleProject.mat.name} — {sampleProject.mat.widthIn}×{sampleProject.mat.heightIn} in</dd>
            <dt>Material</dt>
            <dd>{sampleProject.material.name}</dd>
          </dl>
        </article>

        <article className="card">
          <h2>AI craft prompt</h2>
          <pre>{prompt.system.slice(0, 520)}…</pre>
        </article>

        <article className="card">
          <h2>Validation</h2>
          <p className={validation.ok ? "ok" : "warn"}>{validation.ok ? "Ready for prototype" : "Needs attention"}</p>
          <ul>{validation.messages.map((message) => <li key={message}>{message}</li>)}</ul>
        </article>

        <article className="card">
          <h2>SliceBug desktop bridge</h2>
          <p className={slicebugStatus?.ok ? "ok" : "warn"}>
            {slicebugLoading ? "Checking SliceBug…" : slicebugStatus?.message ?? "SliceBug has not been checked yet."}
          </p>
          {slicebugStatus?.executable ? <p className="muted">Executable: {slicebugStatus.executable}</p> : null}
          <button type="button" onClick={() => void refreshSlicebugStatus()} disabled={slicebugLoading}>
            {slicebugLoading ? "Checking…" : "Call slicebug --version"}
          </button>
        </article>

        <article className="card">
          <h2>SliceBug command preview</h2>
          <pre>{planCommand.command} {planCommand.args.join(" ")}</pre>
          <p>{preflight.ok ? "SVG preflight passed." : preflight.issues.join(", ")}</p>
        </article>
      </section>
    </main>
  );
}
