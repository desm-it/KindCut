#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const resourceRoot = path.join(desktopRoot, "resources", "slicebug");
const platform = process.platform;
const executableSuffix = platform === "win32" ? ".exe" : "";
const slicebugPath = path.join(resourceRoot, `slicebug${executableSuffix}`);
const usvgPath = path.join(resourceRoot, "plugins", "usvg", `usvg${executableSuffix}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    fail(`Expected ${label} to be a file: ${filePath}`);
  }
}

function assertMagic(filePath, label) {
  const header = fs.readFileSync(filePath, { encoding: null, flag: "r" }).subarray(0, 4);
  if (platform === "win32") {
    if (header[0] !== 0x4d || header[1] !== 0x5a) {
      fail(`${label} is not a Windows PE executable: ${filePath}`);
    }
    return;
  }

  if (platform === "darwin") {
    const magic = header.toString("hex");
    const machoMagics = new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca"]);
    if (!machoMagics.has(magic)) {
      fail(`${label} is not a Mach-O executable: ${filePath}`);
    }
  }
}

function assertMacBundledPythonInstallName(filePath) {
  if (platform !== "darwin") {
    return;
  }

  const libraries = spawnSync("otool", ["-L", filePath], { encoding: "utf8" });
  if (libraries.status !== 0) {
    fail(`Could not inspect ${filePath} with otool: ${(libraries.stderr || libraries.stdout || "").trim()}`);
  }

  const output = libraries.stdout || "";
  if (output.includes("/Library/Frameworks/Python.framework/")) {
    fail("SliceBug helper links to a system Python framework instead of the bundled Python library.");
  }
  if (!output.includes("@executable_path/lib/Python")) {
    fail("SliceBug helper does not link to @executable_path/lib/Python.");
  }
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function assertWindowsRuntimeLayout() {
  if (platform !== "win32") {
    return;
  }

  const pythonDll = path.join(resourceRoot, "python310.dll");
  assertFile(pythonDll, "bundled Windows Python DLL");
  assertFile(path.join(resourceRoot, "lib", "library.zip"), "bundled Python library archive");

  const invalidFiles = walkFiles(resourceRoot).filter((filePath) => {
    const fileName = path.basename(filePath).toLowerCase();
    return (
      filePath.endsWith(".dylib") ||
      filePath.endsWith(".so") ||
      fileName === "python" ||
      fileName === "slicebug"
    );
  });

  if (invalidFiles.length > 0) {
    fail(`Windows SliceBug bundle contains non-Windows runtime files:\n${invalidFiles.join("\n")}`);
  }
}

function assertSlicebugStarts() {
  const result = spawnSync(slicebugPath, ["--help"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    fail(`Bundled SliceBug helper did not start: ${(result.stderr || result.stdout || "").trim()}`);
  }

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (!/usage:\s*slicebug/i.test(output)) {
    fail(`Bundled SliceBug helper produced unexpected help output: ${output.trim() || "<empty>"}`);
  }
}

assertFile(slicebugPath, "SliceBug helper");
assertFile(usvgPath, "usvg helper");
assertMagic(slicebugPath, "SliceBug helper");
assertMagic(usvgPath, "usvg helper");
assertMacBundledPythonInstallName(slicebugPath);
assertWindowsRuntimeLayout();
assertSlicebugStarts();

const version = spawnSync(usvgPath, ["--version"], { encoding: "utf8", windowsHide: true });
if (version.status !== 0) {
  fail(`Bundled usvg did not run: ${(version.stderr || version.stdout || "").trim()}`);
}

const output = `${version.stdout || ""}${version.stderr || ""}`.trim();
if (output !== "0.27.0") {
  fail(`Expected bundled usvg 0.27.0, saw: ${output || "<empty>"}`);
}

console.log(`Verified bundled SliceBug runtime for ${platform}: ${resourceRoot}`);
