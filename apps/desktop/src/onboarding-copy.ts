import { APP_NAME, type Language, createTranslator } from "./i18n";

export { APP_NAME };

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
  language: Language = "nl",
): FriendlyStatusCopy {
  const { t } = createTranslator(language);

  if (loading) {
    return {
      tone: "checking",
      title: t("status.loadingTitle"),
      message: t("status.loadingMessage"),
      details: [],
    };
  }

  if (!status) {
    return {
      tone: "checking",
      title: t("status.initialTitle"),
      message: t("status.initialMessage"),
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
      title: t("status.readyTitle"),
      message: t("status.readyMessage"),
      details,
    };
  }

  return {
    tone: "warning",
    title: t("status.warningTitle"),
    message: t("status.warningMessage"),
    details,
  };
}

export function getFriendlyPlanResultCopy(result: PlanResultLike, language: Language = "nl"): FriendlyStatusCopy {
  const { t } = createTranslator(language);
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
      title: t("plan.readyTitle"),
      message:
        language === "nl"
          ? `KindCut heeft ${result.plan.pathCount} ${result.plan.pathCount === 1 ? "laag" : "lagen"} voorbereid voor een kaart van ${formatSize(
              result.plan.material,
            )} op een mat van ${formatSize(result.plan.mat)}.`
          : `KindCut prepared ${result.plan.pathCount} layer${result.plan.pathCount === 1 ? "" : "s"} for a ${formatSize(
              result.plan.material,
            )} card on a ${formatSize(result.plan.mat)} mat.`,
      details,
    };
  }

  return {
    tone: "warning",
    title: t("plan.warningTitle"),
    message: t("plan.warningMessage"),
    details,
  };
}

export function formatToolName(tool: string, language: Language = "nl"): string {
  const { t } = createTranslator(language);
  const knownTools: Record<string, string> = {
    fine_point_blade: t("tool.fine_point_blade"),
    pen: t("tool.pen"),
  };

  return knownTools[tool] ?? titleCase(tool.replaceAll("_", " "));
}

export function formatSize(size: { width: number; height: number }): string {
  return `${size.width} x ${size.height} in`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
