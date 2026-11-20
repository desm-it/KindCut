const {spawnSync}=require('node:child_process');const path=require('node:path');
const root=path.resolve(process.argv[2]||process.cwd());const vitest=path.join(root,'node_modules/vitest/vitest.mjs');
function run(exe,args,cwd=root){const r=spawnSync(exe,args,{cwd,stdio:'inherit',env:process.env});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
// Native hardware is macOS-only. Unix mode bits/O_NOFOLLOW and Darwin framework
// symlink semantics are tested in full on macOS/Linux, not emulated on Windows.
const posixOnly=['joy-configuration-store','joy-provisioning-store','joy-runtime-resource-copy','native-joy-job-journal','native-joy-loading-journal'];
console.log('Windows platform exclusions (native macOS filesystem contracts only):',posixOnly.join(', '));
for(const directory of ['packages/ai-designer','packages/craft-core','packages/slicebug-bridge','packages/svg-preflight'])run(process.execPath,[vitest,'run','--passWithNoTests'],path.join(root,directory));
run(process.execPath,[vitest,'run',...posixOnly.flatMap(name=>['--exclude',`src/shell/${name}.test.ts`])],path.join(root,'apps/desktop'));
const python=path.join(root,'packages/joy-runtime/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const program=`import pathlib,sys,unittest
root=pathlib.Path(sys.argv[1]);tests=root/'packages/joy-runtime/tests';sys.path.insert(0,str(tests));sys.path.insert(0,str(root/'packages/joy-runtime/runtime'))
modules=sorted(p.stem for p in tests.glob('test_*.py') if p.stem!='test_joy_load_test')
print('Windows platform exclusion: test_joy_load_test requires POSIX fcntl and pipe locking; full coverage runs on POSIX.')
suite=unittest.TestLoader().loadTestsFromNames(modules)
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
`;
run(python,['-I','-c',program,root]);
