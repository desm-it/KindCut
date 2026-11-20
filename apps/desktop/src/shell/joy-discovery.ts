import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export async function discoverJoyDevices(executable:string,run:(file:string,args:string[],options:{timeout:number;maxBuffer:number})=>Promise<{stdout:string}>=(file,args,options)=>execute(file,args,options)):Promise<JoyDevicePublic[]>{
 try{
  const {stdout}=await run(executable,['--devices'],{timeout:8000,maxBuffer:65536});const data=JSON.parse(stdout);
  if(data?.ok!==true||!Array.isArray(data.devices)||data.devices.length>256)throw new Error();
  const values=data.devices.filter((d:unknown):d is JoyDevice=>Boolean(d&&typeof d==='object'&&typeof (d as JoyDevice).name==='string'&&(d as JoyDevice).name.length<=128&&typeof(d as JoyDevice).address==='string'&&typeof(d as JoyDevice).paired==='boolean'&&typeof(d as JoyDevice).connected==='boolean'));
  return publicJoyDevices(compatibleJoyDevices(values));
 }catch{throw new Error('Could not find paired Joy devices. Check macOS Bluetooth permissions and pair your Joy in System Settings.');}
}
export interface JoyDevice {name:string;address:string;paired:boolean;connected:boolean}
export interface JoyDevicePublic {name:string;id:string;paired:boolean;connected:boolean}
const MAC=/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
export function compatibleJoyDevices(items:JoyDevice[]):JoyDevice[]{return items.filter(d=>MAC.test(d.address)&&/^joy(?:[- ]|$)/i.test(d.name)&&!/(?:xtra|explore|maker|air|cricut joy xtra)/i.test(d.name)).map(d=>({name:d.name,address:d.address.toUpperCase(),paired:Boolean(d.paired),connected:Boolean(d.connected)}));}
export function selectSingleJoy(items:JoyDevice[]):JoyDevice|null{return items.length===1?items[0]!:null;}
export function publicJoyDevices(items:JoyDevice[]):JoyDevicePublic[]{return items.map(({name,address,paired,connected})=>({name,id:address,paired,connected}));}
