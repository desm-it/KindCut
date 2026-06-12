import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureDiagnosticsLog,
  getDiagnosticsLogFilePath,
  getDiagnosticsLogsDir,
  logDiagnostics,
} from "./diagnostics-log";

const tempDirs: string[] = [];

function makeTempLogsDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kindcut-diagnostics-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("diagnostics log", () => {
  it("mirrors production diagnostics to a local json-lines file", () => {
    const logsDir = makeTempLogsDir();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    configureDiagnosticsLog(logsDir);
    logDiagnostics("debug", "[SliceBug] Running command", { executable: "slicebug", args: ["--version"] });

    expect(getDiagnosticsLogsDir()).toBe(logsDir);
    expect(getDiagnosticsLogFilePath()).toBe(path.join(logsDir, "kindcut.log"));
    expect(consoleLog).toHaveBeenCalledWith("[SliceBug] Running command", {
      executable: "slicebug",
      args: ["--version"],
    });

    const entries = fs.readFileSync(path.join(logsDir, "kindcut.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { level: string; message: string; details?: unknown });

    expect(entries.at(-1)).toMatchObject({
      level: "debug",
      message: "[SliceBug] Running command",
      details: { executable: "slicebug", args: ["--version"] },
    });
  });

  it("records thrown errors with stack details", () => {
    const logsDir = makeTempLogsDir();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    configureDiagnosticsLog(logsDir);
    logDiagnostics("error", "[SliceBug] Cut session process error", new Error("Bluetooth failed"));

    const entries = fs.readFileSync(path.join(logsDir, "kindcut.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { details?: { name?: string; message?: string; stack?: string } });

    expect(entries.at(-1)?.details).toMatchObject({
      name: "Error",
      message: "Bluetooth failed",
    });
    expect(entries.at(-1)?.details?.stack).toContain("Bluetooth failed");
  });
});
