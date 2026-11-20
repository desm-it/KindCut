import {describe,it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {NativeJoyConfigurationPanel,configurationSelectionMatches} from './NativeJoyConfigurationPanel';
import type {NativeJoyConfigurationApi} from '../../native-joy-configuration-types';
import type {NativeJoySetup} from '../../shell/native-joy-service';
const unused=async():Promise<never>=>{throw Error('SSR must not invoke an API');};
const api:NativeJoyConfigurationApi={configurationList:unused,configurationImport:unused,configurationExport:unused,configurationSelect:unused,configurationCapture:unused,configurationUpdate:unused,configurationCompile:unused,configurationAdopt:unused};
const setup:NativeJoySetup={experimental:true,enabled:true,runtimeAvailable:true,provisioned:true,platform:'darwin',session:{state:'ready',machine:'cricut_joy',firmwareSelector:8.164000001,materialRecord:0,fallbackUsed:false,status:{status_byte_1:0,status_byte_2:0,extra_u16_raw:0,extra_u16_native:0,value_be32:0}}};
const source=async()=>({svg:'',materialId:1,mat:{widthIn:4.5,heightIn:12},strokeTools:{}});
function readButton(s:NativeJoySetup,busy=false){const html=renderToStaticMarkup(<NativeJoyConfigurationPanel api={api} setup={s} busy={busy} source={source}/>);const match=html.match(/<button([^>]*)>Read calibration from connected Joy<\/button>/);expect(match).toBeTruthy();return match![1];}
describe('first-time calibration UI',()=>{
 it('can acquire the FIRST calibration without an existing profile or calibration',()=>{expect(readButton(setup)).not.toContain('disabled');});
 it('rejects unsupported selector, fallback, disconnected and busy sessions',()=>{for(const s of [{...setup,session:null},{...setup,session:{...setup.session!,firmwareSelector:8.1}},{...setup,session:{...setup.session!,fallbackUsed:true}}])expect(readButton(s)).toContain('disabled');expect(readButton(setup,true)).toContain('disabled');});
});

it('requires saving changed profile/calibration/pressure before preparation',()=>{
 const catalog={profiles:[{id:'p',name:'test',materialId:1,tool:'pen' as const,mode:'precision' as const,pressureRequest:180,provenance:'synthetic_test'}],calibrations:[],selection:{profileId:'p',calibrationId:'c'}};
 expect(configurationSelectionMatches(catalog,'p','c','180')).toBe(true);
 expect(configurationSelectionMatches(catalog,'other','c','180')).toBe(false);
 expect(configurationSelectionMatches(catalog,'p','other','180')).toBe(false);
 expect(configurationSelectionMatches(catalog,'p','c','181')).toBe(false);
 expect(configurationSelectionMatches(catalog,'p','c','180',2)).toBe(false);
 expect(configurationSelectionMatches(catalog,'p','c','180',1)).toBe(true);
});
