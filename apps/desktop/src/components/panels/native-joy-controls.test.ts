import {describe,it,expect} from 'vitest';
import {nativeJoyControls} from './native-joy-controls';
import type {NativeJoySetup} from '../../shell/native-joy-service';
const setup:NativeJoySetup={experimental:true,enabled:true,runtimeAvailable:true,provisioned:true,platform:'darwin',session:null};
describe('native setup action gates',()=>{
 it('enables mat movement only for an initialized idle native session',()=>{
  expect(nativeJoyControls(setup,false,'').load).toBe(false);
  const connected={...setup,session:{state:'ready'} as NativeJoySetup['session']};
  expect(nativeJoyControls(connected,false,'').load).toBe(true);expect(nativeJoyControls(connected,false,'').unload).toBe(true);
  expect(nativeJoyControls(connected,true,'').load).toBe(false);
 });
 it('never enables device controls before metadata loads',()=>{expect(nativeJoyControls(null,false,'00:11:22:33:44:55').connect).toBe(false);});
 it('allows connection only with valid address and complete setup',()=>{expect(nativeJoyControls(setup,false,'00:11:22:33:44:55').connect).toBe(true);expect(nativeJoyControls(setup,false,'invalid').connect).toBe(false);});
 it('blocks missing runtime, provisioning, opt-in and unsupported platform',()=>{for(const patch of [{runtimeAvailable:false},{provisioned:false},{enabled:false},{platform:'win32'}])expect(nativeJoyControls({...setup,...patch},false,'00:11:22:33:44:55').connect).toBe(false);});
 it('disables operations while another request is pending',()=>{expect(Object.values(nativeJoyControls(setup,true,'00:11:22:33:44:55')).every(v=>v===false)).toBe(true);});
 it('never polls without a session',()=>{expect(nativeJoyControls(setup,false,'').poll).toBe(false);expect(nativeJoyControls(setup,false,'').disconnect).toBe(true);});
 it('blocks provisioning replacement and connection in a live session',()=>{const s={...setup,session:{state:'ready'} as NativeJoySetup['session']};const c=nativeJoyControls(s,false,'00:11:22:33:44:55');expect(c.poll).toBe(true);expect(c.connect).toBe(false);expect(c.import).toBe(false);});
 it('offers loading only with an initialized session and no pending action',()=>{expect(nativeJoyControls(setup,false,'').startLoading).toBe(false);const connected={...setup,session:{state:'ready'} as NativeJoySetup['session']};expect(nativeJoyControls(connected,false,'').startLoading).toBe(true);expect(nativeJoyControls(connected,true,'').startLoading).toBe(false);});
 it('gates all competing operations during an active loading operation',()=>{const c=nativeJoyControls({...setup,session:{state:'ready'} as NativeJoySetup['session']},false,'00:11:22:33:44:55',true);expect(c.poll||c.load||c.unload||c.connect||c.import||c.refresh||c.startLoading).toBe(false);expect(c.disconnect).toBe(true);expect(c.cancelLoading).toBe(true);expect(c.finishLoading).toBe(true);});
});
