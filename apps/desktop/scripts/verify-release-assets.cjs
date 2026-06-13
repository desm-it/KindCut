const fs = require("node:fs");
const path = require("node:path");

const releaseDir = path.resolve(__dirname, "..", "release");

function readReleaseFiles() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release directory does not exist: ${releaseDir}`);
  }
  return new Set(fs.readdirSync(releaseDir));
}

function extractReferencedAssets(ymlText) {
  const assets = [];
  for (const line of ymlText.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/);
    if (!match) continue;
    const value = match[1].replace(/^['"]|['"]$/g, "");
    if (/^https?:\/\//i.test(value)) continue;
    assets.push(path.basename(value));
  }
  return Array.from(new Set(assets));
}

const releaseFiles = readReleaseFiles();
const metadataFiles = ["latest.yml", "latest-mac.yml"].filter((fileName) => releaseFiles.has(fileName));

if (metadataFiles.length === 0) {
  throw new Error(`No latest.yml or latest-mac.yml found in ${releaseDir}`);
}

const missing = [];

for (const metadataFile of metadataFiles) {
  const metadataPath = path.join(releaseDir, metadataFile);
  const referencedAssets = extractReferencedAssets(fs.readFileSync(metadataPath, "utf8"));

  for (const asset of referencedAssets) {
    if (!releaseFiles.has(asset)) {
      missing.push(`${metadataFile} references ${asset}, but that file was not built`);
    }
  }
}

if (missing.length > 0) {
  throw new Error(`Release metadata references missing assets:\n${missing.join("\n")}`);
}

console.log(`Verified release metadata assets in ${releaseDir}`);
