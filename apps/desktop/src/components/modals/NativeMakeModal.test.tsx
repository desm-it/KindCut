import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeMakeModal } from "./NativeMakeModal";

describe("Native Make entry", () => {
  it("omits the header tagline and offers paper weights, insert cards and exact on-mat vinyl choices", () => {
    const html = renderToStaticMarkup(<NativeMakeModal language="en" onClose={() => {}} workspaceMaterial={{id:218,name:'Light cardstock'}} nativeMaterials={[{id:1,name:'ignored'}]} onWorkspaceMaterialChange={() => {}} />);
    expect(html).not.toContain('Bekijk je ontwerp'); expect(html).not.toContain('Preview your design, connect');
    expect(html).toContain('data-material-id="218"'); expect(html).toContain('data-material-id="19"'); expect(html).toContain('data-material-id="211"'); expect(html).toContain('data-material-id="473"');
    expect(html).not.toContain('value="999"'); expect(html).not.toContain('value="1"');
    expect(html).toContain('data-material-id="535"');expect(html).toContain('>Light</span>'); expect(html).toContain('>Medium</span>'); expect(html).toContain('>Heavy</span>'); expect(html).toContain('>Vinyl on mat</span>');
  });
  it("presents the simple Make flow without automatically starting hardware work", () => {
    const html = renderToStaticMarkup(<NativeMakeModal language="en" onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain("Preview your design, connect your Joy, and follow the next step.");
    expect(html).not.toContain("Frozen draw-then-cut jobs use the saved pen");
    expect(html).not.toContain("remove BOTH the pen and blade housing");
    expect(html).not.toContain("Start job");
  });
  it("supports Dutch labels", () => {
    const html = renderToStaticMarkup(<NativeMakeModal language="nl" onClose={() => {}} />);
    expect(html).toContain("Klaar om te maken");expect(html).not.toContain("preview-heading");
    expect(html).toContain("Materiaal");
  });
});

it('keeps the actual native panel tree mounted while hidden',()=>{
 const html=renderToStaticMarkup(<NativeMakeModal visible={false} language="en" onClose={()=>{}}/>);
 expect(html).toContain('hidden=""');expect(html).toContain('aria-hidden="true"');
 expect(html).not.toContain('aria-label="Cricut connection"');expect(html).toContain('aria-label="Native Make"');
});
it('moves the full material selector into Make and states empty-clamp and no-home limits',()=>{
 const html=renderToStaticMarkup(<NativeMakeModal language="en" onClose={()=>{}} workspaceMaterial={{id:211,name:'Heavy cardstock'}} nativeMaterials={[{id:211,name:'Heavy cardstock'}]} onWorkspaceMaterialChange={()=>{}}/>);
 expect(html).toContain('id="native-make-workspace-material"');expect(html).toContain('data-material-id="211"');
 expect(html).not.toContain('BOTH the pen and blade housing');expect(html).not.toContain('A non-drawing return to job origin (0,0) follows each completed tool');
});

it('keeps modal keyboard input from bubbling into workspace shortcuts',()=>{const html=renderToStaticMarkup(<NativeMakeModal language="en" onClose={()=>{}}/>);expect(html).toContain('role="dialog"');});

it('uses the old preview-and-plan layout, not a settings page',()=>{const html=renderToStaticMarkup(<NativeMakeModal language="en" onClose={()=>{}}/>);expect(html).toContain('native-make__workspace');expect(html).toContain('Full design');expect(html).toContain('Plan');expect(html).not.toContain('Tool plan');expect(html).not.toContain('Material &amp; calibration settings');expect(html).not.toContain('Load mat and align');expect(html).not.toContain('Export loading diagnostics');});

it('reveals technical details only after explicit opt-in',()=>{const normal=renderToStaticMarkup(<NativeMakeModal language="en" onClose={()=>{}}/>);const advanced=renderToStaticMarkup(<NativeMakeModal language="en" onClose={()=>{}} showAdvancedInfo/>);expect(normal).not.toContain('Safety &amp; workflow notes');expect(advanced).toContain('Safety &amp; workflow notes');expect(advanced).toContain('Material &amp; calibration settings');});
