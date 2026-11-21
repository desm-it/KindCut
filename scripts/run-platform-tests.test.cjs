const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { discoverWorkspaces, testPlan, exclusionsFor } = require('./run-platform-tests.cjs');
const root = path.resolve(__dirname, '..');
test('discovers a newly declared workspace and respects its declared non-Vitest test script', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'kindcut-policy-'));
  try {
    fs.mkdirSync(path.join(dir, 'packages/new-feature'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
    );
    fs.writeFileSync(
      path.join(dir, 'packages/new-feature/package.json'),
      JSON.stringify({ name: 'new-feature', scripts: { test: 'node --test' } }),
    );
    assert.deepEqual(discoverWorkspaces(dir), ['packages/new-feature']);
    assert.deepEqual(
      testPlan(dir, { platform: 'win32', policy: { exceptions: [] } }).map((p) => [
        p.name,
        p.runner,
      ]),
      [['new-feature', 'npm-script']],
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test('every platform exception points to an existing test and is reported only for its platform', () => {
  assert.ok(exclusionsFor(root, 'win32').length > 0);
  assert.deepEqual(exclusionsFor(root, 'darwin'), []);
  assert.throws(
    () =>
      exclusionsFor(root, 'win32', {
        exceptions: [{ file: 'missing.test.ts', excludedOn: ['win32'] }],
      }),
    /Dangling/,
  );
});
test('canonical discovery includes Python and all declared JS workspaces without a second package list', () => {
  const plan = testPlan(root, { platform: 'win32' });
  assert.equal(plan.length, discoverWorkspaces(root).length);
  assert.equal(plan.find((p) => p.name === '@cricut-companion/joy-runtime').runner, 'npm-script');
  assert.ok(plan.find((p) => p.name === '@cricut-companion/desktop').excluded.length);
});

test('honors the current Python workspace test script while retaining old tagged-suite compatibility', () => {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), 'kindcut-policy-python-'),
  );
  try {
    fs.mkdirSync(path.join(dir, 'packages/runtime'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
    );
    const file = path.join(dir, 'packages/runtime/package.json');
    const base = {
      name: '@cricut-companion/joy-runtime',
      scripts: { test: 'node --test scripts/setup-runtime.test.cjs && node scripts/run-tests.cjs' },
    };
    fs.writeFileSync(file, JSON.stringify({ ...base, kindcutTests: { platformPolicyVersion: 1 } }));
    assert.equal(testPlan(dir, { policy: { exceptions: [] } })[0].runner, 'npm-script');
    fs.writeFileSync(file, JSON.stringify(base));
    assert.equal(testPlan(dir, { policy: { exceptions: [] } })[0].runner, 'python-unittest');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
