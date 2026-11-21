// Compatibility entrypoint for immutable older release tags; all policy/discovery lives in one runner.
const path = require('node:path');
const { runAll } = require('./run-platform-tests.cjs');
try {
  runAll({ directory: path.resolve(process.argv[2] || process.cwd()) });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
