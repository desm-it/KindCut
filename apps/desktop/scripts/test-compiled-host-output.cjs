const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript');
const { findPlannerImports, emittedJavaScript } = require('./prepare-shell-output.cjs');
const mappings = require('./shell-runtime-aliases.cjs');
const shell = path.resolve(__dirname, '..', 'dist', 'main');
let files = 0;
for (const file of emittedJavaScript(shell)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const mapping of mappings)
    if (findPlannerImports(text, file, mapping.specifier).length)
      throw Error('Unresolved mapped runtime import: ' + path.relative(shell, file));
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function walk(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text.startsWith('@cricut-companion/')
    ) {
      const resolved = require.resolve(node.arguments[0].text, { paths: [path.dirname(file)] });
      if (/\.tsx?$/.test(resolved))
        throw Error(
          'Runtime workspace import still resolves to TypeScript: ' + node.arguments[0].text,
        );
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  files++;
}
for (const mapping of mappings) {
  const vendor = require(path.join(shell, mapping.output));
  if (
    mapping.specifier === '@cricut-companion/svg-preflight' &&
    typeof vendor.compileNormalizedSvgForJoy !== 'function'
  )
    throw Error('Compiled planner export missing.');
}
console.log(
  `Compiled host: ${files} recursively discovered emitted modules checked; declared vendor exports loaded.`,
);
