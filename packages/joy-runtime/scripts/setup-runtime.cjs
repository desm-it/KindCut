const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function setupRuntime({
  root = path.resolve(__dirname, '..'),
  platform = process.platform,
  run,
} = {}) {
  const venv = path.join(root, '.venv');
  const windows = platform === 'win32';
  const python = path.join(venv, windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python');
  const execute =
    run ||
    ((command, args) => {
      const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: windows });
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    });
  if (!fs.existsSync(python)) execute(process.env.PYTHON || 'python3', ['-m', 'venv', venv]);
  execute(python, ['-m', 'pip', 'install', '-r', path.join(root, 'requirements-build.txt')]);
  return { python };
}

if (require.main === module) setupRuntime();
module.exports = { setupRuntime };
