const fs = require('node:fs'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function eligiblePaths(tracked, untracked = []) {
  const extension = /\.(?:ts|tsx|cjs|css|json|ya?ml|md)$/;
  const ignored = /^(?:vendor|node_modules|\.cache|docs\/research|docs\/plans|native-tests)\//;
  const owned =
    /^(?:apps\/desktop\/(?:src|scripts)|packages\/[^/]+\/(?:src|scripts|contracts)|scripts)\//;
  return [
    ...new Set([
      ...tracked,
      ...untracked.filter((f) => owned.test(f) || /^\.(?:prettier[^/]*|prettierrc\.json)$/.test(f)),
    ]),
  ]
    .filter(
      (f) =>
        extension.test(f) &&
        !ignored.test(f) &&
        !/(?:^|\/)(?:dist|build|\.venv|node_modules|vendor)\//.test(f),
    )
    .sort();
}
async function main(mode) {
  if (!['--check', '--write'].includes(mode)) throw Error('Use --check or --write');
  const list = (args) =>
    execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const files = eligiblePaths(list(['--cached']), list(['--others', '--exclude-standard']));
  const prettier = require('prettier');
  let failed = 0,
    count = 0;
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    const info = await prettier.getFileInfo(absolute, {
      ignorePath: path.join(root, '.prettierignore'),
    });
    if (info.ignored || !info.inferredParser) continue;
    const content = fs.readFileSync(absolute, 'utf8'),
      options = { ...(await prettier.resolveConfig(absolute)), filepath: absolute };
    count++;
    if (mode === '--write') {
      const formatted = await prettier.format(content, options);
      if (formatted !== content) fs.writeFileSync(absolute, formatted);
    } else if (!(await prettier.check(content, options))) {
      failed++;
      console.error(file);
    }
  }
  console.log(`Formatting ${mode}: ${count} managed files; ${failed} need formatting.`);
  if (failed) process.exitCode = 1;
}
module.exports = { eligiblePaths };
if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
