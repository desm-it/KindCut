const path = require('node:path');
const { runNpm } = require('./run-platform-tests.cjs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
try {
  runNpm(['run', 'build:shell', '--workspace', '@cricut-companion/desktop'], root);
  const result = spawnSync(
    process.execPath,
    ['apps/desktop/scripts/test-compiled-host-output.cjs'],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
