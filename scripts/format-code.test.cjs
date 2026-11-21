const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { eligiblePaths } = require('./format-code.cjs');
test('format scope preserves old untracked plans, private evidence and generated artifacts', () => {
  const result = eligiblePaths(
    [
      'apps/desktop/src/App.tsx',
      'docs/architecture.md',
      'docs/plans/history.md',
      'apps/desktop/dist/main.js',
      'package-lock.json',
    ],
    ['docs/plans/old-untracked.md', 'apps/desktop/src/features/new.ts', 'private-secret.ts'],
  );
  assert.deepEqual(result, [
    'apps/desktop/src/App.tsx',
    'apps/desktop/src/features/new.ts',
    'docs/architecture.md',
    'package-lock.json',
  ]);
});
