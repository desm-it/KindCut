import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { filterNativePreviewSvg } from "./native-make-visual-svg";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><defs><clipPath id="paper"><rect x="1" y="2" width="90" height="70"/></clipPath></defs><g transform="translate(4 5)" clip-path="url(#paper)"><path d="M0 0h30v30h-30z M5 5v20h20v-20z" fill="#AABBCC" fill-rule="evenodd" stroke="#aa0000" stroke-width="0.5"/><path d="M40 0L50 10" fill="none" stroke="#0000ff" stroke-width="1"/></g></svg>`;
const parse = (value: string) => new DOMParser().parseFromString(value, "image/svg+xml");

describe("filterNativePreviewSvg", () => {
  it("filters by canonical paint colour while preserving framing, transforms, clip and compound fill", () => {
    const result = filterNativePreviewSvg(svg, ["#a00"]);
    const doc = parse(result);
    const root = doc.documentElement;
    expect(root.getAttribute("viewBox")).toBe("0 0 100 80");
    expect(root.getAttribute("width")).toBe("100");
    expect(doc.getElementsByTagName("g").item(0)?.getAttribute("transform")).toBe("translate(4 5)");
    expect(doc.getElementsByTagName("g").item(0)?.getAttribute("clip-path")).toBe("url(#paper)");
    const path = doc.getElementsByTagName("path").item(0)!;
    expect(path.getAttribute("d")).toBe("M0 0h30v30h-30z M5 5v20h20v-20z");
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(doc.getElementsByTagName("path").length).toBe(1);
    expect(doc.getElementsByTagName("clipPath").length).toBe(1);
  });
  it("dims unselected tool paint without changing SVG geometry or inherited transforms", () => {
    const result = filterNativePreviewSvg(svg, ["#0000ff"], true);
    const doc = parse(result);
    expect(doc.getElementsByTagName("path").item(0)?.getAttribute("d")).toBe("M0 0h30v30h-30z M5 5v20h20v-20z");
    expect(doc.getElementsByTagName("path").item(0)?.getAttribute("opacity")).toBe("0.18");
    expect(doc.getElementsByTagName("path").length).toBe(2);
  });
  it("matches shorthand hex colours case-insensitively", () => {
    expect(filterNativePreviewSvg(svg, ["#AABBCC"])).toContain("fill=\"#AABBCC\"");
  });
  it("keeps fills and their holes when the fill paint matches", () => {
    const doc = parse(filterNativePreviewSvg(svg, ["#aabbcc"]));
    const p = doc.getElementsByTagName("path").item(0)!;
    expect(p.getAttribute("fill-rule")).toBe("evenodd");
    expect(p.getAttribute("stroke")).toBe("none");
    expect(p.getAttribute("d")).toContain("M5 5");
  });
  it.each([
    ["malformed", `<svg><path></svg>`],
    ["script", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
    ["entity", `<!DOCTYPE svg [<!ENTITY x "x">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`],
    ["external reference", `<svg xmlns="http://www.w3.org/2000/svg"><g clip-path="url(https://bad)"><path d="M0 0" stroke="#000"/></g></svg>`],
  ])("rejects %s input", (_label, input) => {
    expect(() => filterNativePreviewSvg(input, ["#000000"])).toThrow();
  });
});
