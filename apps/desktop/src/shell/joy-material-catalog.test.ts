import{describe,it,expect}from'vitest';
import{readFileSync}from'node:fs';
import catalog from'./joy-material-catalog.json';
const source=JSON.parse(readFileSync(new URL('./test-fixtures/joy-material-source.json',import.meta.url),'utf8'));
const raw=source;
describe('bundled reviewed native catalog',()=>{
 it('contains every recovered tool record with unique unchanged source identity',()=>{expect(catalog.materials).toHaveLength(173);expect(new Set(catalog.materials.map(m=>m.id)).size).toBe(173);expect(new Set(catalog.materials.map(m=>m.sourceMaterialId)).size).toBe(96);});
 it('preserves every reviewed setting and actual source recipe without inventing calibration',()=>{for(const m of catalog.materials){const original=source.configurationTemplates.find((p:any)=>p.settings.profileId===m.id);const record=raw.profiles.find((p:any)=>p.id===m.id);expect(m.settings).toEqual(original.settings);expect(m.sourceMaterialId).toBe(original.sourceMaterialGlobalId);expect(m.passCount).toBe(record.sourcePrecisionMode.multiPass);expect(m.pressureRequests).toEqual(m.passCount>1?record.sourcePrecisionMode.multiPressure:[record.sourcePrecisionMode.pressure]);expect(m.pressureRequests).toHaveLength(m.passCount);expect(m.settings.geometry.flags.centered_bl).toBe(true);expect(m.settings).not.toHaveProperty('pressureResponsesHex');}});
 it('preserves all two/three-pass recipes rather than filtering or reducing them',()=>{expect(catalog.materials.filter(m=>m.passCount===2)).toHaveLength(15);expect(catalog.materials.filter(m=>m.passCount===3)).toHaveLength(2);});
});
