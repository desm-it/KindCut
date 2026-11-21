const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function findPlannerImports(source, filename, specifier = '@cricut-companion/svg-preflight') {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.Identifier &&
      node.expression.text === 'require' &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteralLike(arg) && arg.text === specifier)
        matches.push([node.getStart(tree), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return matches;
}
function rewritePlannerImports(
  source,
  filename,
  alias,
  specifier = '@cricut-companion/svg-preflight',
) {
  const matches = findPlannerImports(source, filename, specifier);
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  for (const diagnostic of tree.parseDiagnostics)
    throw new Error(
      `Cannot parse ${filename}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    );
  if (!matches.length) return source;
  let output = source;
  for (const [start, end] of matches.reverse())
    output = `${output.slice(0, start)}require(${JSON.stringify(alias)})${output.slice(end)}`;
  return output;
}
function emittedJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? emittedJavaScript(file)
      : entry.isFile() && entry.name.endsWith('.js')
        ? [file]
        : [];
  });
}
function rewriteOutputTree(shell, mappings = require('./shell-runtime-aliases.cjs')) {
  const changed = [];
  for (const file of emittedJavaScript(shell)) {
    let text = fs.readFileSync(file, 'utf8');
    for (const mapping of mappings) {
      let alias = path
        .relative(path.dirname(file), path.join(shell, mapping.output))
        .split(path.sep)
        .join('/');
      if (!alias.startsWith('.')) alias = './' + alias;
      text = rewritePlannerImports(text, file, alias, mapping.specifier);
    }
    if (text !== fs.readFileSync(file, 'utf8')) {
      fs.writeFileSync(file, text);
      changed.push(file);
    }
  }
  return changed;
}
async function prepare() {
  const shell = path.join(__dirname, '..', 'dist', 'main');
  fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
  const { build } = await import('vite');
  const mappings = require('./shell-runtime-aliases.cjs');
  for (const mapping of mappings)
    await build({
      configFile: false,
      publicDir: false,
      build: {
        outDir: path.dirname(path.join(shell, mapping.output)),
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: path.resolve(__dirname, mapping.entry),
          formats: ['cjs'],
          fileName: () => path.basename(mapping.output),
        },
      },
    });
  rewriteOutputTree(shell, mappings);
}
module.exports = {
  findPlannerImports,
  rewritePlannerImports,
  rewriteOutputTree,
  emittedJavaScript,
};
if (require.main === module)
  prepare().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
