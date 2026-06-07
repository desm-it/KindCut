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

assertFile(slicebugPath, "SliceBug helper");
assertFile(usvgPath, "usvg helper");
assertMagic(slicebugPath, "SliceBug helper");
assertMagic(usvgPath, "usvg helper");

const version = spawnSync(usvgPath, ["--version"], { encoding: "utf8", windowsHide: true });
if (version.status !== 0) {
  fail(`Bundled usvg did not run: ${(version.stderr || version.stdout || "").trim()}`);
}

const output = `${version.stdout || ""}${version.stderr || ""}`.trim();
if (output !== "0.27.0") {
  fail(`Expected bundled usvg 0.27.0, saw: ${output || "<empty>"}`);
}

console.log(`Verified bundled SliceBug runtime for ${platform}: ${resourceRoot}`);
