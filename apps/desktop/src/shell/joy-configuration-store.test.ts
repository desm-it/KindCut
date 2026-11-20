import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,symlink,rm,stat} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {JoyConfigurationStore,emptyLibrary} from './joy-configuration-store';
describe('owned configuration persistence',()=>{
 it('atomically persists and reloads without allowing unknown envelope fields',async()=>{
  const dir=await mkdtemp(path.join(process.env.TMPDIR??os.tmpdir(),'joy-config-'));try{
   const file=path.join(dir,'owned','profiles.json');const store=new JoyConfigurationStore(file);
   expect(await store.load()).toEqual(emptyLibrary());await store.transact(s=>({...s,selection:null}));
   expect(await new JoyConfigurationStore(file).load()).toEqual(emptyLibrary());expect((await stat(file)).mode&0o777).toBe(0o600);
   await writeFile(file,JSON.stringify({...emptyLibrary(),hardwareApproved:true}));await expect(store.load()).rejects.toThrow();
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('serializes updates and rejects symlinks rather than following them',async()=>{
  const dir=await mkdtemp(path.join(process.env.TMPDIR??os.tmpdir(),'joy-config-'));try{
   const file=path.join(dir,'profiles.json');const outside=path.join(dir,'outside');await writeFile(outside,'secret');await symlink(outside,file);
   await expect(new JoyConfigurationStore(file).load()).rejects.toThrow();expect(await readFile(outside,'utf8')).toBe('secret');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
