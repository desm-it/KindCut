import {describe,it,expect} from 'vitest';
import {compatibleJoyDevices,selectSingleJoy} from './joy-discovery';
const synthetic=[{name:'Joy-C3D0',address:'00:11:22:33:44:55',paired:true,connected:false}];
describe('Joy discovery filtering',()=>{
 it('keeps only named original Joy devices and strips transport fields',()=>{expect(compatibleJoyDevices([...synthetic,{name:'Joy Xtra',address:'00:11:22:33:44:56',paired:true,connected:false},{name:'Keyboard',address:'00:11:22:33:44:57',paired:true,connected:false}])).toEqual(synthetic);});
 it('auto-selects only one compatible device',()=>{expect(selectSingleJoy(synthetic)?.address).toBe(synthetic[0]!.address);expect(selectSingleJoy([...synthetic,{...synthetic[0]!,address:'00:11:22:33:44:58'}])).toBeNull();expect(selectSingleJoy([])).toBeNull();});
});
