const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setupRuntime } = require('./setup-runtime.cjs');

test('creates an OS-appropriate virtualenv and installs pinned build requirements', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const result = setupRuntime({ root, platform: 'win32', run: (...args) => calls.push(args) });
  assert.equal(result.python, path.join(root, '.venv', 'Scripts', 'python.exe'));
  assert.deepEqual(calls, [
    ['python3', ['-m', 'venv', path.join(root, '.venv')]],
    [result.python, ['-m', 'pip', 'install', '-r', path.join(root, 'requirements-build.txt')]],
  ]);
});

test('uses the POSIX virtualenv executable on macOS and Linux', (t) => {
  for (const platform of ['darwin', 'linux']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-runtime-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const calls = [];
    const result = setupRuntime({ root, platform, run: (...args) => calls.push(args) });
    assert.equal(result.python, path.join(root, '.venv', 'bin', 'python'));
    assert.equal(calls.length, 2);
  }
});
