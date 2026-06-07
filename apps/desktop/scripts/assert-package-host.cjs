#!/usr/bin/env node
const target = process.argv[2];

const expectedPlatforms = {
  mac: "darwin",
  win: "win32",
};

if (!target || !expectedPlatforms[target]) {
  console.error("Usage: node scripts/assert-package-host.cjs <mac|win>");
  process.exit(1);
}

const expected = expectedPlatforms[target];
if (process.platform === expected) {
  process.exit(0);
}

if (process.env.KINDCUT_ALLOW_CROSS_PACKAGE === "1") {
  console.warn(
    `Cross-packaging ${target} from ${process.platform}. This can build the Electron shell, but bundled SliceBug helpers may be wrong.`,
  );
  process.exit(0);
}

console.error(
  [
    `Refusing to package ${target} on ${process.platform}.`,
    "KindCut bundles a frozen SliceBug Python runtime, and that runtime must be built on the target OS.",
    "Use GitHub Actions or a native machine for release builds.",
    "Set KINDCUT_ALLOW_CROSS_PACKAGE=1 only for deliberate shell-only experiments.",
  ].join("\n"),
);
process.exit(1);
