import fs from "node:fs";
import path from "node:path";

let logsDir: string | null = null;
let logFilePath: string | null = null;

export function configureDiagnosticsLog(directory: string): void {
  logsDir = directory;
  logFilePath = path.join(directory, "kindcut.log");
  try {
    fs.mkdirSync(directory, { recursive: true });
    appendDiagnosticsLine("info", "Diagnostics log configured", { logFilePath });
  } catch (error) {
    console.error("[KindCut diagnostics] Failed to configure diagnostics log", error);
  }
}

export function getDiagnosticsLogsDir(): string | null {
  return logsDir;
}

export function getDiagnosticsLogFilePath(): string | null {
  return logFilePath;
}

export function logDiagnostics(level: "debug" | "info" | "warn" | "error", message: string, details?: unknown): void {
  if (level === "error") {
    console.error(message, details);
  } else if (level === "warn") {
    console.warn(message, details);
  } else {
    console.log(message, details);
  }

  appendDiagnosticsLine(level, message, details);
}

function appendDiagnosticsLine(level: "debug" | "info" | "warn" | "error", message: string, details?: unknown): void {
  if (!logFilePath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(
      logFilePath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        level,
        message,
        details: normalizeLogDetails(details),
      })}\n`,
      "utf8",
    );
  } catch (error) {
    console.error("[KindCut diagnostics] Failed to write diagnostics log", error);
  }
}

function normalizeLogDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }

  try {
    JSON.stringify(details);
    return details;
  } catch {
    return String(details);
  }
}
