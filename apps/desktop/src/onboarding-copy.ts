export const APP_NAME = "KindCut";

export type SlicebugStatusLike = {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
};

export type PlanSummaryLike = {
  mat: { width: number; height: number };
  material: { width: number; height: number; type: number };
  pathCount: number;
  tools: string[];
};

export type PlanResultLike = {
  ok: boolean;
  executable: string;
  inputSvgPath: string;
  outputPlanPath: string;
  stdout: string;
  stderr: string;
  message: string;
  plan: PlanSummaryLike | null;
};

export type FriendlyStatusCopy = {
  tone: "checking" | "ready" | "warning";
  title: string;
  message: string;
  details: string[];
};

export function getFriendlySlicebugStatusCopy(
  status: SlicebugStatusLike | null,
  loading: boolean,
): FriendlyStatusCopy {
  if (loading) {
    return {
      tone: "checking",
      title: "Checking your cutter helper",
      message: "KindCut is making sure it can prepare projects for your Cricut later.",
      details: [],
    };
  }

  if (!status) {
    return {
      tone: "checking",
      title: "Getting your craft table ready",
      message: "KindCut will check the helper it needs before you start.",
      details: [],
    };
  }

  const details = [
    `SliceBug message: ${status.message}`,
    status.version ? `SliceBug version: ${status.version}` : null,
    status.executable ? `Executable: ${status.executable}` : null,
  ].filter((detail): detail is string => Boolean(detail));

  if (status.ok) {
    return {
      tone: "ready",
      title: "Ready for Cricut projects",
      message: "Everything KindCut needs is available. You can start with a simple card and save your work locally.",
      details,
    };
  }

  return {
    tone: "warning",
    title: "One helper needs attention",
    message:
      "KindCut can still show the sample project, but it cannot prepare a Cricut handoff until the helper app is set up.",
    details,
  };
}

export function getFriendlyPlanResultCopy(result: PlanResultLike): FriendlyStatusCopy {
  const details = [
    `SliceBug message: ${result.message}`,
    result.executable ? `Executable: ${result.executable}` : null,
    result.inputSvgPath ? `Input SVG path: ${result.inputSvgPath}` : null,
    result.outputPlanPath ? `JSON plan path: ${result.outputPlanPath}` : null,
    result.stdout ? `stdout:\n${result.stdout}` : null,
    result.stderr ? `stderr:\n${result.stderr}` : null,
  ].filter((detail): detail is string => Boolean(detail));

  if (result.ok && result.plan) {
    return {
      tone: "ready",
      title: "Practice preview is ready",
      message: `KindCut prepared ${result.plan.pathCount} layer${result.plan.pathCount === 1 ? "" : "s"} for a ${formatSize(
        result.plan.material,
      )} card on a ${formatSize(result.plan.mat)} mat.`,
      details,
    };
  }

  return {
    tone: "warning",
    title: "The practice preview could not be prepared",
    message: "The sample project is still here. The Cricut handoff helper needs attention before KindCut can preview it.",
    details,
  };
}

export function formatToolName(tool: string): string {
  const knownTools: Record<string, string> = {
    fine_point_blade: "Fine-point blade",
    pen: "Pen",
  };

  return knownTools[tool] ?? titleCase(tool.replaceAll("_", " "));
}

export function formatSize(size: { width: number; height: number }): string {
  return `${size.width} x ${size.height} in`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
