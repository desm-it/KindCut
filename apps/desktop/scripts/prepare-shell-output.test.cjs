const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { findPlannerImports, rewritePlannerImports } = require('./prepare-shell-output.cjs');
const alias = './vendor/native-joy-svg.cjs';
test('structurally rewrites every compiled consumer with quote and whitespace variations', () => {
  const source = `const a = require('@cricut-companion/svg-preflight');\nconst b=require ( "@cricut-companion/svg-preflight" );\nconst c = require('@cricut-companion/svg-preflight');`;
  const result = rewritePlannerImports(source, 'fixture.js', alias);
  assert.equal(findPlannerImports(result, 'fixture.js').length, 0);
  assert.equal((result.match(/native-joy-svg\.cjs/g) || []).length, 3);
});
test('leaves module identity imports for every other module unchanged', () => {
  const source = `const a = require('@cricut-companion/craft-core');\nconst b = require('node:path');`;
  assert.equal(rewritePlannerImports(source, 'fixture.js', alias), source);
});
test('does not rewrite unknown mapping and emitted CommonJS resolves vendor output', () => {
  const source = `const a = require('@cricut-companion/svg-preflight-extra');`;
  assert.equal(rewritePlannerImports(source, 'fixture.js', alias), source);
  const vendor = path.resolve(__dirname, '../../../packages/svg-preflight/src/joy-svg-plan.ts');
  assert.ok(require('node:fs').existsSync(vendor));
});

const os = require('node:os');
test('discovers a new nested consumer and resolves its relative alias without naming the file', () => {
  const { rewriteOutputTree } = require('./prepare-shell-output.cjs');
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), 'kindcut-compiled-alias-'),
  );
  try {
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'vendor'));
    fs.writeFileSync(path.join(dir, 'vendor/native-joy-svg.cjs'), 'module.exports={fixture:true};');
    fs.writeFileSync(
      path.join(dir, 'nested/new-consumer.js'),
      `module.exports=require ( '@cricut-companion/svg-preflight' );`,
    );
    const changed = rewriteOutputTree(dir);
    assert.equal(changed.length, 1);
    assert.equal(require(path.join(dir, 'nested/new-consumer.js')).fixture, true);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
