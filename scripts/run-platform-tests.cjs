const fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const defaultPolicy = require('./test-policy.cjs');
function discoverWorkspaces(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const patterns = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : manifest.workspaces?.packages;
  if (!Array.isArray(patterns)) throw Error('Declare workspace paths in package.json.');
  const found = new Set();
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.includes('..') || /[?{}!\[\]]/.test(pattern))
      throw Error(`Unsupported workspace pattern: ${pattern}`);
    let candidates;
    if (pattern.endsWith('/*') && !pattern.slice(0, -2).includes('*')) {
      const base = pattern.slice(0, -2);
      candidates = fs
        .readdirSync(path.join(directory, base), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.posix.join(base, e.name));
    } else if (!pattern.includes('*')) candidates = [pattern];
    else throw Error(`Unsupported workspace pattern: ${pattern}`);
    for (const candidate of candidates) {
      const file = path.join(directory, candidate, 'package.json');
      if (fs.existsSync(file)) found.add(candidate);
    }
  }
  return [...found].sort();
}
function resolveNpmCli(directory = root) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const value = candidates.find((f) => f && fs.existsSync(f));
  if (!value) throw Error('Cannot locate npm CLI; run through npm test.');
  return value;
}
function exclusionsFor(directory, platform, policy = defaultPolicy) {
  return policy.exceptions.filter((e) => {
    if (!fs.existsSync(path.join(directory, e.file)))
      throw Error(`Dangling platform policy: ${e.file}`);
    return e.excludedOn.includes(platform);
  });
}
function testPlan(directory, { platform = process.platform, policy = defaultPolicy } = {}) {
  const exceptions = exclusionsFor(directory, platform, policy);
  return discoverWorkspaces(directory).flatMap((workspace) => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(directory, workspace, 'package.json'), 'utf8'),
    );
    if (!pkg.scripts?.test) return [];
    const python =
      pkg.name === '@cricut-companion/joy-runtime' && pkg.kindcutTests?.platformPolicyVersion !== 1;
    return [
      {
        workspace,
        name: pkg.name,
        runner: python ? 'python-unittest' : 'npm-script',
        excluded: exceptions
          .filter((e) => e.file.startsWith(workspace + '/'))
          .map((e) => ({ ...e, file: e.file.slice(workspace.length + 1) })),
      },
    ];
  });
}
function execute(exe, args, cwd, env = process.env) {
  const result = spawnSync(exe, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`Test command failed (${result.status ?? 'signal'}): ${exe} ${args[0] ?? ''}`);
}
function runNpm(args, directory = root) {
  execute(process.execPath, [resolveNpmCli(directory), ...args], directory);
}
function runPython(directory, workspace, excluded = []) {
  const base = path.join(directory, workspace);
  const python = path.join(
    base,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const program = `import pathlib,sys,unittest
root=pathlib.Path(sys.argv[1]);tests=root/'tests';sys.path[:0]=[str(tests),str(root/'runtime')]
excluded=set(sys.argv[2:]);modules=sorted(p.stem for p in tests.glob('test_*.py') if p.stem not in excluded)
print('Python modules:',len(modules),'explicit platform exclusions:',sorted(excluded))
suite=unittest.TestLoader().loadTestsFromNames(modules);result=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not result.wasSuccessful())
`;
  execute(
    python,
    ['-I', '-c', program, base, ...excluded.map((e) => path.basename(e.file, '.py'))],
    base,
    {
      ...process.env,
      TMPDIR: process.env.TMPDIR || process.env.RUNNER_TEMP || require('node:os').tmpdir(),
    },
  );
}
function runAll({ directory = root, platform = process.platform } = {}) {
  const plan = testPlan(directory, { platform });
  console.log('Discovered test workspaces:', plan.map((p) => p.workspace).join(', '));
  for (const p of plan) {
    for (const e of p.excluded)
      console.log(`Platform exception: ${p.workspace}/${e.file}: ${e.reason}`);
    if (p.runner === 'python-unittest') runPython(directory, p.workspace, p.excluded);
    else {
      const args = ['run', 'test', '--workspace', p.name];
      if (p.excluded.length) {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(directory, p.workspace, 'package.json'), 'utf8'),
        );
        if (pkg.kindcutTests?.platformPolicyVersion === 1) {
          runNpm(args, directory);
          continue;
        }
        if (!/\bvitest\b/.test(pkg.scripts.test))
          throw Error(`Classified tests need a supported runner: ${p.workspace}`);
        args.push(
          '--',
          ...p.excluded.flatMap((e) => ['--exclude', e.file.replaceAll(path.sep, '/')]),
        );
      }
      runNpm(args, directory);
    }
  }
}
module.exports = {
  discoverWorkspaces,
  exclusionsFor,
  testPlan,
  runAll,
  runPython,
  runNpm,
  resolveNpmCli,
};
if (require.main === module) {
  try {
    runAll({ directory: process.argv[2] ? path.resolve(process.argv[2]) : root });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
