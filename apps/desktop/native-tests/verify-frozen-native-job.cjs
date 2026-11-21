/* Actual frozen worker: offline compilation, idle status, denied admission only.
 * Synthetic pressure input is not bundled configuration or physical evidence.
 */
const assert = require('node:assert/strict'),
  path = require('node:path');
const repo = path.resolve(__dirname, '../../..'),
  main = path.join(repo, 'apps/desktop/dist/main');
const { JoyRuntimeClient } = require(path.join(main, 'joy-runtime-client.js'));
const { readJobMetadata, readJobState } = require(path.join(main, 'native-joy-job-types.js'));
const { compileNormalizedSvgForJoy } = require(path.join(main, 'vendor/native-joy-svg.cjs'));
const f = require('./configuration.synthetic.json');
const runtime = process.env.KINDCUT_VERIFY_RUNTIME;
assert(runtime && path.isAbsolute(runtime));
const plan = compileNormalizedSvgForJoy(
  '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M50 50 L80 50"/></svg>',
  {
    materialId: 1,
    mat: { widthIn: 4.5, heightIn: 12 },
    strokeTools: { '#112233': { tool: 'pen', operation: 'draw' } },
    boundsPolicy: 'clip',
  },
);
const settings = {
  ...f.settings,
  profileId: 'p',
  materialId: 1,
  tool: 'pen',
  operation: 'draw',
  mode: 'precision',
  pressureRequest: 180,
};
(async () => {
  const c = new JoyRuntimeClient({ executable: runtime });
  try {
    const initial = readJobState(await c.request({ op: 'job', action: 'status' }));
    assert.equal(initial.phase, 'idle');
    assert.equal(initial.jobStarted, false);
    const metadata = readJobMetadata(
      await c.request(
        {
          op: 'configuration',
          action: 'prepare_job',
          plan,
          settings,
          pressureResponsesHex: f.rows,
          pressureRequests: [180, 200],
        },
        15000,
      ),
    );
    assert.equal(metadata.passCount, 2);
    assert.deepEqual(metadata.pressureRequests, [180, 200]);
    assert.equal(metadata.physicalCalibrationVerified, false);
    const request = {
      op: 'job',
      action: 'start',
      plan,
      settings,
      pressureResponsesHex: f.rows,
      pressureRequests: [180, 200],
      programDigest: metadata.programDigest,
      motionApproved: true,
      bladeRemovedConfirmed: true,
      timeout: 30,
      jobTimeout: 60,
    };
    let denied = false;
    try {
      await c.request(request, 5000);
    } catch {
      denied = true;
    }
    assert(denied, 'No session must reject before loading or job I/O');
    await c.close();
    assert.equal(c.isRunning, false);
    console.log(
      JSON.stringify({
        passed: true,
        actualFrozenWorker: true,
        initialPhase: initial.phase,
        passesPreserved: metadata.passCount,
        records: metadata.recordCount,
        sourceProgramCompiledWithoutSession: true,
        absentSessionAdmissionDenied: true,
        processRetired: true,
        hardwareAccess: false,
        physicalCompletionVerified: false,
        scope: 'offline compilation + idle + denied admission only; no discovery/connection/motion',
      }),
    );
  } finally {
    await c.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
