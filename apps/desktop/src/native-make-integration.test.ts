import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const app=readFileSync(new URL('./App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function findFunction(name:string){let found:ts.FunctionDeclaration|undefined;function walk(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,walk);}walk(ast);if(!found)throw Error(name);return found.getText(ast);}
describe('actual main Make bindings',()=>{
 it('routes current metadata/preference BEFORE legacy planning and before clearing old cut state',()=>{const body=findFunction('handleOpenCutPreview');expect(body.indexOf('await resolveMakeRoute')).toBeLessThan(body.indexOf('setCutSession(null)'));expect(body.indexOf("if(route==='native')")).toBeLessThan(body.indexOf('slicebug.createPlan'));expect(body).toContain('preference:()=>api.cutterBackend.get()');expect(body).toContain('nativeJoy!.getSetupStatus()');expect(body).toContain('catch(error)');});
 it('binds primary Make and a single persistent panel to current workspace source and material',()=>{expect(app).toContain('onStartCut={() => void handleOpenCutPreview()}');expect(app.match(/<NativeMakeModal /g)).toHaveLength(1);expect(app).toContain('nativeMakeEverOpened &&');expect(app).toContain('visible={nativeMakeOpen}');expect(app).toContain('source={getNativeConfigurationSource} nativeMaterials={nativeMaterialOptions} onWorkspaceMaterialChange={handleMaterialChange}');expect(app).toContain('onClose={() => setNativeMakeOpen(false)}');});
 it('does not mount hardware controls or job source inside Settings',()=>{const text=readFileSync(new URL('./components/modals/SettingsModal.tsx',import.meta.url),'utf8');expect(text).not.toContain('NativeJoySetupPanel');expect(text).not.toContain('onNativeConfigurationSource');expect(text).toContain('onOpenNativeMake');});
});
