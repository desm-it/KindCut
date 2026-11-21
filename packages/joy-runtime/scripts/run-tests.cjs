const path = require('node:path');
const { runPython, exclusionsFor } = require('../../../scripts/run-platform-tests.cjs');
const root = path.resolve(__dirname, '../../..'),
  workspace = 'packages/joy-runtime';
try {
  runPython(
    root,
    workspace,
    exclusionsFor(root, process.platform)
      .filter((e) => e.file.startsWith(workspace + '/'))
      .map((e) => ({ ...e, file: e.file.slice(workspace.length + 1) })),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
