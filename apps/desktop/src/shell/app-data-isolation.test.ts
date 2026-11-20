import {describe,it,expect,vi}from'vitest';
import {mkdtempSync,rmSync,statSync}from'node:fs';
import path from'node:path';
import {applyAppDataIsolation}from'./app-data-isolation';
describe('isolated Electron verification profile',()=>{
 it('does not change the normal user profile without an explicit launch override',()=>{const app={setPath:vi.fn()};expect(applyAppDataIsolation(app,undefined)).toBe(false);expect(app.setPath).not.toHaveBeenCalled();});
 it('rejects relative paths before changing Electron state',()=>{const app={setPath:vi.fn()};expect(()=>applyAppDataIsolation(app,'relative')).toThrow();expect(app.setPath).not.toHaveBeenCalled();});
 it('isolates both app settings and browser session storage',()=>{const root=mkdtempSync(path.join(process.env.TMPDIR!,'kindcut-isolation-test-'));try{const app={setPath:vi.fn()};const data=path.join(root,'profile');expect(applyAppDataIsolation(app,data)).toBe(true);expect(app.setPath.mock.calls).toEqual([['userData',data],['sessionData',path.join(data,'session')]]);expect(statSync(path.join(data,'session')).isDirectory()).toBe(true);}finally{rmSync(root,{recursive:true,force:true});}});
});
