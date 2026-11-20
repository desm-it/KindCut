import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsModal } from "./SettingsModal";

const props = { language: "en" as const, backend: "auto" as const, onBackendChange: () => {}, settings: { activeProvider: "openai" as const, openaiKey: "", recraftKey: "", openaiImageModel: "gpt-image-2.5-flare" as const }, onSave: () => {}, onClose: () => {} };
describe("settings tabs", () => {
  it("separates cutter and AI controls into accessible tabs", () => {
    const html = renderToStaticMarkup(<SettingsModal {...props} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabpanel');
    expect(html).toContain('id="settings-panel-cutter" role="tabpanel"');
    expect(html).toContain('id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai" hidden=""');
    expect(html).toContain('id="openai-key" type="password"');
    expect(html).not.toContain("native-joy-setup-panel");
    expect(html).not.toContain("Open Native Make");
    expect(html).toContain("Show advanced info");
  });
});
it('offers a useful normal Make entry and never claims supported blade jobs are trial-only',()=>{const simple=renderToStaticMarkup(<SettingsModal {...props} onOpenNativeMake={()=>{}}/>);expect(simple).toContain('Your Cricut');expect(simple).toContain('Open Make');expect(simple).not.toContain('Cutter backend');const advanced=renderToStaticMarkup(<SettingsModal {...props} showAdvancedInfo/>);expect(advanced).toContain('fine-point blade jobs');expect(advanced).not.toContain('restricted cut trial');});
