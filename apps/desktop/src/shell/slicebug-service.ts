import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const JOEL_LOCAL_SLICEBUG = "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug";

export interface SlicebugInvocation {
  args: ["--version"];
}

export interface SlicebugPlanInvocation {
  args: string[];
}

export interface RawSlicebugResult {
  executable: string;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface RawSlicebugPlanResult extends RawSlicebugResult {
  inputSvgPath: string;
  outputPlanPath: string;
  planJson?: string;
}

export interface SlicebugStatus {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
}

export interface SamplePlanRequest {
  inputSvgPath: string;
  outputPlanPath: string;
  svg: string;
  invocation: SlicebugPlanInvocation;
}

export interface SlicebugPlanSummary {
  mat: { width: number; height: number };
  material: { width: number; height: number; type: number };
  pathCount: number;
  tools: string[];
}

export interface SlicebugPlanResult {
  ok: boolean;
  executable: string;
  inputSvgPath: string;
  outputPlanPath: string;
  stdout: string;
  stderr: string;
  message: string;
  plan: SlicebugPlanSummary | null;
}

export function findSlicebugExecutableCandidates(): string[] {
  return [JOEL_LOCAL_SLICEBUG, "slicebug"];
}

export function buildSlicebugInvocation(): SlicebugInvocation {
  return { args: ["--version"] };
}

export function buildSamplePlanRequest(workspaceDir: string): SamplePlanRequest {
  const inputSvgPath = path.join(workspaceDir, "sample-card.svg");
  const outputPlanPath = path.join(workspaceDir, "sample-card.json");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="240" viewBox="0 0 288 240" preserveAspectRatio="none">
  <path d="M 24 24 L 120 24 L 120 120 L 24 120 Z" stroke="#ff0000" fill="none" />
  <path d="M 48 60 L 96 60" stroke="#000000" fill="none" />
</svg>
`;

  return {
    inputSvgPath,
    outputPlanPath,
    svg,
    invocation: {
      args: [
        "plan",
        inputSvgPath,
        outputPlanPath,
        "--material",
        "218",
        "--mat-preset",
        "joy-standard",
        "--map",
        "000000:pen",
        "--map",
        "ff0000:fine_point_blade",
      ],
    },
  };
}

export function summarizeSlicebugResult(result: RawSlicebugResult): SlicebugStatus {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (!result.error && stdout.length > 0) {
    const version = stdout.split(/\s+/)[0] ?? stdout;
    return {
      ok: true,
      executable: result.executable,
      version,
      message: `SliceBug ${version} is available.`,
    };
  }

  const messageParts = [result.error, stderr || stdout].filter(Boolean);
  return {
    ok: false,
    executable: result.executable,
    version: null,
    message: messageParts.join("\n") || "SliceBug did not return a usable response.",
  };
}

function parsePlanSummary(planJson: string): SlicebugPlanSummary | null {
  const plan = JSON.parse(planJson) as {
    mat?: { width?: unknown; height?: unknown };
    material?: { width?: unknown; height?: unknown; type?: unknown };
    paths?: Array<{ tool?: unknown }>;
  };

  if (
    typeof plan.mat?.width !== "number" ||
    typeof plan.mat.height !== "number" ||
    typeof plan.material?.width !== "number" ||
    typeof plan.material.height !== "number" ||
    typeof plan.material.type !== "number" ||
    !Array.isArray(plan.paths)
  ) {
    return null;
  }

  const tools = Array.from(
    new Set(plan.paths.map((entry) => entry.tool).filter((tool): tool is string => typeof tool === "string")),
  );

  return {
    mat: { width: plan.mat.width, height: plan.mat.height },
    material: { width: plan.material.width, height: plan.material.height, type: plan.material.type },
    pathCount: plan.paths.length,
    tools,
  };
}

export function summarizePlanResult(result: RawSlicebugPlanResult): SlicebugPlanResult {
  const stdout = result.stdout;
  const stderr = result.stderr;

  if (!result.error && result.planJson) {
    const plan = parsePlanSummary(result.planJson);
    if (plan) {
      return {
        ok: true,
        executable: result.executable,
        inputSvgPath: result.inputSvgPath,
        outputPlanPath: result.outputPlanPath,
        stdout,
        stderr,
        message: `Generated SliceBug plan with ${plan.pathCount} paths for ${plan.material.width}×${plan.material.height} in material on a ${plan.mat.width}×${plan.mat.height} in mat.`,
        plan,
      };
    }
  }

  const messageParts = [result.error, stderr.trim() || stdout.trim()].filter(Boolean);
  return {
    ok: false,
    executable: result.executable,
    inputSvgPath: result.inputSvgPath,
    outputPlanPath: result.outputPlanPath,
    stdout,
    stderr,
    message: messageParts.join("\n") || "SliceBug plan did not return a usable response.",
    plan: null,
  };
}

async function executableExists(candidate: string): Promise<boolean> {
  if (candidate === "slicebug") {
    return true;
  }

  try {
    await fs.promises.access(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findAvailableSlicebugExecutable(): Promise<string | null> {
  for (const executable of findSlicebugExecutableCandidates()) {
    if (await executableExists(executable)) {
      return executable;
    }
  }
  return null;
}

async function runVersion(executable: string): Promise<RawSlicebugResult> {
  const invocation = buildSlicebugInvocation();

  try {
    const { stdout, stderr } = await execFileAsync(executable, invocation.args, {
      timeout: 10_000,
      windowsHide: true,
    });
    return { executable, stdout, stderr };
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string; code?: unknown };
    return {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
    };
  }
}

export async function getSlicebugStatus(): Promise<SlicebugStatus> {
  let lastResult: RawSlicebugResult | null = null;

  for (const executable of findSlicebugExecutableCandidates()) {
    if (!(await executableExists(executable))) {
      continue;
    }

    const result = await runVersion(executable);
    const status = summarizeSlicebugResult(result);
    if (status.ok) {
      return status;
    }
    lastResult = result;
  }

  if (lastResult) {
    return summarizeSlicebugResult(lastResult);
  }

  return {
    ok: false,
    executable: null,
    version: null,
    message: `SliceBug was not found. Expected ${JOEL_LOCAL_SLICEBUG} or slicebug on PATH.`,
  };
}

async function runSamplePlan(executable: string): Promise<RawSlicebugPlanResult> {
  const workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cricut-companion-plan-"));
  const request = buildSamplePlanRequest(workspaceDir);
  await fs.promises.writeFile(request.inputSvgPath, request.svg, "utf8");

  try {
    const { stdout, stderr } = await execFileAsync(executable, request.invocation.args, {
      timeout: 30_000,
      windowsHide: true,
    });
    const planJson = await fs.promises.readFile(request.outputPlanPath, "utf8");
    return {
      executable,
      stdout,
      stderr,
      inputSvgPath: request.inputSvgPath,
      outputPlanPath: request.outputPlanPath,
      planJson,
    };
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string };
    return {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
      inputSvgPath: request.inputSvgPath,
      outputPlanPath: request.outputPlanPath,
    };
  }
}

export async function generateSampleSlicebugPlan(): Promise<SlicebugPlanResult> {
  const executable = await findAvailableSlicebugExecutable();
  if (!executable) {
    return {
      ok: false,
      executable: JOEL_LOCAL_SLICEBUG,
      inputSvgPath: "",
      outputPlanPath: "",
      stdout: "",
      stderr: "",
      message: `SliceBug was not found. Expected ${JOEL_LOCAL_SLICEBUG} or slicebug on PATH.`,
      plan: null,
    };
  }

  return summarizePlanResult(await runSamplePlan(executable));
}
