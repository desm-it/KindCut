/* REAL SDK + COMPILED MAIN with an explicit inert framed peer. NO DEVICE I/O.
 * Synthetic connection/calibration are test inputs, never compatibility proof.
 */
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '../../..'),
  main = path.join(repo, 'apps/desktop/dist/main');
const { NativeJoyService } = require(path.join(main, 'native-joy-service.js'));
const { NativeJoyJobService } = require(path.join(main, 'native-joy-job-service.js'));
const { NativeJoyJobJournal } = require(path.join(main, 'native-joy-job-journal.js'));
const { JoyRuntimeClient } = require(path.join(main, 'joy-runtime-client.js'));
const { emptyLibrary } = require(path.join(main, 'joy-configuration-store.js'));
const data = require('./configuration.synthetic.json');
const out = path.resolve(process.argv[2] || '');
assert(process.argv[2] && path.isAbsolute(out));
const dummy = '01:02:03:04:05:06',
  fingerprint = createHash('sha256').update(dummy).digest('hex');
const source = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M50 50 L80 50 L80 80"/></svg>',
  materialId: 1,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: { '#112233': { tool: 'pen', operation: 'draw' } },
};
const lib = {
  ...emptyLibrary(),
  selection: { profileId: 'p', calibrationId: 'c' },
  profiles: [
    {
      id: 'p',
      name: 'SYNTHETIC pen',
      provenance: 'inert_fixture_not_a_material_preset',
      settings: {
        ...data.settings,
        profileId: 'p',
        materialId: 1,
        tool: 'pen',
        operation: 'draw',
        mode: 'precision',
        pressureRequest: 180,
      },
      recipe: {
        catalogId: 'synthetic',
        sourceMaterialId: 1,
        workspaceMaterialName: 'SYNTHETIC',
        passCount: 2,
        pressureRequests: [180, 200],
      },
    },
  ],
  calibrations: [
    {
      id: 'c',
      capturedAt: '2026-01-01T00:00:00.000Z',
      deviceFingerprint: fingerprint,
      firmwareSelector: 8.164000001,
      source: 'imported_unverified',
      physicalCalibrationVerified: false,
      pressureResponsesHex: data.rows,
    },
  ],
};
const penSource = source,
  penLib = lib,
  cutPolicy = require('../src/shell/joy-blade-trial-policy.json');
const bladeSource = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M75.59055118110237 75.59055118110237 L151.18110236220474 75.59055118110237 L151.18110236220474 151.18110236220474 L75.59055118110237 151.18110236220474 Z"/></svg>',
  materialId: 211,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: { '#112233': { tool: 'fine_point_blade', operation: 'cut' } },
};
const bladeLib = {
  ...structuredClone(lib),
  profiles: [
    {
      id: 'p',
      name: 'Source-backed restricted blade preset / SYNTHETIC calibration',
      provenance: 'inert_fixture_not_hardware_validation',
      settings: { ...structuredClone(cutPolicy.settings), profileId: 'p' },
      recipe: {
        catalogId: 'cached-joy-211-2',
        sourceMaterialId: 211,
        workspaceMaterialName: 'Heavy Cardstock - 100 lb (270 gsm)',
        passCount: 3,
        pressureRequests: [223, 223, 223],
      },
    },
  ],
};
const combinedSource = {
  ...bladeSource,
  svg: bladeSource.svg.replace(
    '</svg>',
    '<path fill="none" stroke="#445566" d="M200 200 L230 200"/></svg>',
  ),
  strokeTools: { ...bladeSource.strokeTools, '#445566': { tool: 'pen', operation: 'draw' } },
};
const combinedLib = {
  ...structuredClone(lib),
  profiles: [
    {
      ...structuredClone(lib.profiles[0]),
      settings: {
        ...structuredClone(lib.profiles[0].settings),
        materialId: 211,
        pressureRequest: 100,
      },
      recipe: {
        catalogId: 'synthetic-pen',
        sourceMaterialId: 211,
        workspaceMaterialName: 'SYNTHETIC same material',
        passCount: 1,
        pressureRequests: [100],
      },
    },
    {
      ...structuredClone(bladeLib.profiles[0]),
      id: 'b',
      settings: { ...structuredClone(bladeLib.profiles[0].settings), profileId: 'b' },
    },
  ],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(service, predicate) {
  const end = Date.now() + 8000;
  let state;
  do {
    state = await service.status();
    if (predicate(state)) return state;
    await sleep(15);
  } while (Date.now() < end);
  throw Error('Inert job did not reach expected phase');
}
const generalBladePaths =
  '<path fill="none" stroke="#112233" d="M70 70 L140 80 L120 140 L70 130 Z"/><path fill="none" stroke="#112233" d="M180 100 C190 80 220 80 230 100 L230 150 L180 150 Z M195 110 L200 130 L210 110 Z"/><path fill="none" stroke="#112233" d="M260 100 L290 140"/>';
const generalPenPaths =
  '<path fill="none" stroke="#445566" d="M70 200 L140 200"/><path fill="none" stroke="#445566" d="M180 200 C190 180 220 180 230 200"/>';
async function run(
  name,
  approved,
  queuePause = false,
  cancelPaused = false,
  nextAction = false,
  cutTrial = false,
  combined = false,
  general = false,
  connectedFirst = false,
) {
  const source = general
      ? {
          ...combinedSource,
          svg:
            '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152">' +
            generalBladePaths +
            (combined ? generalPenPaths : '') +
            '</svg>',
        }
      : combined
        ? combinedSource
        : cutTrial
          ? bladeSource
          : penSource,
    lib = combined ? combinedLib : cutTrial ? bladeLib : penLib,
    expectedPasses = combined ? 1 : cutTrial ? 3 : 2;
  let approveTool = !cutTrial,
    finalPreview;
  const dir = await fs.mkdtemp(path.join(out, name + '-'));
  await fs.chmod(dir, 0o700);
  let n = 0;
  let approveResume = false,
    approveEnd = false,
    loadApprovals = 0;
  const receipts = [];
  const native = new NativeJoyService({
    platform: 'darwin',
    enabled: true,
    runtimePath: path.join(
      repo,
      'packages/joy-runtime/dist/kindcut-joy-runtime/kindcut-joy-runtime',
    ),
    store: {
      exists: async () => false,
      save: async () => {
        throw Error('NO STORE WRITES');
      },
      load: async () => {
        throw Error('NO SECRET READS');
      },
    },
    clientFactory: () => {
      const receipt = path.join(dir, `sdk-receipt-${++n}.json`);
      receipts.push(receipt);
      return new JoyRuntimeClient({
        executable: path.join(repo, 'packages/joy-runtime/.venv/bin/python'),
        args: [
          path.join(repo, 'apps/desktop/native-tests/job-inert-worker.py'),
          receipt,
          ...(queuePause ? ['--hold-first-data'] : []),
        ],
      });
    },
  });
  const journal = new NativeJoyJobJournal(path.join(dir, 'journal'));
  const service = new NativeJoyJobService({
    loadLibrary: async () => structuredClone(lib),
    native,
    legacyBusy: () => false,
    confirmLoad: async () => {
      loadApprovals++;
      return approved;
    },
    confirmTool: async () => approved && approveTool,
    confirmResume: async () => approveResume,
    confirmEnd: async () => approveEnd,
    journal,
    pollMs: false,
  });
  try {
    if (connectedFirst)
      await native.connect({ address: dummy, hardwareApproved: true, cryptoResetApproved: true });
    const preview = await service.prepare({ profileId: 'p', calibrationId: 'c', source });
    assert.equal(preview.passCount, expectedPasses);
    assert.deepEqual(
      preview.pressureRequests,
      combined ? [100] : cutTrial ? [223, 223, 223] : [180, 200],
    );
    finalPreview = preview;
    if (combined) {
      assert.equal(preview.workflow.actionCount, 2);
      assert(preview.workflow.containsBlade);
      assert.deepEqual(
        preview.workflow.actions.map((a) => a.tool),
        ['pen', 'fine_point_blade'],
      );
    }
    assert(!JSON.stringify(preview).includes('pressureResponsesHex'));
    if (!connectedFirst)
      await native.connect({ address: dummy, hardwareApproved: true, cryptoResetApproved: true });
    const initial = await service.start({ jobId: preview.jobId, source });
    if (!approved) {
      assert.deepEqual(initial, { canceled: true });
      await native.disconnect();
      for (const receipt of receipts) {
        const r = JSON.parse(await fs.readFile(receipt));
        assert.equal(r.transportsOpened, 0);
        assert.equal(r.packets.length, 0);
      }
      return { name, passed: true, synthetic: true, deniedLoadSentNoFrames: true };
    }
    assert.equal(initial.phase, 'loading_and_aligning');
    const ready = await wait(service, (s) => s.phase === 'waiting_for_go');
    assert.equal(ready.jobStarted, false);
    if (cutTrial) {
      assert.equal(preview.tool, 'fine_point_blade');
      assert.deepEqual(await service.go(), { canceled: true });
      const waiting = await service.status();
      assert.equal(waiting.jobStarted, false);
      assert.equal(waiting.acceptedRecords, 0);
      assert(!(await journal.readLatest()).events.some((e) => e.stage === 'sending'));
      approveTool = true;
    }
    await service.go();
    if (queuePause) {
      const receipt = receipts.at(-1);
      const entered = receipt + '.ack-entered';
      const deadline = Date.now() + 1500;
      while (true) {
        try {
          await fs.stat(entered);
          break;
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
        assert(Date.now() < deadline, 'inert first ACK was not reached');
        await sleep(2);
      }
      await wait(service, (s) => s.jobStarted && s.phase === 'sending');
      await service.pause();
      await fs.writeFile(receipt + '.release-ack', 'SYNTHETIC release\n');
      const paused = await wait(service, (s) => s.phase === 'paused');
      assert(paused.active && paused.jobStarted);
      assert.equal(paused.motionStoppedVerified, false);
      const saved = await journal.readLatest(),
        newReader = new NativeJoyJobJournal(journal.directory),
        observation = await newReader.recoveryInfo();
      assert.equal(observation.status, 'interrupted');
      assert.equal(observation.canResume, false);
      assert.equal(observation.machineState, 'unknown');
      assert.deepEqual(await journal.readLatest(), saved);
      const denied = await service.resume();
      assert.equal(denied.canceled, true);
      assert.equal((await service.status()).phase, 'paused');
      if (cancelPaused) await service.cancel();
      else {
        approveResume = true;
        await service.resume();
      }
    }
    let retainedChecks = null,
      firstReport = null;
    if (!cancelPaused) {
      const held = await wait(service, (s) => s.phase === 'retained_ready');
      assert(held.active && !held.sessionRetired);
      assert.equal(held.acceptedRecords, preview.recordCount);
      assert.equal(held.completedPasses, expectedPasses);
      assert.equal(held.returnToOrigin, 'protocol_complete');
      assert.equal(native.ownsHardware, true);
      if (cutTrial) {
        await assert.rejects(service.pause());
        await assert.rejects(service.resume());
        await assert.rejects(service.prepare({ profileId: 'p', calibrationId: 'c', source }));
        assert.equal((await service.status()).phase, 'retained_ready');
      }
      firstReport = await journal.readLatest();
      assert(
        !firstReport.events.some((e) => ['aborting', 'disarming', 'closing'].includes(e.stage)),
      );
      const count = firstReport.totalEvents;
      await sleep(120);
      await service.status();
      assert.equal(
        (await journal.readLatest()).totalEvents,
        count,
        'idle retention emitted commands or growing events',
      );
      assert.deepEqual(await service.end(), { canceled: true });
      assert.equal((await service.status()).phase, 'retained_ready');
      if (nextAction || combined) {
        if (!combined) {
          const wrong = { ...source, mat: { ...source.mat, heightIn: 6.5 } };
          await assert.rejects(
            service.prepare({ profileId: 'p', calibrationId: 'c', source: wrong }),
          );
        }
        const nextSource = combined
          ? source
          : {
              ...source,
              svg: source.svg.replace('M50 50 L80 50 L80 80', 'M100 90 L140 90 L140 130'),
            };
        if (!combined) service.invalidate();
        const p = await service.prepare({ profileId: 'p', calibrationId: 'c', source: nextSource });
        assert.notEqual(p.programDigest, preview.programDigest);
        finalPreview = p;
        if (combined) {
          assert.equal(p.tool, 'fine_point_blade');
          assert.equal(p.workflow.actionIndex, 1);
        }
        const armed = await service.start({ jobId: p.jobId, source: nextSource });
        assert(armed.operationId > held.operationId);
        assert.equal(armed.phase, 'waiting_for_go');
        assert.equal(armed.jobStarted, false);
        assert.equal(armed.acceptedRecords, 0);
        await sleep(60);
        await service.status();
        assert(
          !(await journal.readLatest()).events.some(
            (e) => e.txHex && Buffer.from(e.txHex, 'hex')[2] === 0x43,
          ),
          'next action sent data before fresh Go',
        );
        if (combined) {
          approveTool = false;
          assert.deepEqual(await service.go(), { canceled: true });
          assert(!(await journal.readLatest()).events.some((e) => e.stage === 'sending'));
          approveTool = true;
        }
        await service.go();
        const second = await wait(service, (s) => s.phase === 'retained_ready');
        assert.equal(second.acceptedRecords, p.recordCount);
        assert.equal(second.completedPasses, combined ? 3 : 2);
        assert.equal(second.returnToOrigin, 'protocol_complete');
        assert.equal(loadApprovals, 1);
        const savedFirst = JSON.parse(
          await fs.readFile(path.join(journal.directory, 'job-' + firstReport.reportId + '.json')),
        );
        assert.deepEqual(savedFirst, firstReport, 'new report overwrote prior action');
      }
      approveEnd = true;
      await service.end();
      retainedChecks = {
        noAutomaticCleanup: true,
        idleEmittedNoCommands: true,
        endDenialKeptMatSession: true,
        normalCompletionHeldUntilExplicitEnd: true,
        nextAction: nextAction || combined,
        loadApprovals,
      };
    }
    const final = await wait(service, (s) => !s.active);
    assert.equal(final.phase, cancelPaused ? 'cancelled' : 'completed');
    if (!cancelPaused) {
      assert.equal(final.acceptedRecords, finalPreview.recordCount);
      assert.equal(final.completedPasses, finalPreview.passCount);
    }
    assert.equal(final.physicalCompletionVerified, false);
    assert.equal(final.motionStoppedVerified, false);
    assert.equal(native.ownsHardware, false);
    const report = await journal.readLatest();
    assert.equal(report.jobStarted, true);
    assert.equal(report.completeCapture, true);
    assert.deepEqual(report.gaps, []);
    assert.equal(report.events.length, report.totalEvents);
    const restarted = new NativeJoyJobJournal(journal.directory),
      history = await restarted.restoreTerminalState();
    assert.equal(history.historical, true);
    assert.equal(history.active, false);
    assert.equal(history.jobStarted, true);
    const exported = path.join(dir, 'SYNTHETIC-job-export.json');
    await journal.exportTo(exported);
    const readback = JSON.parse(await fs.readFile(exported));
    assert.deepEqual(readback, report);
    const allReceipts = await Promise.all(
      receipts.map(async (p) => JSON.parse(await fs.readFile(p))),
    );
    const activeReceipts = allReceipts.filter((r) => r.packets.length);
    assert.equal(activeReceipts.length, 1, 'multiple I/O owners or reload spawned');
    const receipt = activeReceipts[0];
    assert.equal(receipt.transportsOpened, 0);
    assert.equal(receipt.calibrationOrSecretsRead, false);
    assert.equal(receipt.sessionClosed, true);
    const ops = receipt.packets.map((h) => Buffer.from(h, 'hex')[2]);
    assert(ops.includes(0x43) && ops.includes(0x73));
    assert.equal(ops.filter((x) => x === 0x11).length, 1, 'mat loading dimensions repeated');
    if (nextAction || combined) {
      const a = firstReport.events
        .filter((e) => e.txHex && Buffer.from(e.txHex, 'hex')[2] === 0x43)
        .map((e) => e.txHex);
      const b = report.events
        .filter((e) => e.txHex && Buffer.from(e.txHex, 'hex')[2] === 0x43)
        .map((e) => e.txHex);
      assert.notDeepEqual(a, b);
      assert.deepEqual(
        receipt.packets.filter((h) => Buffer.from(h, 'hex')[2] === 0x43),
        a.concat(b),
        'replayed or omitted action geometry',
      );
    }
    return {
      name,
      passed: true,
      synthetic: true,
      notice: 'INERT PEER; real SDK worker/retained-loader/executor + compiled main/stdio/journal',
      queuePause,
      cancelPaused,
      cutTrial,
      combined,
      originReturnProtocolComplete: final.returnToOrigin === 'protocol_complete',
      cutGoDenialChecked: cutTrial || combined,
      geometryAndFullSavedRecipePreserved: cutTrial || combined,
      generalNonSquareCurveAndCompoundPaths: general,
      connectedBeforePreparation: connectedFirst,
      retainedChecks,
      resumeDenialChecked: queuePause,
      passes: final.completedPasses,
      records: final.acceptedRecords,
      events: report.totalEvents,
      completeCapture: report.completeCapture,
      reportDirectory: journal.directory,
      exportPath: exported,
      physicalCompletionVerified: false,
      transportOrSecretsOpened: false,
    };
  } finally {
    service.dispose();
    await native.disconnect();
  }
}
(async () => {
  await fs.mkdir(out, { recursive: true, mode: 0o700 });
  const results = [];
  for (const [name, approval, pause, cancel, next, cutTrial, combined, general, connectedFirst] of [
    ['multipass_pen_success', true],
    ['denied_load', false],
    ['queue_pause_resume', true, true, false],
    ['queue_pause_cancel', true, true, true],
    ['retained_two_distinct_actions', true, false, false, true],
    ['restricted_blade_square', true, false, false, false, true],
    ['restricted_blade_denied_load', false, false, false, false, true],
    ['combined_pen_cut_one_load_two_returns', true, false, false, false, false, true],
    ['combined_denied_load', false, false, false, false, false, true],
    ['general_multiple_blade_paths', true, false, false, false, true, false, true],
    ['general_pen_then_blade_5_paths', true, false, false, false, false, true, true],
    ['connected_first_general_combined', true, false, false, false, false, true, true, true],
  ])
    results.push(
      await run(name, approval, pause, cancel, next, cutTrial, combined, general, connectedFirst),
    );
  console.log(JSON.stringify({ passed: true, synthetic: true, cases: results }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
