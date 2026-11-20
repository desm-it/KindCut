import {describe,it,expect,vi} from 'vitest';
import {resolveMakeRoute} from './native-make-route';
describe('main Make routing is preference/current metadata only',()=>{
 it('preserves explicit SliceBug without native calls',async()=>{const nativeSetup=vi.fn();expect(await resolveMakeRoute({preference:async()=>'slicebug',nativeSetup})).toBe('slicebug');expect(nativeSetup).not.toHaveBeenCalled();});
 it('never falls back from explicitly native',async()=>{expect(await resolveMakeRoute({preference:async()=>'native'})).toBe('native');});
 it('chooses native for known enabled macOS Auto',async()=>{expect(await resolveMakeRoute({preference:async()=>'auto',nativeSetup:async()=>({enabled:true,platform:'darwin'})})).toBe('native');});
 it('preserves Auto legacy route on known unsupported platforms',async()=>{expect(await resolveMakeRoute({preference:async()=>'auto',nativeSetup:async()=>({enabled:false,platform:'win32'})})).toBe('slicebug');});
 it('blocks unknown or failed startup rather than implicitly planning with SliceBug',async()=>{await expect(resolveMakeRoute({preference:async()=>'auto'})).rejects.toThrow();await expect(resolveMakeRoute({preference:async()=>{throw Error('preference failed');}})).rejects.toThrow('preference failed');await expect(resolveMakeRoute({preference:async()=>'auto',nativeSetup:async()=>{throw Error('metadata failed');}})).rejects.toThrow('metadata failed');});
 it('blocks inconsistent enabled/platform metadata',async()=>{await expect(resolveMakeRoute({preference:async()=>'auto',nativeSetup:async()=>({enabled:true,platform:'linux'})})).rejects.toThrow();});
});
