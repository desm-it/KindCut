import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const JOEL_LOCAL_SLICEBUG = "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug";

export interface SlicebugInvocation {
  args: ["--version"];
}

export interface RawSlicebugResult {
  executable: string;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface SlicebugStatus {
  ok: boolean;
  executable: string | null;
  version: string | null;
  message: string;
}

export function findSlicebugExecutableCandidates(): string[] {
  return [JOEL_LOCAL_SLICEBUG, "slicebug"];
}

export function buildSlicebugInvocation(): SlicebugInvocation {
  return { args: ["--version"] };
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
