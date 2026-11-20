import {describe,it,expect,vi}from'vitest';
import{readCutterStartupSnapshot}from'./cutter-startup-snapshot';
const fixture=(preference:'auto'|'native'|'slicebug'='auto')=>({preference:async()=>preference,nativeSetup:vi.fn(async()=>({enabled:true,runtimeAvailable:true})),legacyStatus:vi.fn(async()=>({ok:true})),legacySetup:vi.fn(async()=>({legacy:true}))});
describe('startup metadata routing',()=>{
 it('uses native metadata on auto without running a legacy executable',async()=>{const api=fixture();expect((await readCutterStartupSnapshot(api)).kind).toBe('native');expect(api.legacyStatus).not.toHaveBeenCalled();expect(api.legacySetup).not.toHaveBeenCalled();});
 it('never falls back from an explicitly selected unavailable native backend',async()=>{const api=fixture('native');api.nativeSetup.mockResolvedValue({enabled:false,runtimeAvailable:false});await expect(readCutterStartupSnapshot(api)).rejects.toThrow();expect(api.legacyStatus).not.toHaveBeenCalled();});
 it('does not launch legacy after a native metadata error',async()=>{const api=fixture();api.nativeSetup.mockRejectedValue(Error('metadata unavailable'));await expect(readCutterStartupSnapshot(api)).rejects.toThrow();expect(api.legacyStatus).not.toHaveBeenCalled();});
 it('preserves an explicitly selected legacy path',async()=>{const api=fixture('slicebug');expect((await readCutterStartupSnapshot(api)).kind).toBe('legacy');expect(api.nativeSetup).not.toHaveBeenCalled();expect(api.legacyStatus).toHaveBeenCalledOnce();});
});
