import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const JOEL_LOCAL_SLICEBUG = "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug";
const BUNDLED_SLICEBUG_RESOURCE_DIR = "slicebug";

export interface SlicebugCandidateOptions {
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  appRoot?: string;
  repoRoot?: string;
  envExecutable?: string;
}

export interface SlicebugInvocation {
  args: ["--version"];
}

export interface SlicebugBootstrapInvocation {
  args: string[];
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

export interface SlicebugBootstrapInput {
  designSpacePath?: string;
  designSpaceProfilePath?: string;
}

export interface SlicebugBootstrapResult extends RawSlicebugResult {
  ok: boolean;
  message: string;
}

export interface SlicebugSetupStatus {
  configRoot: string;
  keysPath: string;
  profilesPath: string;
  devicePluginPath: string;
  usvgPath: string;
  bundledUsvgPath: string | null;
  hasKeys: boolean;
  hasProfiles: boolean;
  hasDevicePlugin: boolean;
  hasUsvg: boolean;
  bootstrapped: boolean;
}

export interface SamplePlanRequest {
  inputSvgPath: string;
  outputPlanPath: string;
  svg: string;
  invocation: SlicebugPlanInvocation;
}

export interface SvgPlanInput {
  svg: string;
  fileName?: string;
  materialId: number;
  matPreset: string;
  colorMap?: Record<string, string>;
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

export type CutSessionStatus = "idle" | "running" | "waiting" | "finished" | "error" | "stopped" | "blocked";

export interface CutActionState {
  kind: "idle" | "load-tools" | "load-mat" | "press-go" | "replace-tool" | "unload" | "finished" | "running" | "error";
  title: string;
  message: string;
  requiresContinue: boolean;
  canStop: boolean;
  tone: "neutral" | "waiting" | "running" | "success" | "error";
}

export interface CutSessionSnapshot {
  id: string;
  status: CutSessionStatus;
  action: CutActionState;
  transcript: string;
  command: string;
  args: string[];
  planPath: string;
}

interface SlicebugProcess {
  stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  stdin: { write(text: string): unknown; end?(): unknown };
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): unknown;
  killed?: boolean;
}

export interface CutSessionOptions {
  id: string;
  executable: string;
  planPath: string;
  smokeMode: boolean;
  spawnProcess?: (command: string, args: string[], env?: NodeJS.ProcessEnv) => SlicebugProcess;
}

function platformExecutableName(platform: NodeJS.Platform, baseName: string): string {
  return platform === "win32" ? `${baseName}.exe` : baseName;
}

function uniqueCandidates(candidates: Array<string | null | undefined>): string[] {
  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))));
}

export function bundledSlicebugExecutablePath(resourcesPath: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(resourcesPath, BUNDLED_SLICEBUG_RESOURCE_DIR, platformExecutableName(platform, "slicebug"));
}

export function bundledUsvgExecutablePath(resourcesPath: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(resourcesPath, BUNDLED_SLICEBUG_RESOURCE_DIR, "plugins", "usvg", platformExecutableName(platform, "usvg"));
}

export function desktopResourceSlicebugExecutablePath(appRoot: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(appRoot, "resources", BUNDLED_SLICEBUG_RESOURCE_DIR, platformExecutableName(platform, "slicebug"));
}

export function desktopResourceUsvgExecutablePath(appRoot: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(appRoot, "resources", BUNDLED_SLICEBUG_RESOURCE_DIR, "plugins", "usvg", platformExecutableName(platform, "usvg"));
}

export function vendoredSlicebugVenvExecutablePath(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? path.join(repoRoot, "vendor", "slicebug", ".venv", "Scripts", "slicebug.exe")
    : path.join(repoRoot, "vendor", "slicebug", ".venv", "bin", "slicebug");
}

export function vendoredSlicebugFrozenExecutablePath(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(repoRoot, "apps", "desktop", "resources", BUNDLED_SLICEBUG_RESOURCE_DIR, platformExecutableName(platform, "slicebug"));
}

export function vendoredUsvgFrozenExecutablePath(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(repoRoot, "apps", "desktop", "resources", BUNDLED_SLICEBUG_RESOURCE_DIR, "plugins", "usvg", platformExecutableName(platform, "usvg"));
}

export function findSlicebugExecutableCandidates(options: SlicebugCandidateOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const appRoot = options.appRoot ?? process.cwd();
  const repoRoot = options.repoRoot ?? path.resolve(appRoot, "..", "..");
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const envExecutable = options.envExecutable ?? process.env.KINDCUT_SLICEBUG_EXECUTABLE;

  return uniqueCandidates([
    envExecutable,
    resourcesPath ? bundledSlicebugExecutablePath(resourcesPath, platform) : null,
    desktopResourceSlicebugExecutablePath(appRoot, platform),
    vendoredSlicebugFrozenExecutablePath(repoRoot, platform),
    vendoredSlicebugVenvExecutablePath(repoRoot, platform),
    JOEL_LOCAL_SLICEBUG,
    "slicebug",
  ]);
}

export function findBundledUsvgCandidates(options: SlicebugCandidateOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const appRoot = options.appRoot ?? process.cwd();
  const repoRoot = options.repoRoot ?? path.resolve(appRoot, "..", "..");
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;

  return uniqueCandidates([
    resourcesPath ? bundledUsvgExecutablePath(resourcesPath, platform) : null,
    desktopResourceUsvgExecutablePath(appRoot, platform),
    vendoredUsvgFrozenExecutablePath(repoRoot, platform),
  ]);
}

function firstExistingFile(candidates: string[]): string | null {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function buildSlicebugSubprocessEnv(options: SlicebugCandidateOptions = {}): NodeJS.ProcessEnv {
  const bundledUsvg = firstExistingFile(findBundledUsvgCandidates(options));
  if (!bundledUsvg) {
    return process.env;
  }

  const usvgDir = path.dirname(bundledUsvg);
  const currentPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: currentPath ? `${usvgDir}${path.delimiter}${currentPath}` : usvgDir,
  };
}

export function buildSlicebugInvocation(): SlicebugInvocation {
  return { args: ["--version"] };
}

export function defaultDesignSpacePaths(platform: NodeJS.Platform = process.platform, homeDir = os.homedir()): Required<SlicebugBootstrapInput> {
  if (platform === "win32") {
    return {
      designSpacePath: path.join(homeDir, "AppData", "Local", "Programs", "Cricut Design Space"),
      designSpaceProfilePath: path.join(homeDir, ".cricut-design-space"),
    };
  }

  return {
    designSpacePath: "/Applications/Cricut Design Space.app/Contents/Resources",
    designSpaceProfilePath: path.join(homeDir, ".cricut-design-space"),
  };
}

export function buildBootstrapInvocation(input: SlicebugBootstrapInput = {}): SlicebugBootstrapInvocation {
  const defaults = defaultDesignSpacePaths();
  return {
    args: [
      "bootstrap",
      "--design-space-path",
      input.designSpacePath ?? defaults.designSpacePath,
      "--design-space-profile-path",
      input.designSpaceProfilePath ?? defaults.designSpaceProfilePath,
    ],
  };
}

export function slicebugConfigRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".slicebug");
}

export function getSlicebugSetupStatus(
  homeDir = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  bundledUsvgPath = firstExistingFile(findBundledUsvgCandidates({ platform })),
): SlicebugSetupStatus {
  const configRoot = slicebugConfigRoot(homeDir);
  const executableSuffix = platform === "win32" ? ".exe" : "";
  const keysPath = path.join(configRoot, "keys.json");
  const profilesPath = path.join(configRoot, "profiles.json");
  const devicePluginPath = path.join(configRoot, "plugins", "device-common", `CricutDevice${executableSuffix}`);
  const configUsvgPath = path.join(configRoot, "plugins", "usvg", `usvg${executableSuffix}`);
  const hasKeys = fs.existsSync(keysPath);
  const hasProfiles = fs.existsSync(profilesPath);
  const hasDevicePlugin = fs.existsSync(devicePluginPath);
  const hasConfigUsvg = fs.existsSync(configUsvgPath);
  const hasBundledUsvg = Boolean(bundledUsvgPath && fs.existsSync(bundledUsvgPath));
  const hasUsvg = hasConfigUsvg || hasBundledUsvg;
  return {
    configRoot,
    keysPath,
    profilesPath,
    devicePluginPath,
    usvgPath: hasConfigUsvg ? configUsvgPath : bundledUsvgPath ?? configUsvgPath,
    bundledUsvgPath,
    hasKeys,
    hasProfiles,
    hasDevicePlugin,
    hasUsvg,
    bootstrapped: hasKeys && hasProfiles && hasDevicePlugin && hasUsvg,
  };
}

export function isBundledUsvgBootstrapFallback(
  result: Pick<RawSlicebugResult, "error" | "stderr" | "stdout">,
  setup: Pick<SlicebugSetupStatus, "bootstrapped" | "bundledUsvgPath">,
): boolean {
  if (!result.error || !setup.bootstrapped || !setup.bundledUsvgPath) {
    return false;
  }

  const output = [result.error, result.stderr, result.stdout].join("\n");
  return /\b(usvg|resvg)\b|linebender|download/i.test(output);
}

export function buildSamplePlanRequest(
  workspaceDir: string,
  choices: { materialId?: number; matPreset?: string } = {},
): SamplePlanRequest {
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
        String(choices.materialId ?? 218),
        "--mat-preset",
        choices.matPreset ?? "joy-standard",
        "--map",
        "000000:pen",
        "--map",
        "ff0000:fine_point_blade",
      ],
    },
  };
}

export function buildSvgPlanRequest(workspaceDir: string, input: SvgPlanInput): SamplePlanRequest {
  const baseName = sanitizeSvgBaseName(input.fileName ?? "imported-design.svg");
  const inputSvgPath = path.join(workspaceDir, `${baseName}.svg`);
  const outputPlanPath = path.join(workspaceDir, `${baseName}.json`);
  const colorMap = input.colorMap ?? {
    "000000": "pen",
    ff0000: "fine_point_blade",
  };
  const args = [
    "plan",
    inputSvgPath,
    outputPlanPath,
    "--material",
    String(input.materialId),
    "--mat-preset",
    input.matPreset,
  ];

  for (const [color, tool] of Object.entries(colorMap)) {
    args.push("--map", `${color.replace(/^#/, "")}:${tool}`);
  }

  return {
    inputSvgPath,
    outputPlanPath,
    svg: input.svg,
    invocation: { args },
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
      env: buildSlicebugSubprocessEnv(),
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

async function runBootstrap(executable: string, input: SlicebugBootstrapInput = {}): Promise<RawSlicebugResult> {
  const invocation = buildBootstrapInvocation(input);

  try {
    const { stdout, stderr } = await execFileAsync(executable, invocation.args, {
      timeout: 120_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
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

export async function bootstrapSlicebug(input: SlicebugBootstrapInput = {}): Promise<SlicebugBootstrapResult> {
  const executable = await findAvailableSlicebugExecutable();
  if (!executable) {
    return {
      ok: false,
      executable: JOEL_LOCAL_SLICEBUG,
      stdout: "",
      stderr: "",
      error: "SliceBug was not found.",
      message: `SliceBug was not found. Expected a bundled helper, ${JOEL_LOCAL_SLICEBUG}, or slicebug on PATH.`,
    };
  }

  const result = await runBootstrap(executable, input);
  const setup = getSlicebugSetupStatus();
  const messageParts = [result.error, result.stderr.trim() || result.stdout.trim()].filter(Boolean);
  const bundledUsvgFallback = isBundledUsvgBootstrapFallback(result, setup);
  const ok = setup.bootstrapped && (!result.error || bundledUsvgFallback);
  return {
    ...result,
    ok,
    message:
      ok
        ? bundledUsvgFallback
          ? "SliceBug setup completed using KindCut's bundled usvg."
          : "SliceBug setup completed."
        : messageParts.join("\n") || "SliceBug setup did not complete.",
  };
}

async function runSamplePlan(
  executable: string,
  choices: { materialId?: number; matPreset?: string } = {},
): Promise<RawSlicebugPlanResult> {
  const workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cricut-companion-plan-"));
  const request = buildSamplePlanRequest(workspaceDir, choices);
  await fs.promises.writeFile(request.inputSvgPath, request.svg, "utf8");

  try {
    const { stdout, stderr } = await execFileAsync(executable, request.invocation.args, {
      timeout: 30_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
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

async function runSvgPlan(executable: string, input: SvgPlanInput): Promise<RawSlicebugPlanResult> {
  const workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cricut-companion-plan-"));
  const request = buildSvgPlanRequest(workspaceDir, input);
  await fs.promises.writeFile(request.inputSvgPath, request.svg, "utf8");

  try {
    const { stdout, stderr } = await execFileAsync(executable, request.invocation.args, {
      timeout: 30_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
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

export async function generateSampleSlicebugPlan(
  choices: { materialId?: number; matPreset?: string } = {},
): Promise<SlicebugPlanResult> {
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

  return summarizePlanResult(await runSamplePlan(executable, choices));
}

export async function generateSvgSlicebugPlan(input: SvgPlanInput): Promise<SlicebugPlanResult> {
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

  return summarizePlanResult(await runSvgPlan(executable, input));
}

export class SlicebugCutSession {
  private readonly command: string;
  private readonly args: string[];
  private readonly spawnProcess: (command: string, args: string[], env?: NodeJS.ProcessEnv) => SlicebugProcess;
  private readonly smokeMode: boolean;
  private process: SlicebugProcess | null = null;
  private snapshot: CutSessionSnapshot;

  constructor(options: CutSessionOptions) {
    this.command = options.executable;
    this.args = ["cut", "--software-buttons", options.planPath];
    this.smokeMode = options.smokeMode;
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, env) => spawn(command, args, { windowsHide: true, env }) as ChildProcessWithoutNullStreams);
    this.snapshot = {
      id: options.id,
      status: "idle",
      action: makeCutAction("idle", "Ready when you are", "KindCut will only start after you press Start cut.", false),
      transcript: "",
      command: this.command,
      args: this.args,
      planPath: options.planPath,
    };
  }

  getSnapshot(): CutSessionSnapshot {
    return { ...this.snapshot, action: { ...this.snapshot.action } };
  }

  start(): CutSessionSnapshot {
    if (this.smokeMode) {
      this.snapshot = {
        ...this.snapshot,
        status: "blocked",
        action: makeCutAction(
          "error",
          "Cut blocked in test mode",
          "KindCut will not start a hardware cut while smoke mode is active.",
          false,
        ),
      };
      return this.getSnapshot();
    }

    if (this.process) {
      return this.getSnapshot();
    }

    this.process = this.spawnProcess(this.command, this.args, buildSlicebugSubprocessEnv());
    this.snapshot = {
      ...this.snapshot,
      status: "running",
      action: makeCutAction("running", "Starting SliceBug", "KindCut is waiting for the first cutter prompt.", false),
    };

    this.process.stdout.on("data", (chunk) => this.appendTranscript(chunk));
    this.process.stderr.on("data", (chunk) => this.appendTranscript(chunk));
    this.process.on("error", (error) => {
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        transcript: appendText(this.snapshot.transcript, error.message),
        action: makeCutAction("error", "Something needs attention", "SliceBug could not keep the cut session running.", false),
      };
    });
    this.process.on("exit", (code) => {
      if (this.snapshot.status === "stopped" || this.snapshot.status === "finished" || this.snapshot.status === "error") {
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        status: code === 0 ? "finished" : "error",
        action:
          code === 0
            ? makeCutAction("finished", "All done!", "Your project is ready. Gently peel it off the mat.", false)
            : makeCutAction("error", "Something needs attention", "SliceBug stopped before the cut finished.", false),
      };
    });

    return this.getSnapshot();
  }

  continue(): CutSessionSnapshot {
    if (this.process && this.snapshot.status === "waiting" && this.snapshot.action.requiresContinue) {
      this.process.stdin.write("\n");
      this.snapshot = {
        ...this.snapshot,
        status: "running",
        action: makeCutAction("running", "Continuing", "KindCut sent the continue step to SliceBug.", false),
      };
    }
    return this.getSnapshot();
  }

  stop(): CutSessionSnapshot {
    // SliceBug has no "cancel cut" command, so the only way to cancel is to fully tear it
    // down. Closing it drops the device-plugin connection, which halts the Cricut.
    if (this.process && !["finished", "error", "stopped"].includes(this.snapshot.status)) {
      const proc = this.process;
      // Close stdin first: if SliceBug is blocked on a button prompt (input()), the EOF
      // lets it exit cleanly through its DevicePlugin teardown rather than being killed
      // mid-write. Then SIGTERM, with a SIGKILL fallback so nothing is left holding the machine.
      try {
        proc.stdin.end?.();
      } catch {
        // stdin may already be closed — ignore.
      }
      proc.kill();
      const force = setTimeout(() => {
        try {
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          // already gone — ignore.
        }
      }, 2000);
      if (typeof (force as { unref?: () => void }).unref === "function") {
        (force as { unref: () => void }).unref();
      }
    }
    this.snapshot = {
      ...this.snapshot,
      status: "stopped",
      action: makeCutAction("error", "Cut cancelled", "KindCut closed SliceBug and cancelled the cut.", false),
    };
    return this.getSnapshot();
  }

  private appendTranscript(chunk: Buffer | string): void {
    const text = chunk.toString();
    const action = parseCutAction(text);
    this.snapshot = {
      ...this.snapshot,
      transcript: appendText(this.snapshot.transcript, text),
      status: action.kind === "finished" ? "finished" : action.kind === "error" ? "error" : action.requiresContinue ? "waiting" : "running",
      action,
    };
  }
}

function sanitizeSvgBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.svg$/i, "");
  const safe = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "imported-design";
}

function appendText(current: string, next: string): string {
  return `${current}${next}`;
}

function parseCutAction(text: string): CutActionState {
  const normalized = text.toLowerCase();
  if (/\b(error|failed|failure|traceback|exception)\b/.test(normalized)) {
    return makeCutAction("error", "Something needs attention", "The cutter reported a problem. Stop here and try again.", false);
  }
  // The unload prompt is a wait-for-the-operator step, not the end. (The cut is only truly
  // done when the process exits, after the software Unload — handled in the exit listener.)
  if (/\bunload\b/.test(normalized)) {
    return makeCutAction("unload", "Unload the mat", "Press Unload to release the mat from the machine.", true);
  }
  if (/\b(replace|change|swap).*\b(tool|blade|pen|marker)\b/.test(normalized)) {
    return makeCutAction("replace-tool", "Load the next tool", "Put in the requested tool, then press Continue here.", true);
  }
  if (/\b(press|push).*\b(go|start|button)\b/.test(normalized)) {
    return makeCutAction("press-go", "Load the tool", "Put the requested tool in the clamp, then press Continue.", true);
  }
  if (/\b(load|insert|place).*\b(mat|card)\b|\bmat\b.*\b(load|insert|ready)\b/.test(normalized)) {
    return makeCutAction("load-mat", "Load the mat", "Place the material on the mat and load it into the Cricut, then press Continue.", true);
  }
  if (/\b(load|insert|install).*\b(tool|pen|blade|marker|clamp)\b|\bclamp\b/.test(normalized)) {
    return makeCutAction("load-tools", "Load the tool", "Put the requested pen or blade in the clamp, then press Continue.", true);
  }
  // "Cutting finished." is treated as ongoing (not terminal) so polling continues until the
  // unload prompt and the process exit arrive.
  if (/\b(cutting|running|progress|path\s+\d+|finished|complete|completed|finishing)\b/.test(normalized)) {
    return makeCutAction("running", "Working", "The Cricut is working. Keep hands clear and wait for the next prompt.", false);
  }
  if (/\b(enter|continue|ready)\b/.test(normalized)) {
    return makeCutAction("load-mat", "Ready for the next step", "Check the Cricut, then press Continue here when you are ready.", true);
  }
  return makeCutAction("idle", "Waiting for the cutter", "KindCut is listening for the next cutter step.", false);
}

function makeCutAction(
  kind: CutActionState["kind"],
  title: string,
  message: string,
  requiresContinue: boolean,
): CutActionState {
  return {
    kind,
    title,
    message,
    requiresContinue,
    canStop: kind !== "finished" && kind !== "error",
    tone:
      kind === "error"
        ? "error"
        : kind === "finished"
          ? "success"
          : kind === "running"
            ? "running"
            : requiresContinue
              ? "waiting"
              : "neutral",
  };
}
