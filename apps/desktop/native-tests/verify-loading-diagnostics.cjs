/* Real owned SDK/worker fixture -> compiled trusted-main schema/journal/export.
 * Inputs MUST be labeled SYNTHETIC. Never connects to any hardware or reads keys.
 */
'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { readLoadingDiagnostics } = require(
  path.join(root, 'apps/desktop/dist/main/native-joy-loading-diagnostics.js'),
);
const { NativeJoyLoadingJournal } = require(
  path.join(root, 'apps/desktop/dist/main/native-joy-loading-journal.js'),
);
(async () => {
  const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8')),
    out = path.resolve(process.argv[3]);
  assert.equal(input.synthetic, true);
  assert.equal(input.cases.length, 2);
  const results = [];
  for (const test of input.cases) {
    assert.equal(test.synthetic, true);
    assert.match(test.name, /^[a-z_]+$/);
    const directory = path.join(out, test.name, 'native-joy', 'diagnostics'),
      journal = new NativeJoyLoadingJournal(directory);
    await journal.prepare(12);
    for (const raw of test.states) {
      const diagnostics = readLoadingDiagnostics(raw.diagnostics, raw.operationId);
      await journal.record({ ...raw, diagnostics });
    }
    const reloaded = new NativeJoyLoadingJournal(directory),
      report = await reloaded.readLatest();
    assert.equal(report.completeCapture, true);
    assert.equal(report.failure.stage, 'query_precheck');
    assert.equal(report.phase, 'failed');
    assert.deepEqual(
      report.events
        .filter((e) => ['exchange', 'cleanup'].includes(e.kind) && e.txHex !== null)
        .map((e) => e.txHex),
      test.expectedSentHex,
    );
    const file = path.join(out, `${test.name}-SYNTHETIC-export.json`);
    await reloaded.exportTo(file);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), report);
    const restored = await reloaded.restoreTerminalState();
    assert.equal(restored.historical, true);
    assert.equal(restored.active, false);
    assert.equal(restored.jobStarted, false);
    results.push({
      name: test.name,
      events: report.events.length,
      completeCapture: report.completeCapture,
      reportDirectory: directory,
      exportPath: file,
      firstFailure: report.failure,
    });
  }
  const summary = {
    passed: true,
    synthetic: true,
    notice: 'INERT SDK + COMPILED NODE REPLAY; NO DEVICE TRAFFIC',
    cases: results,
    hardwareOrSecretsAccess: false,
  };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(summary, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(JSON.stringify(summary));
})().catch((error) => {
  console.error(
    'Inert loading diagnostic verification failed; no hardware was used.',
    error.name,
    error.message,
  );
  process.exitCode = 1;
});
