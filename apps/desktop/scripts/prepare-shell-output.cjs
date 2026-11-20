const fs = require('node:fs');
const path = require('node:path');

async function prepare() {
  const shell = path.join(__dirname, '..', 'dist', 'main');
  fs.writeFileSync(path.join(shell, 'package.json'), `${JSON.stringify({type:'commonjs'},null,2)}\n`);
  // Workspace packages expose TypeScript source for Vite. Electron's compiled CJS main
  // cannot require that source; bundle the pure planner instead of shipping a TS loader.
  const {build} = await import('vite');
  await build({
    configFile:false,
    publicDir:false,
    build:{
      outDir:path.join(shell,'vendor'),
      emptyOutDir:false,
      minify:false,
      lib:{entry:path.resolve(__dirname,'../../../packages/svg-preflight/src/joy-svg-plan.ts'),formats:['cjs'],fileName:()=> 'native-joy-svg.cjs'},
    },
  });
  for(const name of ['joy-configuration-service.js','native-joy-job-service.js']) {
    const file = path.join(shell,name);
    const source = fs.readFileSync(file,'utf8');
    const original = 'require("@cricut-companion/svg-preflight")';
    const bundled = 'require("./vendor/native-joy-svg.cjs")';
    const occurrences = source.split(original).length-1;
    if (occurrences===1 && !source.includes(bundled)) fs.writeFileSync(file,source.replace(original,bundled));
    else if (occurrences!==0 || source.split(bundled).length-1!==1) throw new Error('Unexpected compiled planner import; refusing incomplete shell output.');
  }
}
prepare().catch(error=>{console.error(error);process.exitCode=1;});
