const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {copyRuntimeResources}=require('./copy-runtime-resources.cjs');
const root=path.resolve(__dirname,'..');
const repo=path.resolve(root,'../..');
if(process.platform!=='darwin'){console.log('Native Joy runtime not built: experimental backend is macOS-only.');process.exit(0);}
const python=path.join(root,'.venv/bin/python');
const runtime=path.join(root,'runtime');
if(!fs.existsSync(python))throw new Error('Create the package .venv and install requirements-build.txt first.');
if(fs.statSync(path.join(runtime,'decoder-prefix.bin')).size!==33)throw new Error('Shared decoder resource is missing or invalid.');
fs.mkdirSync(path.join(root,'build'),{recursive:true});
const log=[];
function run(executable,args,options={}){
  try{const out=execFileSync(executable,args,{cwd:root,encoding:'utf8',stdio:'pipe',...options});log.push(out||'');return out;}
  catch(error){log.push(String(error.stdout||''),String(error.stderr||''));throw new Error('Native Joy build failed; see build/build.log.');}
}
try{
 run('/bin/bash',[path.join(runtime,'bluetooth/build.sh')]);
 run(python,['-m','PyInstaller','--noconfirm','--clean','--onedir','--name','kindcut-joy-runtime',
   '--distpath',path.join(root,'dist'),'--workpath',path.join(root,'build/pyinstaller'),
   '--specpath',path.join(root,'build'),'--paths',runtime,
   '--add-data',path.join(runtime,'decoder-prefix.bin')+':.',
   '--add-data',path.join(runtime,'profiles')+':profiles',
   '--add-binary',path.join(runtime,'bluetooth/joy_rfcomm')+':bluetooth',path.join(runtime,'worker.py')],
   {env:{...process.env,PYINSTALLER_CONFIG_DIR:path.join(root,'build/cache')}});
 const folder=path.join(root,'dist/kindcut-joy-runtime');
 const executable=path.join(folder,'kindcut-joy-runtime');
 const probe=JSON.parse(run(executable,['--probe']));
 if(probe.protocol!==1||probe.hardwareAccess!==false)throw new Error('Native Joy worker probe did not pass.');
 const resources=path.join(repo,'apps/desktop/resources/joy');
 copyRuntimeResources(folder,resources);
 const manifest={format:1,platform:process.platform,arch:process.arch,protocol:1,hardwareAccess:false,
   runtime:'kindcut-joy-runtime',experimental:true};
 fs.writeFileSync(path.join(resources,'build-manifest.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({built:true,executable,resources,probe},null,2));
}finally{fs.writeFileSync(path.join(root,'build/build.log'),log.join('\n'));}
