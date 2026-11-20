import {describe,it,expect} from 'vitest';
import {nativeJoyMaterialOptions} from './native-joy-material-options';
describe('native material identity options',()=>{
 it('deduplicates tools using exact source identity and retains source names',()=>expect(nativeJoyMaterialOptions([{sourceMaterialId:218,name:'Source cardstock'},{sourceMaterialId:19,name:'Another material'},{sourceMaterialId:218,name:'Source cardstock'}])).toEqual([{id:19,name:'Another material'},{id:218,name:'Source cardstock'}]));
 it('does not silently guess a name when one source ID has conflicting labels',()=>expect(()=>nativeJoyMaterialOptions([{sourceMaterialId:218,name:'Paper'},{sourceMaterialId:218,name:'Vinyl'}])).toThrow());
 it.each([{sourceMaterialId:0,name:'No'},{sourceMaterialId:1.1,name:'No'},{sourceMaterialId:218,name:''}])('rejects invalid native metadata',row=>expect(()=>nativeJoyMaterialOptions([row])).toThrow());
});
