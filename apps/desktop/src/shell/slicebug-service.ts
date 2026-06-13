import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDiagnosticsLogsDir, logDiagnostics } from "./diagnostics-log";

const execFileAsync = promisify(execFile);
const JOEL_LOCAL_SLICEBUG = "/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug";
const BUNDLED_SLICEBUG_RESOURCE_DIR = "slicebug";
const WINDOWS_CUTTER_BLOCKING_PROCESS_NAMES = new Set([
  "cricut design space.exe",
  "cricutdevice.exe",
  "cricutdevicebridge.exe",
]);

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

export interface SlicebugListMaterialsInvocation {
  args: ["list-materials"];
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

export interface CutterProcessCheckResult {
  ok: boolean;
  processes: string[];
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
  hasMachineProfile: boolean;
  machineProfileCount: number;
  profileNames: string[];
  profileMaterialSettingsPaths: string[];
  missingMaterialSettingsPaths: string[];
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
  code?: string;
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
  recoverFromHandshakeError?: () => Promise<SlicebugBootstrapResult>;
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

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function logSlicebugIssue(context: string, details: Record<string, unknown>): void {
  logDiagnostics("error", `[SliceBug] ${context}`, details);
}

function logSlicebugDebug(context: string, details: Record<string, unknown>): void {
  logDiagnostics("debug", `[SliceBug] ${context}`, details);
}

function logSlicebugResultIssue(context: string, result: RawSlicebugResult): void {
  if (!result.error && result.stderr.trim().length === 0) {
    return;
  }

  logSlicebugIssue(context, {
    executable: result.executable,
    error: result.error,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

export function buildSlicebugSubprocessEnv(options: SlicebugCandidateOptions = {}): NodeJS.ProcessEnv {
  const bundledUsvg = firstExistingFile(findBundledUsvgCandidates(options));
  const debugLogPath = process.env.SLICEBUG_DEBUG_LOG ?? slicebugDebugLogPath();
  const diagnosticsEnv = debugLogPath ? { SLICEBUG_DEBUG_LOG: debugLogPath } : {};
  if (!bundledUsvg) {
    return {
      ...process.env,
      ...diagnosticsEnv,
    };
  }

  const usvgDir = path.dirname(bundledUsvg);
  const currentPath = process.env.PATH ?? "";
  return {
    ...process.env,
    ...diagnosticsEnv,
    PATH: currentPath ? `${usvgDir}${path.delimiter}${currentPath}` : usvgDir,
  };
}

function slicebugDebugLogPath(): string | null {
  const logsDir = getDiagnosticsLogsDir();
  return logsDir ? path.join(logsDir, "slicebug-debug.log") : null;
}

export function buildSlicebugInvocation(): SlicebugInvocation {
  return { args: ["--version"] };
}

export function buildListMaterialsInvocation(): SlicebugListMaterialsInvocation {
  return { args: ["list-materials"] };
}

export function defaultDesignSpacePaths(platform: NodeJS.Platform = process.platform, homeDir = os.homedir()): Required<SlicebugBootstrapInput> {
  const designSpacePaths = defaultDesignSpacePathCandidates(platform, homeDir);
  const profilePaths = defaultDesignSpaceProfilePathCandidates(platform, homeDir);
  return {
    designSpacePath: designSpacePaths[0] ?? "",
    designSpaceProfilePath: profilePaths[0] ?? "",
  };
}

export function defaultDesignSpacePathCandidates(
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): string[] {
  if (platform === "win32") {
    return uniqueCandidates([
      path.join(homeDir, "AppData", "Local", "Programs", "Cricut Design Space"),
      path.join(homeDir, "AppData", "Local", "Program", "Cricut Design Space"),
      path.join(homeDir, "AppData", "Local", "Cricut Design Space"),
    ]);
  }

  return ["/Applications/Cricut Design Space.app/Contents/Resources"];
}

export function defaultDesignSpaceProfilePathCandidates(
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): string[] {
  const homeProfile = path.join(homeDir, ".cricut-design-space");
  if (platform === "win32") {
    return uniqueCandidates([
      homeProfile,
      path.join(homeDir, "AppData", "Roaming", "Cricut Design Space"),
      path.join(homeDir, "AppData", "Local", "Cricut Design Space"),
      path.join(homeDir, "AppData", "Local", "Programs", "Cricut Design Space"),
      path.join(homeDir, "AppData", "Local", "Program", "Cricut Design Space"),
    ]);
  }

  return uniqueCandidates([
    homeProfile,
    path.join(homeDir, "Library", "Application Support", "Cricut Design Space"),
  ]);
}

export function buildBootstrapCandidateInputs(
  input: SlicebugBootstrapInput = {},
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): Required<SlicebugBootstrapInput>[] {
  const designSpacePaths = input.designSpacePath
    ? [input.designSpacePath]
    : defaultDesignSpacePathCandidates(platform, homeDir);
  const profilePaths = input.designSpaceProfilePath
    ? [input.designSpaceProfilePath]
    : defaultDesignSpaceProfilePathCandidates(platform, homeDir);

  const candidates: Required<SlicebugBootstrapInput>[] = [];
  for (const designSpacePath of designSpacePaths) {
    for (const designSpaceProfilePath of profilePaths) {
      candidates.push({ designSpacePath, designSpaceProfilePath });
    }
  }

  return uniqueBootstrapInputs(candidates).sort((left, right) => {
    const leftScore = bootstrapInputExistingDirectoryScore(left);
    const rightScore = bootstrapInputExistingDirectoryScore(right);
    return rightScore - leftScore;
  });
}

function uniqueBootstrapInputs(candidates: Required<SlicebugBootstrapInput>[]): Required<SlicebugBootstrapInput>[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.designSpacePath}\0${candidate.designSpaceProfilePath}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function directoryExists(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function bootstrapInputExistingDirectoryScore(input: Required<SlicebugBootstrapInput>): number {
  return Number(directoryExists(input.designSpacePath)) + Number(directoryExists(input.designSpaceProfilePath));
}

export function parseWindowsTasklistImageNames(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('"')) {
        return line.slice(1).split('","')[0] ?? "";
      }
      return line.split(/\s+/)[0] ?? "";
    })
    .filter(Boolean);
}

export async function checkForBlockingCutterProcesses(
  platform: NodeJS.Platform = process.platform,
): Promise<CutterProcessCheckResult> {
  if (platform !== "win32") {
    return { ok: true, processes: [], message: "" };
  }

  try {
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
      timeout: 10_000,
      windowsHide: true,
    });
    const processes = parseWindowsTasklistImageNames(stdout)
      .filter((processName) => WINDOWS_CUTTER_BLOCKING_PROCESS_NAMES.has(processName.toLowerCase()));
    if (processes.length === 0) {
      return { ok: true, processes: [], message: "" };
    }

    return {
      ok: false,
      processes,
      message: [
        "Design Space or its cutter helper is still running and may be holding the Bluetooth connection.",
        `Close these processes before cutting: ${Array.from(new Set(processes)).join(", ")}`,
      ].join("\n"),
    };
  } catch (error) {
    logSlicebugIssue("Could not check Windows cutter processes", { error: normalizeError(error) });
    return { ok: true, processes: [], message: "" };
  }
}

export function findDesignSpaceMachineProfileSerials(designSpaceProfilePath: string): string[] {
  const localDataPath = path.join(designSpaceProfilePath, "LocalData");
  if (!directoryExists(localDataPath)) {
    return [];
  }

  const serials = new Set<string>();
  try {
    for (const userEntry of fs.readdirSync(localDataPath, { withFileTypes: true })) {
      if (!userEntry.isDirectory()) {
        continue;
      }
      const materialSettingsRoot = path.join(localDataPath, userEntry.name, "MaterialSettings");
      if (!directoryExists(materialSettingsRoot)) {
        continue;
      }
      for (const machineEntry of fs.readdirSync(materialSettingsRoot, { withFileTypes: true })) {
        if (machineEntry.isDirectory() && fs.existsSync(path.join(materialSettingsRoot, machineEntry.name, "MaterialSettings"))) {
          serials.add(machineEntry.name);
        }
      }
    }
  } catch (error) {
    logSlicebugIssue("Failed to scan Design Space machine profiles", {
      designSpaceProfilePath,
      error: normalizeError(error),
    });
  }

  return Array.from(serials);
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
  const profilesRoot = path.join(configRoot, "profiles");
  const devicePluginPath = path.join(configRoot, "plugins", "device-common", `CricutDevice${executableSuffix}`);
  const configUsvgPath = path.join(configRoot, "plugins", "usvg", `usvg${executableSuffix}`);
  const hasKeys = fs.existsSync(keysPath);
  const hasProfiles = fs.existsSync(profilesPath);
  const profileEntries = readMachineProfileEntries(profilesPath);
  const profileNames = profileEntries.map((entry) => entry.name);
  const profileMaterialSettingsPaths = profileEntries.map((entry) =>
    path.join(profilesRoot, entry.serial, "material_settings.json"),
  );
  const missingMaterialSettingsPaths = profileMaterialSettingsPaths.filter((materialSettingsPath) => !fs.existsSync(materialSettingsPath));
  const machineProfileCount = profileNames.length;
  const hasMachineProfile = machineProfileCount > 0;
  const hasProfileMaterialSettings = hasMachineProfile && missingMaterialSettingsPaths.length === 0;
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
    hasMachineProfile,
    machineProfileCount,
    profileNames,
    profileMaterialSettingsPaths,
    missingMaterialSettingsPaths,
    hasDevicePlugin,
    hasUsvg,
    bootstrapped: hasKeys && hasProfiles && hasMachineProfile && hasProfileMaterialSettings && hasDevicePlugin && hasUsvg,
  };
}

function readMachineProfileEntries(profilesPath: string): Array<{ name: string; serial: string }> {
  if (!fs.existsSync(profilesPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(profilesPath, "utf8")) as { profiles?: unknown };
    if (!parsed.profiles || typeof parsed.profiles !== "object" || Array.isArray(parsed.profiles)) {
      return [];
    }
    return Object.entries(parsed.profiles).flatMap(([name, value]) => {
      if (!value || typeof value !== "object" || !("serial" in value)) {
        return [];
      }
      const serial = (value as { serial?: unknown }).serial;
      return typeof serial === "string" && serial.length > 0 ? [{ name, serial }] : [];
    });
  } catch (error) {
    logSlicebugIssue("Failed to read SliceBug machine profiles", {
      profilesPath,
      error: normalizeError(error),
    });
    return [];
  }
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
    try {
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
    } catch (error) {
      logSlicebugIssue("Failed to parse plan output", {
        executable: result.executable,
        inputSvgPath: result.inputSvgPath,
        outputPlanPath: result.outputPlanPath,
        error: normalizeError(error),
        stdout,
        stderr,
        planJson: result.planJson,
      });
    }
  }

  const messageParts = [result.error, stderr.trim() || stdout.trim()].filter(Boolean);
  const rawMessage = messageParts.join("\n") || "SliceBug plan did not return a usable response.";
  return {
    ok: false,
    executable: result.executable,
    inputSvgPath: result.inputSvgPath,
    outputPlanPath: result.outputPlanPath,
    stdout,
    stderr,
    message: friendlySlicebugPlanError(rawMessage),
    plan: null,
  };
}

function friendlySlicebugPlanError(message: string): string {
  if (/machine profile is required|machine profile.*not found/i.test(message)) {
    return [
      "The cutter helper is installed, but it does not have a machine profile yet.",
      "Open Design Space on this Windows laptop, make sure the cutter is configured there, then run KindCut's helper setup again.",
      "If it still says this, run one tiny test cut in Design Space first so it writes the local material profile.",
    ].join("\n");
  }

  return message;
}

function setupRequiredPlanResult(executable: string): SlicebugPlanResult {
  return {
    ok: false,
    executable,
    inputSvgPath: "",
    outputPlanPath: "",
    stdout: "",
    stderr: "",
    message: [
      "The cutter helper is not fully set up yet.",
      "Run the KindCut helper setup after Design Space has been opened and the cutter has been configured on this computer.",
      "On Windows, Design Space may only create the machine profile after one tiny test cut in Design Space.",
    ].join("\n"),
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
  logSlicebugDebug("Running command", { executable, args: invocation.args });

  try {
    const { stdout, stderr } = await execFileAsync(executable, invocation.args, {
      timeout: 10_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
    });
    const result = { executable, stdout, stderr };
    logSlicebugDebug("Command completed", { executable, args: invocation.args, stdout, stderr });
    logSlicebugResultIssue("Version check returned stderr", result);
    return result;
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string; code?: unknown };
    const result = {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
    };
    logSlicebugResultIssue("Version check failed", result);
    return result;
  }
}

async function runBootstrap(executable: string, input: SlicebugBootstrapInput = {}): Promise<RawSlicebugResult> {
  const invocation = buildBootstrapInvocation(input);
  logSlicebugDebug("Running command", { executable, args: invocation.args });

  try {
    const { stdout, stderr } = await execFileAsync(executable, invocation.args, {
      timeout: 120_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
    });
    const result = { executable, stdout, stderr };
    logSlicebugDebug("Command completed", { executable, args: invocation.args, stdout, stderr });
    logSlicebugResultIssue("Bootstrap returned stderr", result);
    return result;
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string; code?: unknown };
    const result = {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
    };
    logSlicebugResultIssue("Bootstrap failed", result);
    return result;
  }
}

async function runListMaterials(executable: string): Promise<RawSlicebugResult> {
  const invocation = buildListMaterialsInvocation();
  logSlicebugDebug("Running command", { executable, args: invocation.args });

  try {
    const { stdout, stderr } = await execFileAsync(executable, invocation.args, {
      timeout: 30_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
    });
    const result = { executable, stdout, stderr };
    logSlicebugDebug("Command completed", { executable, args: invocation.args, stdout, stderr });
    logSlicebugResultIssue("List materials returned stderr", result);
    return result;
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string; code?: unknown };
    const result = {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
    };
    logSlicebugResultIssue("List materials failed", result);
    return result;
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

  let lastResult: RawSlicebugResult | null = null;
  let lastSetup = getSlicebugSetupStatus();
  let lastAttempt: Required<SlicebugBootstrapInput> | null = null;
  const attempts = buildBootstrapCandidateInputs(input);

  await clearBootstrappedDevicePlugin();

  for (const attempt of attempts) {
    const designSpaceProfileSerials = findDesignSpaceMachineProfileSerials(attempt.designSpaceProfilePath);
    if (designSpaceProfileSerials.length > 1) {
      return multipleMachineProfilesResult(executable, attempt, designSpaceProfileSerials);
    }

    const result = await runBootstrap(executable, attempt);
    const setup = getSlicebugSetupStatus();
    const bundledUsvgFallback = isBundledUsvgBootstrapFallback(result, setup);
    const ok = setup.bootstrapped && (!result.error || bundledUsvgFallback);
    if (ok) {
      const listMaterialsResult = await runListMaterials(executable);
      if (listMaterialsResult.error) {
        return validateListMaterialsResult(listMaterialsResult);
      }

      return {
        ...result,
        ok,
        message:
          bundledUsvgFallback
            ? "SliceBug setup completed using KindCut's bundled usvg."
            : "SliceBug setup completed.",
      };
    }

    lastResult = result;
    lastSetup = setup;
    lastAttempt = attempt;
    logSlicebugIssue("Bootstrap attempt did not complete setup", {
      executable,
      designSpacePath: attempt.designSpacePath,
      designSpaceProfilePath: attempt.designSpaceProfilePath,
      setup,
      error: result.error,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  if (!lastResult) {
    return {
      ok: false,
      executable,
      stdout: "",
      stderr: "",
      error: "No SliceBug bootstrap paths were available.",
      message: "SliceBug setup did not have any Design Space paths to try.",
    };
  }

  const messageParts = [lastResult.error, lastResult.stderr.trim() || lastResult.stdout.trim()].filter(Boolean);
  return {
    ...lastResult,
    ok: false,
    message: friendlyBootstrapError(
      messageParts.join("\n") || "SliceBug setup did not complete.",
      attempts,
      lastAttempt,
      lastSetup,
    ),
  };
}

function friendlyBootstrapError(
  message: string,
  attempts: Required<SlicebugBootstrapInput>[],
  lastAttempt: Required<SlicebugBootstrapInput> | null,
  setup: SlicebugSetupStatus,
): string {
  if (setup.hasKeys && setup.hasProfiles && !setup.hasMachineProfile) {
    return [
      "KindCut found Design Space data, but no cutter machine profile was available yet.",
      "Open Design Space on this computer and run one tiny test cut, then use KindCut's helper setup again.",
      "Tried profile folders:",
      ...defaultTriedProfilePaths(attempts),
    ].join("\n");
  }

  if (/not found|No user data|profile not found|Design Space profile/i.test(message)) {
    return [
      message,
      "KindCut tried these Design Space folders:",
      ...defaultTriedDesignSpacePaths(attempts),
      "KindCut tried these Design Space profile folders:",
      ...defaultTriedProfilePaths(attempts),
    ].join("\n");
  }

  if (lastAttempt) {
    return [
      message,
      `Last Design Space folder: ${lastAttempt.designSpacePath}`,
      `Last profile folder: ${lastAttempt.designSpaceProfilePath}`,
    ].join("\n");
  }

  return message;
}

function defaultTriedDesignSpacePaths(attempts: Required<SlicebugBootstrapInput>[]): string[] {
  return uniqueCandidates(attempts.map((attempt) => attempt.designSpacePath)).map((candidate) => `- ${candidate}`);
}

function defaultTriedProfilePaths(attempts: Required<SlicebugBootstrapInput>[]): string[] {
  return uniqueCandidates(attempts.map((attempt) => attempt.designSpaceProfilePath)).map((candidate) => `- ${candidate}`);
}

async function clearBootstrappedDevicePlugin(configRoot = slicebugConfigRoot()): Promise<void> {
  const devicePluginDir = path.join(configRoot, "plugins", "device-common");
  try {
    await fs.promises.rm(devicePluginDir, { recursive: true, force: true });
    logSlicebugDebug("Cleared bootstrapped device plugin directory", { devicePluginDir });
  } catch (error) {
    logSlicebugIssue("Failed to clear bootstrapped device plugin directory", {
      devicePluginDir,
      error: normalizeError(error),
    });
  }
}

function multipleMachineProfilesResult(
  executable: string,
  attempt: Required<SlicebugBootstrapInput>,
  serials: string[],
): SlicebugBootstrapResult {
  return {
    ok: false,
    executable,
    stdout: "",
    stderr: "",
    error: "Multiple Design Space machine profiles found.",
    message: [
      "KindCut found multiple cutter profiles in Design Space data and cannot safely choose one yet.",
      `Profiles found: ${serials.join(", ")}`,
      "Remove unused cutters from Design Space on this computer, or keep only the cutter you want to use configured there, then run helper setup again.",
      `Design Space profile folder: ${attempt.designSpaceProfilePath}`,
    ].join("\n"),
  };
}

function validateListMaterialsResult(result: RawSlicebugResult): SlicebugBootstrapResult {
  const messageParts = [result.error, result.stderr.trim() || result.stdout.trim()].filter(Boolean);
  return {
    ...result,
    ok: false,
    message:
      friendlySlicebugPlanError(messageParts.join("\n") || "SliceBug setup completed, but material validation failed."),
  };
}

async function runSamplePlan(
  executable: string,
  choices: { materialId?: number; matPreset?: string } = {},
): Promise<RawSlicebugPlanResult> {
  const workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cricut-companion-plan-"));
  const request = buildSamplePlanRequest(workspaceDir, choices);
  await fs.promises.writeFile(request.inputSvgPath, request.svg, "utf8");
  logSlicebugDebug("Running command", { executable, args: request.invocation.args });

  try {
    const { stdout, stderr } = await execFileAsync(executable, request.invocation.args, {
      timeout: 30_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
    });
    const planJson = await fs.promises.readFile(request.outputPlanPath, "utf8");
    const result = {
      executable,
      stdout,
      stderr,
      inputSvgPath: request.inputSvgPath,
      outputPlanPath: request.outputPlanPath,
      planJson,
    };
    logSlicebugDebug("Command completed", { executable, args: request.invocation.args, stdout, stderr });
    logSlicebugResultIssue("Sample plan returned stderr", result);
    return result;
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string };
    const result = {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
      inputSvgPath: request.inputSvgPath,
      outputPlanPath: request.outputPlanPath,
    };
    logSlicebugResultIssue("Sample plan failed", result);
    return result;
  }
}

async function runSvgPlan(executable: string, input: SvgPlanInput): Promise<RawSlicebugPlanResult> {
  const workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cricut-companion-plan-"));
  const request = buildSvgPlanRequest(workspaceDir, input);
  await fs.promises.writeFile(request.inputSvgPath, request.svg, "utf8");
  logSlicebugDebug("Running command", { executable, args: request.invocation.args });

  try {
    const { stdout, stderr } = await execFileAsync(executable, request.invocation.args, {
      timeout: 30_000,
      windowsHide: true,
      env: buildSlicebugSubprocessEnv(),
    });
    const planJson = await fs.promises.readFile(request.outputPlanPath, "utf8");
    const result = {
      executable,
      stdout,
      stderr,
      inputSvgPath: request.inputSvgPath,
      outputPlanPath: request.outputPlanPath,
      planJson,
    };
    logSlicebugDebug("Command completed", { executable, args: request.invocation.args, stdout, stderr });
    logSlicebugResultIssue("SVG plan returned stderr", result);
    return result;
  } catch (error) {
    const maybeError = error as Error & { stdout?: string; stderr?: string };
    const result = {
      executable,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      error: maybeError.message,
      inputSvgPath: request.inputSvgPath,
      outputPlanPath: request.outputPlanPath,
    };
    logSlicebugResultIssue("SVG plan failed", result);
    return result;
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

  const setup = getSlicebugSetupStatus();
  if (!setup.bootstrapped) {
    return setupRequiredPlanResult(executable);
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

  const setup = getSlicebugSetupStatus();
  if (!setup.bootstrapped) {
    return setupRequiredPlanResult(executable);
  }

  return summarizePlanResult(await runSvgPlan(executable, input));
}

export class SlicebugCutSession {
  private readonly command: string;
  private readonly args: string[];
  private readonly spawnProcess: (command: string, args: string[], env?: NodeJS.ProcessEnv) => SlicebugProcess;
  private readonly recoverFromHandshakeError: () => Promise<SlicebugBootstrapResult>;
  private readonly smokeMode: boolean;
  private recoveryAttempted = false;
  private process: SlicebugProcess | null = null;
  private snapshot: CutSessionSnapshot;

  constructor(options: CutSessionOptions) {
    this.command = options.executable;
    this.args = ["cut", "--software-buttons", options.planPath];
    this.smokeMode = options.smokeMode;
    this.spawnProcess =
      options.spawnProcess ??
      ((command, args, env) => spawn(command, args, { windowsHide: true, env }) as ChildProcessWithoutNullStreams);
    this.recoverFromHandshakeError = options.recoverFromHandshakeError ?? (() => bootstrapSlicebug());
    this.snapshot = {
      id: options.id,
      status: "idle",
      action: makeCutAction("idle", "Ready when you are", "KindCut will only start after you press Start cut.", false, "idle.ready"),
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
          "error.smokeBlocked",
        ),
      };
      return this.getSnapshot();
    }

    if (this.process) {
      return this.getSnapshot();
    }

    try {
      logSlicebugDebug("Starting cut session command", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
      });
      this.process = this.spawnProcess(this.command, this.args, buildSlicebugSubprocessEnv());
    } catch (error) {
      logSlicebugIssue("Cut session failed to start", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        error: normalizeError(error),
      });
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        transcript: appendText(this.snapshot.transcript, normalizeError(error)),
        action: makeCutAction("error", "Something needs attention", "SliceBug could not start the cut session.", false, "error.startFailed"),
      };
      return this.getSnapshot();
    }
    this.snapshot = {
      ...this.snapshot,
      status: "running",
      action: makeCutAction("running", "Starting SliceBug", "KindCut is waiting for the first cutter prompt.", false, "running.starting"),
    };

    this.process.stdout.on("data", (chunk) => {
      logSlicebugDebug("Received cut stdout", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        stdout: chunk.toString(),
      });
      this.appendTranscript(chunk);
    });
    this.process.stderr.on("data", (chunk) => {
      const stderr = chunk.toString();
      logSlicebugDebug("Received cut stderr", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        stderr,
      });
      logSlicebugIssue("Cut session stderr", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        stderr,
      });
      this.appendTranscript(stderr);
    });
    this.process.on("error", (error) => {
      logSlicebugIssue("Cut session process error", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        error: normalizeError(error),
      });
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        transcript: appendText(this.snapshot.transcript, error.message),
        action: makeCutAction(
          "error",
          "Something needs attention",
          friendlyCutErrorMessage(error.message) ?? "SliceBug could not keep the cut session running.",
          false,
          friendlyCutErrorCode(error.message) ?? "error.processFailed",
        ),
      };
    });
    this.process.on("exit", (code) => {
      if (code !== 0 && this.snapshot.status !== "stopped") {
        logSlicebugIssue("Cut session exited with an error", {
          command: this.command,
          args: this.args,
          planPath: this.snapshot.planPath,
          exitCode: code,
          transcript: this.snapshot.transcript,
        });
      }
      if (code !== 0 && this.shouldAttemptBootstrapRecovery()) {
        void this.attemptBootstrapRecovery();
        return;
      }
      if (this.snapshot.status === "stopped" || this.snapshot.status === "finished" || this.snapshot.status === "error") {
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        status: code === 0 ? "finished" : "error",
        action:
          code === 0
            ? makeCutAction("finished", "All done!", "Your project is ready. Gently peel it off the mat.", false, "finished.done")
            : makeCutAction(
                "error",
                "Something needs attention",
                friendlyCutErrorMessage(this.snapshot.transcript) ?? "SliceBug stopped before the cut finished.",
                false,
                friendlyCutErrorCode(this.snapshot.transcript) ?? "error.cutStopped",
              ),
      };
    });

    return this.getSnapshot();
  }

  continue(): CutSessionSnapshot {
    if (this.process && this.snapshot.status === "waiting" && this.snapshot.action.requiresContinue) {
      logSlicebugDebug("Sending cut stdin", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        stdin: "\\n",
      });
      this.process.stdin.write("\n");
      this.snapshot = {
        ...this.snapshot,
        status: "running",
        action: makeCutAction("running", "Continuing", "KindCut sent the continue step to SliceBug.", false, "running.continuing"),
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
      action: makeCutAction("error", "Cut cancelled", "KindCut closed SliceBug and cancelled the cut.", false, "error.cancelled"),
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

  private shouldAttemptBootstrapRecovery(): boolean {
    return !this.recoveryAttempted && isRecoverableCricutDeviceStartError(this.snapshot.transcript);
  }

  private async attemptBootstrapRecovery(): Promise<void> {
    this.recoveryAttempted = true;
    const recoveryIntro = [
      "",
      "KindCut detected that the cutter helper rejected the cut startup.",
      "KindCut is refreshing the helper setup automatically.",
      "",
    ].join("\n");
    this.snapshot = {
      ...this.snapshot,
      status: "running",
      transcript: appendText(this.snapshot.transcript, recoveryIntro),
      action: makeCutAction(
        "running",
        "Refreshing helper setup",
        "The cutter helper rejected the cut startup. KindCut is rerunning helper setup now, then you can try the cut again.",
        false,
        "running.refreshingHelper",
      ),
    };
    logSlicebugIssue("Cut session hit CricutDevice start error; running bootstrap recovery", {
      command: this.command,
      args: this.args,
      planPath: this.snapshot.planPath,
      transcript: this.snapshot.transcript,
    });

    try {
      const result = await this.recoverFromHandshakeError();
      logSlicebugDebug("Bootstrap recovery completed after cut startup failure", {
        executable: result.executable,
        ok: result.ok,
        message: result.message,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      });

      const recoveryResultText = [
        result.ok ? "KindCut refreshed the helper setup." : "KindCut tried to refresh the helper setup, but it did not complete.",
        result.message,
        "",
      ].join("\n");
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        transcript: appendText(this.snapshot.transcript, recoveryResultText),
        action: makeCutAction(
          "error",
          result.ok ? "Helper setup refreshed" : "Helper setup still needs attention",
          result.ok
            ? "KindCut refreshed the helper setup. Make sure Design Space is closed and Bluetooth is connected, then start the cut again."
            : `KindCut tried to refresh the helper setup, but it did not complete: ${result.message}`,
          false,
          result.ok ? "error.helperRefreshed" : "error.helperRefreshIncomplete",
        ),
      };
    } catch (error) {
      const message = normalizeError(error);
      logSlicebugIssue("Bootstrap recovery threw after cut startup failure", {
        command: this.command,
        args: this.args,
        planPath: this.snapshot.planPath,
        error: message,
      });
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        transcript: appendText(this.snapshot.transcript, `KindCut could not refresh the helper setup.\n${message}\n`),
        action: makeCutAction(
          "error",
          "Helper setup still needs attention",
          "KindCut tried to refresh the helper setup, but the repair attempt failed. Open the logs folder and try helper setup manually.",
          false,
          "error.helperRefreshFailed",
        ),
      };
    }
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

export function isRecoverableCricutDeviceStartError(text: string): boolean {
  return /incorrect message status:\s*expected\s+2,\s*got\s+0/i.test(text);
}

function parseCutAction(text: string): CutActionState {
  const normalized = text.toLowerCase();
  const friendlyError = friendlyCutErrorMessage(text);
  if (friendlyError !== null) {
    return makeCutAction("error", "Something needs attention", friendlyError, false, friendlyCutErrorCode(text) ?? "error.helperProblem");
  }
  if (/\b(error|failed|failure|traceback|exception)\b/.test(normalized)) {
    return makeCutAction("error", "Something needs attention", "The cutter reported a problem. Stop here and try again.", false, "error.cutterProblem");
  }
  // The unload prompt is a wait-for-the-operator step, not the end. (The cut is only truly
  // done when the process exits, after the software Unload — handled in the exit listener.)
  if (/\bunload\b/.test(normalized)) {
    return makeCutAction("unload", "Unload the mat", "Press Unload to release the mat from the machine.", true, "cut.unload");
  }
  if (/\b(replace|change|swap).*\b(tool|blade|pen|marker)\b/.test(normalized)) {
    return makeCutAction("replace-tool", "Load the next tool", "Put in the requested tool, then press Continue here.", true, "cut.replaceTool");
  }
  if (/\b(press|push).*\b(go|start|button)\b/.test(normalized)) {
    return makeCutAction("press-go", "Load the tool", "Put the requested tool in the clamp, then press Continue.", true, "cut.pressGo");
  }
  if (/\b(load|insert|place).*\b(mat|card)\b|\bmat\b.*\b(load|insert|ready)\b/.test(normalized)) {
    return makeCutAction("load-mat", "Load the mat", "Place the material on the mat and load it into the Cricut, then press Continue.", true, "cut.loadMat");
  }
  if (/\b(load|insert|install).*\b(tool|pen|blade|marker|clamp)\b|\bclamp\b/.test(normalized)) {
    return makeCutAction("load-tools", "Load the tool", "Put the requested pen or blade in the clamp, then press Continue.", true, "cut.loadTools");
  }
  // "Cutting finished." is treated as ongoing (not terminal) so polling continues until the
  // unload prompt and the process exit arrive.
  if (/\b(cutting|running|progress|path\s+\d+|finished|complete|completed|finishing)\b/.test(normalized)) {
    return makeCutAction("running", "Working", "The Cricut is working. Keep hands clear and wait for the next prompt.", false, "running.working");
  }
  if (/\b(enter|continue|ready)\b/.test(normalized)) {
    return makeCutAction("load-mat", "Ready for the next step", "Check the Cricut, then press Continue here when you are ready.", true, "cut.readyNext");
  }
  return makeCutAction("idle", "Waiting for the cutter", "KindCut is listening for the next cutter step.", false, "idle.waiting");
}

function friendlyCutErrorMessage(text: string): string | null {
  if (!text.trim()) {
    return null;
  }

  if (/no cricut devices connected|no device connected|nodeviceconnected/i.test(text)) {
    return "KindCut could not find the cutter. Make sure it is powered on, paired over Bluetooth with this Windows laptop, and not connected to another computer.";
  }

  if (/plugin stdout closed|stdout closed|eoferror|could not keep the cut session|failed to connect|connection.*(failed|closed|lost)/i.test(text)) {
    return "The cutter helper lost its connection. Close Design Space, confirm Bluetooth is connected to this laptop, then try again.";
  }

  if (/serial of connected device.*does not match profile|connect the correct device|switch to a different profile/i.test(text)) {
    return "The connected cutter does not match the saved Design Space profile. Connect the configured cutter, or run helper setup again after configuring the correct machine in Design Space.";
  }

  if (/multiple devices/i.test(text)) {
    return "More than one cutter appears to be connected. Leave only the cutter you want to use connected, then try again.";
  }

  if (/\b(error|failed|failure|traceback|exception)\b/i.test(text)) {
    return "The cutter helper reported a problem. Check that Design Space is closed, Bluetooth is connected, and the cutter is awake, then try again.";
  }

  return null;
}

function friendlyCutErrorCode(text: string): string | null {
  if (/no cricut devices connected|no device connected|nodeviceconnected/i.test(text)) {
    return "error.noDevice";
  }

  if (/plugin stdout closed|stdout closed|eoferror|could not keep the cut session|failed to connect|connection.*(failed|closed|lost)/i.test(text)) {
    return "error.connectionLost";
  }

  if (/serial of connected device.*does not match profile|connect the correct device|switch to a different profile/i.test(text)) {
    return "error.deviceMismatch";
  }

  if (/multiple devices/i.test(text)) {
    return "error.multipleDevices";
  }

  if (/\b(error|failed|failure|traceback|exception)\b/i.test(text)) {
    return "error.helperProblem";
  }

  return null;
}

function makeCutAction(
  kind: CutActionState["kind"],
  title: string,
  message: string,
  requiresContinue: boolean,
  code?: string,
): CutActionState {
  return {
    kind,
    code,
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
