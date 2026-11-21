const path = require('node:path'),
  fs = require('node:fs'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') {
  console.log(
    'Frozen original-Joy artifact matrix is macOS-only; portable runtime tests still run in npm test.',
  );
} else {
  const output = fs.mkdtempSync(
    path.join(process.env.TMPDIR || require('node:os').tmpdir(), 'kindcut-sdk-matrix-'),
  );
  const result = spawnSync(
    process.execPath,
    ['apps/desktop/native-tests/verify-native-card-vinyl.cjs', output],
    { cwd: root, env: process.env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
