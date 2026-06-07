#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const slicebugRoot = path.join(repoRoot, "vendor", "slicebug");
const outputDir = path.join(desktopRoot, "resources", "slicebug");
const venvDir = path.join(slicebugRoot, ".kindcut-build-venv");

function getPythonVersion(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), label: output.trim() };
}

function findPython() {
  const preferred = [process.env.PYTHON, process.env.PYTHON3, "python3.10", "python3.11", "python3"].filter(Boolean);
  const seen = new Set();
  for (const candidate of preferred) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const version = getPythonVersion(candidate);
    if (!version) continue;
    if (version.major === 3 && version.minor <= 11) {
      return { command: candidate, version };
    }
  }

  const found = preferred
    .map((candidate) => ({ candidate, version: getPythonVersion(candidate) }))
    .filter((entry) => entry.version)
    .map((entry) => `${entry.candidate} (${entry.version.label})`)
    .join(", ");
  throw new Error(
    `SliceBug's cx_Freeze pin needs Python 3.10 or 3.11. Found: ${found || "no usable Python"}. ` +
      "Set PYTHON=/path/to/python3.10 and try again.",
  );
}

const python = findPython();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || slicebugRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    process.exitCode = result.status || 1;
    throw new Error(`Command failed: ${rendered}`);
  }
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function venvPythonPath() {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function venvExecutablePath(name) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", executableName(name))
    : path.join(venvDir, "bin", name);
}

if (!fs.existsSync(path.join(slicebugRoot, "setup.py"))) {
  console.error(`SliceBug checkout not found at ${slicebugRoot}`);
  console.error("Copy or clone SliceBug into vendor/slicebug first.");
  process.exit(1);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

function venvMatchesPython() {
  const version = getPythonVersion(venvPythonPath());
  return Boolean(version && version.major === python.version.major && version.minor === python.version.minor);
}

if (fs.existsSync(venvPythonPath()) && !venvMatchesPython()) {
  console.log("Recreating SliceBug build virtualenv with a compatible Python...");
  fs.rmSync(venvDir, { recursive: true, force: true });
}

if (!fs.existsSync(venvPythonPath())) {
  console.log(`Creating SliceBug build virtualenv with ${python.version.label}...`);
  run(python.command, ["-m", "venv", venvDir], { cwd: slicebugRoot });
}

const venvPython = venvPythonPath();
console.log("Installing SliceBug build dependencies...");
run(venvPython, ["-m", "pip", "install", "-r", "requirements-dev.txt"]);

console.log("Freezing SliceBug runtime...");
// SliceBug's setup.py imports setup() from setuptools, so some environments do
// not register cx_Freeze's build_exe command. Use the cxfreeze CLI instead and
// keep the vendored source untouched.
run(venvExecutablePath("cxfreeze"), [
  "slicebug/__main__.py",
  "--target-name",
  executableName("slicebug"),
  "--target-dir",
  outputDir,
  "--excludes",
  "tkinter",
  "--include-path",
  slicebugRoot,
  "--packages",
  "slicebug",
  "--zip-include-packages",
  "*",
  "--zip-exclude-packages",
  "",
  "--include-files",
  ["README.md", "docs", "examples"].join(","),
]);

const helperPath = path.join(outputDir, executableName("slicebug"));
if (!fs.existsSync(helperPath)) {
  console.error(`Expected frozen SliceBug helper at ${helperPath}, but it was not created.`);
  process.exit(1);
}

console.log(`Bundled SliceBug runtime ready: ${helperPath}`);
