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

function runQuiet(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || slicebugRoot,
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message || error.name;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function downloadToFile(url, targetPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }

    const request = https.get(url, { headers: { "User-Agent": "KindCut-release-builder" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectedUrl = new URL(response.headers.location, url).toString();
        downloadToFile(redirectedUrl, targetPath, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }
      const file = fs.createWriteStream(targetPath);
      response.pipe(file);
      response.on("error", (error) => {
        file.destroy(error);
      });
      file.on("error", (error) => {
        fs.rmSync(targetPath, { force: true });
        reject(error);
      });
      file.on("finish", () => {
        file.close(() => resolve());
      });
    });

    request.setTimeout(60_000, () => {
      request.destroy(new Error(`Download timed out for ${url}`));
    });
    request.on("error", reject);
  });
}

async function downloadWithRetries(url, targetPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await downloadToFile(url, targetPath);
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(targetPath, { force: true });
      console.warn(`Download attempt ${attempt} failed: ${formatError(error)}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  console.warn("Falling back to curl for bundled usvg download.");
  const curl = spawnSync("curl", [
    "--fail",
    "--location",
    "--retry",
    "3",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "30",
    "--output",
    targetPath,
    url,
  ], {
    cwd: desktopRoot,
    stdio: "inherit",
    shell: false,
  });

  if (curl.status !== 0) {
    fs.rmSync(targetPath, { force: true });
    throw new Error(`Could not download bundled usvg. Last Node error: ${formatError(lastError)}`);
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

function rewriteMacPythonInstallName(helperPath) {
  if (process.platform !== "darwin") {
    return;
  }

  const bundledPythonPath = path.join(outputDir, "lib", "Python");
  if (!fs.existsSync(bundledPythonPath)) {
    throw new Error(`Expected bundled Python library at ${bundledPythonPath}`);
  }

  const linkedLibraries = runQuiet("otool", ["-L", helperPath]);
  if (linkedLibraries.status !== 0) {
    throw new Error(`Could not inspect SliceBug helper libraries: ${linkedLibraries.stderr || linkedLibraries.stdout}`);
  }

  const pythonFramework = linkedLibraries.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .find((dependency) => /Python\.framework\/Versions\/[^/]+\/Python$/.test(dependency));

  if (!pythonFramework) {
    console.log("SliceBug helper does not reference a Python framework install name.");
    return;
  }

  const bundledInstallName = "@executable_path/lib/Python";
  console.log(`Rewriting SliceBug Python install name: ${pythonFramework} -> ${bundledInstallName}`);
  run("install_name_tool", ["-change", pythonFramework, bundledInstallName, helperPath], { cwd: desktopRoot });
  run("install_name_tool", ["-id", bundledInstallName, bundledPythonPath], { cwd: desktopRoot });
  run("codesign", ["--force", "--sign", "-", bundledPythonPath], { cwd: desktopRoot });
  run("codesign", ["--force", "--sign", "-", helperPath], { cwd: desktopRoot });
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
  await downloadWithRetries(info.url, zipPath);
  const zipBytes = fs.readFileSync(zipPath);
  console.log(`Downloaded bundled usvg archive (${zipBytes.length} bytes).`);
  const actual = crypto.createHash("sha256").update(zipBytes).digest("hex");
  if (actual !== info.sha256) {
    throw new Error(`usvg checksum mismatch. Expected ${info.sha256}, saw ${actual}.`);
  }

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

rewriteMacPythonInstallName(helperPath);

console.log(`Bundled SliceBug runtime ready: ${helperPath}`);

bundleUsvg().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
