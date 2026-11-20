type Device={generation:number;deviceFingerprint:string;firmwareSelector:number};
type BoundCalibration={deviceFingerprint:string;firmwareSelector:number};
/** Called only inside the host's approved Make connection attempt. Never moves hardware. */
export async function ensureConnectedJoyCalibration<T extends BoundCalibration>(device:Device,api:{current():boolean;load():Promise<{calibrations:BoundCalibration[]}>;read():Promise<T>;save(value:T):Promise<unknown>}):Promise<void>{
 const current=()=>{if(!api.current())throw Error('Joy setup changed; retry from Make.');};
 current();const library=await api.load();current();
 if(library.calibrations.some(c=>c.deviceFingerprint===device.deviceFingerprint&&c.firmwareSelector===device.firmwareSelector))return;
 const value=await api.read();current();
 if(value.deviceFingerprint!==device.deviceFingerprint||value.firmwareSelector!==device.firmwareSelector)throw Error('Calibration does not match this Joy.');
 await api.save(value);current();
}
