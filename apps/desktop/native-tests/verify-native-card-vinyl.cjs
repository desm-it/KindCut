/* Prerelease matrix: compiled host + frozen offline compiler + actual SDK with INERT transport only. */
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '../../..'),
  main = path.join(repo, 'apps/desktop/dist/main'),
  out = path.resolve(process.argv[2] || '');
const syncFs = require('node:fs');
const temporaryRoot = syncFs.realpathSync(require('node:os').tmpdir());
const actualOutput = process.argv[2] && syncFs.realpathSync(out);
const relativeOutput = actualOutput && path.relative(temporaryRoot, actualOutput);
assert(
  process.argv[2] &&
    path.isAbsolute(process.argv[2]) &&
    relativeOutput &&
    relativeOutput !== '..' &&
    !relativeOutput.startsWith('..' + path.sep) &&
    !path.isAbsolute(relativeOutput) &&
    syncFs.statSync(actualOutput).isDirectory(),
  'An existing owned directory below TMPDIR is required.',
);
const { NativeJoyService } = require(main + '/native-joy-service.js'),
  { NativeJoyJobService } = require(main + '/native-joy-job-service.js'),
  { JoyConfigurationService } = require(main + '/joy-configuration-service.js'),
  { NativeJoyJobJournal } = require(main + '/native-joy-job-journal.js'),
  { JoyRuntimeClient } = require(main + '/joy-runtime-client.js'),
  { emptyLibrary } = require(main + '/joy-configuration-store.js');
const catalog = require('../src/shell/joy-material-catalog.json').materials,
  data = require('./configuration.synthetic.json');
const address = '01:02:03:04:05:06',
  fingerprint = createHash('sha256').update(address).digest('hex');
const frozen =
  process.env.KINDCUT_TEST_FROZEN_RUNTIME ||
  path.join(repo, 'packages/joy-runtime/dist/kindcut-joy-runtime/kindcut-joy-runtime');
assert(path.isAbsolute(frozen), 'The explicit test compiler path must be absolute.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const item = (color, cut = false) => ({
  id: 'shape-' + color,
  type: 'path',
  kind: 'shape',
  sourceKind: 'shape',
  fileName: 'inert-shape',
  fileSize: '0',
  sizeCopy: '40',
  frame: { width: 40, height: 40 },
  paths: [{ id: 'p', d: 'M0 0 L40 0 L20 40 Z', fill: 'none', stroke: color, strokeWidth: '1' }],
  transform: { x: 80, y: 80, scaleX: 1, scaleY: 1, rotation: 0 },
});
async function runCase(spec, build, normalize) {
  const dir = path.join(out, spec.name);
  await fs.mkdir(dir, { recursive: true });
  let lib = {
    ...emptyLibrary(),
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
  const receives = [],
    clients = [],
    frozenPlans = [];
  let first = true,
    approved = false,
    loads = 0;
  const native = new NativeJoyService({
    platform: 'darwin',
    enabled: true,
    runtimePath: frozen,
    store: {
      exists: async () => false,
      load: async () => {
        throw Error('NO SECRETS');
      },
      save: async () => {
        throw Error('NO SECRET WRITES');
      },
    },
    clientFactory: () => {
      const live = first;
      first = false;
      const receipt = path.join(dir, 'sdk-receipt.json');
      const c = new JoyRuntimeClient(
        live
          ? {
              executable: path.join(repo, 'packages/joy-runtime/.venv/bin/python'),
              args: [path.join(repo, 'apps/desktop/native-tests/job-inert-worker.py'), receipt],
            }
          : { executable: frozen },
      );
      clients.push(c);
      if (live) receives.push(receipt);
      const request = c.request.bind(c);
      c.request = (input, ...args) => {
        if (!live) {
          assert.equal(
            input.op,
            'configuration',
            'Frozen compiler MUST NOT receive hardware operations',
          );
          if (input.action === 'prepare_job') frozenPlans.push(structuredClone(input.plan));
        }
        return request(input, ...args);
      };
      return c;
    },
  });
  const configuration = new JoyConfigurationService({
    store: {
      load: async () => structuredClone(lib),
      transact: async (f) => {
        lib = await f(structuredClone(lib));
        return structuredClone(lib);
      },
    },
    offline: (r) => native.runOfflineConfiguration(r),
    capture: async () => {
      throw Error('NO CAPTURE');
    },
  });
  const journal = new NativeJoyJobJournal(dir + '/journal'),
    service = new NativeJoyJobService({
      native,
      loadLibrary: async () => structuredClone(lib),
      ensureMakeSelection: (id, tools) => configuration.ensureMakeSelection(id, tools),
      legacyBusy: () => false,
      confirmLoad: async () => {
        loads++;
        return true;
      },
      confirmTool: async () => approved,
      confirmEnd: async () => true,
      journal,
      pollMs: false,
    });
  const mat = spec.card
      ? { width: 4.5, height: 6.25 }
      : { width: 4.5, height: spec.long ? 12 : 6.5 },
    items = spec.slotsOnly
      ? []
      : [item('#2156a8'), ...(spec.insert ? [] : [item('#8f4f2b', true)])];
  const b = build({
    items,
    matPreset: spec.card ? 'joy-card' : spec.long ? 'joy-standard' : 'joy-standard-short',
    mat,
    tools: [
      { color: '#2156a8', type: 'pen' },
      { color: '#8f4f2b', type: 'cut' },
    ],
    materialId: spec.materialId,
    cardSize: spec.insert ? 'medium' : null,
    insertSlots: Boolean(spec.insert),
    behindColor: '#8f4f2b',
    colorMap: { '2156a8': 'pen', '8f4f2b': 'fine_point_blade' },
  });
  const source = { ...b.source, svg: normalize(b.source.svg, b.source.mat, b.source.strokeTools) };
  async function wait(phase) {
    for (let i = 0; i < 1000; i++) {
      const s = await service.status();
      if (s.phase === phase) return s;
      if (!s.active) throw Error(`Unexpected terminal phase ${s.phase}`);
      await sleep(3);
    }
    throw Error('Inert stage timeout');
  }
  try {
    await native.connect({ address, hardwareApproved: true, cryptoResetApproved: true });
    const firstPreview = await service.prepareAutomatic(source),
      count = firstPreview.workflow?.actionCount ?? 1,
      actions = [];
    assert.equal(frozenPlans.length, count);
    assert(frozenPlans.every((p) => JSON.stringify(p.mat) === JSON.stringify(source.mat)));
    if (spec.insert)
      assert.equal(
        frozenPlans.find((p) => p.groups[0].tool === 'fine_point_blade').groups[0].paths.length,
        4,
      );
    for (let i = 0; i < count; i++) {
      const p = i ? await service.prepareAutomatic(source) : firstPreview,
        recipe = catalog.find((m) => m.sourceMaterialId === spec.materialId && m.tool === p.tool);
      assert(recipe);
      assert.deepEqual(p.pressureRequests, recipe.pressureRequests);
      assert.equal(p.passCount, recipe.passCount);
      assert.equal(p.materialId, spec.materialId);
      assert.equal(p.heightInches, mat.height);
      if (i) await service.armNext({ jobId: p.jobId, source });
      else await service.start({ jobId: p.jobId, source });
      await wait('waiting_for_go');
      approved = false;
      assert.deepEqual(await service.go(), { canceled: true });
      assert.equal((await service.status()).acceptedRecords, 0);
      approved = true;
      await service.go();
      const state = await wait('retained_ready');
      assert.equal(state.acceptedRecords, p.recordCount);
      assert.equal(state.completedPasses, p.passCount);
      assert.equal(state.returnToOrigin, 'protocol_complete');
      actions.push({
        tool: p.tool,
        pressures: p.pressureRequests,
        records: state.acceptedRecords,
        passes: state.completedPasses,
      });
    }
    assert.equal(loads, 1);
    await service.end();
    await wait('completed');
    const report = await journal.readLatest();
    assert.equal(report.completeCapture, true);
    assert.deepEqual(report.gaps, []);
    await native.disconnect();
    const receipts = await Promise.all(
      receives.map(async (f) => JSON.parse(await fs.readFile(f, 'utf8'))),
    );
    assert(
      receipts.every(
        (r) =>
          r.synthetic &&
          r.transportsOpened === 0 &&
          r.calibrationOrSecretsRead === false &&
          r.sessionClosed,
      ),
    );
    const dimensions = receipts
      .flatMap((r) => r.packets)
      .map((h) => Buffer.from(h, 'hex'))
      .filter((p) => p[2] === 0x11);
    assert.equal(dimensions.length, 1);
    assert.equal(dimensions[0][3], spec.card ? 2 : 0);
    assert.equal(dimensions[0].readFloatBE(8), mat.height);
    return {
      name: spec.name,
      materialId: spec.materialId,
      mat: source.mat,
      wireMode: dimensions[0][3],
      wireHeight: dimensions[0].readFloatBE(8),
      frozenCompilerActions: frozenPlans.length,
      actions,
      oneLoad: true,
      separateGoRequired: true,
      completeCapture: true,
      synthetic: true,
      transportsOpened: 0,
    };
  } finally {
    service.dispose();
    await native.disconnect();
    for (const c of clients) await c.close();
  }
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  // Bundle the real renderer-side producer for this test only; never ship the fixture bundle.
  const esbuild = require('esbuild'),
    bundle = path.join(out, 'producer.cjs');
  esbuild.buildSync({
    stdin: {
      contents: `export{buildNativeWorkspaceBundle}from ${JSON.stringify(repo + '/apps/desktop/src/native-joy-workspace-bundle.ts')};export{normalizeWorkspaceSvgForJoy}from ${JSON.stringify(repo + '/apps/desktop/src/native-joy-workspace-normalize.ts')};`,
      resolveDir: repo,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'silent',
  });
  const { buildNativeWorkspaceBundle: build, normalizeWorkspaceSvgForJoy: normalize } = require(
    bundle,
  );
  const cases = [
    { name: 'heavy-cardmat-mixed', materialId: 211, card: true },
    { name: 'insert-card-pen-and-corners', materialId: 535, card: true, insert: true },
    {
      name: 'insert-card-corners-only',
      materialId: 535,
      card: true,
      insert: true,
      slotsOnly: true,
    },
    ...[
      [473, 'premium'],
      [73, 'stencil'],
      [87, 'holographic'],
      [20, 'chalkboard'],
      [431, 'dry-erase'],
    ].map(([materialId, n]) => ({ name: 'vinyl-' + n, materialId })),
    { name: 'premium-vinyl-long', materialId: 473, long: true },
  ];
  const results = [];
  for (const spec of cases) {
    const r = await runCase(spec, build, normalize);
    results.push(r);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS ' + spec.name);
  }
  assert.equal(results.length, cases.length);
  console.log(
    JSON.stringify({
      passed: results.length,
      total: cases.length,
      synthetic: true,
      resultsPath: path.join(out, 'results.json'),
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
