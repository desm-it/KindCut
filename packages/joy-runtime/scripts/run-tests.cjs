const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, ['-W', 'error::ResourceWarning', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], { cwd: root, stdio: 'inherit', env: {...process.env, TMPDIR: process.env.TMPDIR || process.env.RUNNER_TEMP || require('node:os').tmpdir()} });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
