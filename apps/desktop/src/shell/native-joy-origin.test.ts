import {describe,it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {isTrustedJoyUrl} from './native-joy-origin';
describe('native Joy renderer origin policy',()=>{
 it('accepts only the exact packaged renderer file',()=>{const entry={type:'file' as const,value:'/app/dist/renderer/index.html'};expect(isTrustedJoyUrl(pathToFileURL(entry.value).href,entry)).toBe(true);expect(isTrustedJoyUrl('file:///another/index.html',entry)).toBe(false);});
 it('accepts only the configured loopback dev origin',()=>{const entry={type:'url' as const,value:'http://127.0.0.1:5173'};expect(isTrustedJoyUrl('http://127.0.0.1:5173/',entry)).toBe(true);expect(isTrustedJoyUrl('http://127.0.0.1:5174/',entry)).toBe(false);});
 it('rejects nonloopback dev origins even when configured',()=>{expect(isTrustedJoyUrl('https://example.com',{type:'url',value:'https://example.com'})).toBe(false);});
 it('rejects invalid URLs',()=>{expect(isTrustedJoyUrl('not url',{type:'file',value:'/app/index.html'})).toBe(false);});
});
