import {mkdirSync}from'node:fs';
import path from'node:path';
/** Explicit launch-only profile override for isolated verification; never supplied by renderer IPC. */
export function applyAppDataIsolation(app:{setPath(name:'userData'|'sessionData',value:string):void},directory:string|undefined):boolean{
 if(directory===undefined)return false;
 if(!directory||!path.isAbsolute(directory)||directory.includes('\0'))throw Error('KINDCUT_USER_DATA_DIR must be an absolute directory path.');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const session=path.join(directory,'session');mkdirSync(session,{recursive:true,mode:0o700});
 app.setPath('userData',directory);app.setPath('sessionData',session);return true;
}
