#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const slicebugRoot = path.join(repoRoot, "vendor", "slicebug");
const outputDir = path.join(desktopRoot, "resources", "slicebug");
const venvDir = path.join(slicebugRoot, ".kindcut-build-venv");
const usvgDownloads = {
  darwin: {
    url: "https://github.com/linebender/resvg/releases/download/v0.27.0/usvg-macos-x86_64.zip",
    sha256: "48c0ca0fbe0a7e195c84545a6924a7aec526070a98facc5c54829620d8e49887",
    member: "usvg",
  },
  win32: {
    url: "https://github.com/linebender/resvg/releases/download/v0.27.0/usvg-win64.zip",
    sha256: "fc30023106bc846ba43713a620b638a04cae761a9fa899b7bd31f4ef9236b96d",
    member: "usvg.exe",
  },
};

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
  const isCompatible = (version) => {
    if (version.major !== 3) return false;
    if (process.platform === "win32") return version.minor === 10;
    return version.minor <= 11;
  };

  for (const candidate of preferred) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const version = getPythonVersion(candidate);
    if (!version) continue;
    if (isCompatible(version)) {
      return { command: candidate, version };
    }
  }

  const found = preferred
    .map((candidate) => ({ candidate, version: getPythonVersion(candidate) }))
    .filter((entry) => entry.version)
    .map((entry) => `${entry.candidate} (${entry.version.label})`)
    .join(", ");
  throw new Error(
    `SliceBug's cx_Freeze pin needs ${process.platform === "win32" ? "Python 3.10 on Windows" : "Python 3.10 or 3.11"}. ` +
      `Found: ${found || "no usable Python"}. ` +
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

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
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

async function bundleUsvg() {
  const info = usvgDownloads[process.platform];
  if (!info) {
    console.log(`Skipping bundled usvg: no pinned download for ${process.platform}.`);
    return;
  }

  const usvgDir = path.join(outputDir, "plugins", "usvg");
  const zipPath = path.join(outputDir, "plugins", "usvg.zip");
  fs.mkdirSync(usvgDir, { recursive: true });

  console.log(`Downloading bundled usvg for ${process.platform}...`);
  const zipBytes = await download(info.url);
  const actual = crypto.createHash("sha256").update(zipBytes).digest("hex");
  if (actual !== info.sha256) {
    throw new Error(`usvg checksum mismatch. Expected ${info.sha256}, saw ${actual}.`);
  }

  fs.writeFileSync(zipPath, zipBytes);
  run(venvPythonPath(), [
    "-c",
    [
      "import os, stat, sys, zipfile",
      "zip_path, member, out_dir = sys.argv[1:]",
      "with zipfile.ZipFile(zip_path) as z:",
      "    z.extract(member, out_dir)",
      "target = os.path.join(out_dir, member)",
      "if os.name != 'nt':",
      "    os.chmod(target, os.stat(target).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)",
    ].join("\n"),
    zipPath,
    info.member,
    usvgDir,
  ], { cwd: slicebugRoot });
  fs.rmSync(zipPath, { force: true });

  const usvgPath = path.join(usvgDir, info.member);
  if (!fs.existsSync(usvgPath)) {
    throw new Error(`Expected bundled usvg at ${usvgPath}, but it was not created.`);
  }
  console.log(`Bundled usvg ready: ${usvgPath}`);
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
run(venvPython, ["-m", "pip", "install", "lief>=0.12.0,<0.13"]);

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

bundleUsvg().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
