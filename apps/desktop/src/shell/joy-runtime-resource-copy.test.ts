import {describe,it,expect}from'vitest';
import{mkdtempSync,mkdirSync,writeFileSync,symlinkSync,readlinkSync,readFileSync,renameSync,rmSync}from'node:fs';
import path from'node:path';
import{createRequire}from'node:module';
const require=createRequire(import.meta.url);
const {copyRuntimeResources}=require('../../../../packages/joy-runtime/scripts/copy-runtime-resources.cjs');
describe('portable frozen-runtime resource copy',()=>{
 it('preserves relative framework links and works after the build tree is moved away',()=>{
  const root=mkdtempSync(path.join(process.env.TMPDIR!,'joy-copy-test-'));
  try{const source=path.join(root,'dist'),dest=path.join(root,'resources');const framework=path.join(source,'Python.framework');mkdirSync(path.join(framework,'Versions/3.11/Resources'),{recursive:true});writeFileSync(path.join(framework,'Versions/3.11/Python'),'fixture native library, not executable');symlinkSync('3.11',path.join(framework,'Versions/Current'));symlinkSync('Versions/Current/Python',path.join(framework,'Python'));symlinkSync('Versions/Current/Resources',path.join(framework,'Resources'));
   copyRuntimeResources(source,dest);expect(readlinkSync(path.join(dest,'Python.framework/Python'))).toBe('Versions/Current/Python');expect(readlinkSync(path.join(dest,'Python.framework/Versions/Current'))).toBe('3.11');renameSync(source,path.join(root,'build-tree-removed'));expect(readFileSync(path.join(dest,'Python.framework/Python'),'utf8')).toBe('fixture native library, not executable');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
