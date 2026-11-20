import{it,expect}from'vitest';import{nativeMakeFinishedForSource}from'./native-make-completion';
const done={phase:'completed',active:false}as any;
it('keeps Done only for the actual completed source in this visible Make flow',()=>{const source={};expect(nativeMakeFinishedForSource(done,source,source,true)).toBe(true);});
it('does not pin a changed material or design to the previous completed job',()=>{const old={},next={};expect(nativeMakeFinishedForSource(done,next,old,true)).toBe(false);expect(nativeMakeFinishedForSource(done,next,null,true)).toBe(false);expect(nativeMakeFinishedForSource({...done,historical:true},next,next,true)).toBe(false);expect(nativeMakeFinishedForSource(done,next,next,false)).toBe(false);});
