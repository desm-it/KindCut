import { describe, expect, it } from "vitest";

type Compile = (svg: string, options: any) => any;
async function compiler(): Promise<Compile> {
  const path = "./joy-svg-plan";
  const module = await import(/* @vite-ignore */ path).catch(() => ({}));
  expect(typeof module.compileNormalizedSvgForJoy, "normalized SVG planner API exists").toBe("function");
  return module.compileNormalizedSvgForJoy;
}
const options = () => ({
  mat: { widthIn: 4.5, heightIn: 12 }, materialId: 218,
  strokeTools: { "#112233": { tool: "pen", operation: "draw" } },
});
const svg = (path = 'M 0 0 L 96 0 C 96 0 96 96 0 96 Z') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" preserveAspectRatio="none"><path id="art" fill="none" stroke="#112233" d="${path}"/></svg>`;

describe("compileNormalizedSvgForJoy", () => {
  it("turns the source-replay fixture into a planning-only 72-point cubic plan", async () => {
    const plan = (await compiler())(svg(), options());
    expect(plan.execution).toBe("unsupported");
    expect(plan.unit).toBe("pt72");
    expect(plan.material).toEqual({ widthIn: 1, heightIn: 1, id: 218 });
    expect(plan.groups[0].paths[0].steps[1]).toEqual({ op: "L", points: [{ x: 72, y: 0 }] });
    expect(plan.groups[0].paths[0].steps[2].op).toBe("C");
    expect(plan.groups[0].paths[0].steps[2].points).toHaveLength(3);
  });
  it("composes viewBox origin and ancestor matrix without importing a helper", async () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg" width="96px" height="96px" viewBox="10 20 96 96"><g transform="matrix(1 0 0 1 4 8)"><path fill="none" stroke="#112233" d="M 10 20 L 50 50"/></g></svg>';
    const plan = (await compiler())(text, options());
    expect(plan.groups[0].paths[0].steps[0].points[0]).toEqual({ x: 3, y: 6 });
  });
  it("clips by default and forwards the optional reject policy", async () => {
    const compile = await compiler();
    const text = svg('M -48 0 L 144 96');
    const plan = compile(text, options());
    expect(plan.groups[0].paths[0].steps).toEqual([{op:'M',points:[{x:0,y:18}]},{op:'L',points:[{x:72,y:54}]}]);
    expect(plan.clipping.clippedPathIds).toEqual(['art']);
    expect(() => compile(text, {...options(), boundsPolicy:'reject'})).toThrow(/bounds/i);
  });
  it("checks final calibrated geometry rather than material dimensions alone", async () => {
    const compile = await compiler();
    expect(() => compile(svg(), { ...options(), boundsPolicy: 'reject', calibration: { pen: { xPt: 1, yPt: 0 } } })).toThrow();
    expect(() => compile(svg('M 192 0 L 192 96'), options())).toThrow();
  });
  it("requires an explicit mapping and never silently drops unstroked artwork", async () => {
    const compile = await compiler();
    expect(() => compile(svg().replace('#112233', '#abcdef'), options())).toThrow(/mapping/i);
    expect(() => compile(svg().replace('stroke="#112233"', 'stroke="none"'), options())).toThrow();
    expect(() => compile(svg().replace('stroke="#112233"', ''), options())).toThrow();
  });
  it("normalizes stroke hex case while keeping input options immutable", async () => {
    const opts = options(); const before = JSON.stringify(opts);
    const plan = (await compiler())(svg().replace('#112233', '#AABBCC'), { ...opts, strokeTools: { '#aabbcc': { tool: 'pen', operation: 'draw' } } });
    expect(plan.groups[0].paths[0].color).toBe('#aabbcc');
    expect(JSON.stringify(opts)).toBe(before);
  });
  it.each([
    '<!DOCTYPE svg [<!ENTITY x "x">]>',
    '<?xml-stylesheet href="https://example.invalid/a.css"?>',
  ])("rejects document-level directives before parsing artwork: %s", async prefix => {
    const compile = await compiler();
    expect(() => compile(prefix + svg(), options())).toThrow();
  });
  it.each([
    '<script/>', '<image href="https://example.invalid/a"/>', '<use href="#art"/>',
    '<defs><path d="M 0 0 L 1 1"/></defs>', '<foreignObject/>', '<text>hi</text>',
    '<rect width="1" height="1"/>',
  ])("rejects unsupported elements instead of discarding them: %s", async element => {
    const compile = await compiler();
    expect(() => compile(svg().replace('</svg>', element + '</svg>'), options())).toThrow();
  });
  it.each([
    'onload="alert(1)"', 'style="display:none"', 'clip-path="url(#x)"',
    'stroke-dasharray="1 2"', 'opacity="0"', 'display="none"', 'filter="url(#x)"',
  ])("rejects unsupported presentation/active attributes: %s", async attr => {
    const compile = await compiler();
    expect(() => compile(svg().replace('<path ', `<path ${attr} `), options())).toThrow();
  });
  it("rejects malformed XML even when a permissive parser could repair it", async () => {
    const compile = await compiler();
    expect(() => compile(svg().replace('</svg>', ''), options())).toThrow();
    expect(() => compile(svg() + svg(), options())).toThrow();
    expect(() => compile(svg().replace('/>', '>'), options())).toThrow();
  });
  it("rejects unsupported units, transforms, namespaces and aspect handling", async () => {
    const compile = await compiler();
    for (const bad of [
      svg().replace('width="96"', 'width="1in"'),
      svg().replace('<path ', '<path transform="translate(1 1)" '),
      svg().replace('http://www.w3.org/2000/svg','https://example.invalid/svg'),
      svg().replace('preserveAspectRatio="none"','preserveAspectRatio="xMidYMid meet"'),
      svg().replace('width="96"','width="192"').replace(' preserveAspectRatio="none"',''),
      svg().replace('viewBox="0 0 96 96"','viewBox="0 0 96 96 junk"'),
    ]) expect(() => compile(bad, options())).toThrow();
  });
  it("does not infer width, height or viewBox from fallback defaults", async () => {
    const compile = await compiler();
    for (const attr of ['width="96"','height="96"','viewBox="0 0 96 96"']) {
      expect(() => compile(svg().replace(attr,''), options())).toThrow();
    }
  });
  it("bounds numeric text before regular-expression matching", async () => {
    const compile = await compiler();
    expect(() => compile(svg().replace('width="96"', `width="${'0'.repeat(1000)}96"`), options())).toThrow(/numeric.*length/i);
    expect(() => compile(svg().replace('<path ', `<path transform="matrix(${' '.repeat(1000)}1 0 0 1 0 0)" `), options())).toThrow(/transform.*length/i);
  });
  it("rejects malformed comma separators before geometry compilation", async () => {
    const compile = await compiler();
    expect(() => compile(svg().replace('viewBox="0 0 96 96"', 'viewBox="0,,0,96,96"'), options())).toThrow(/separator/i);
    expect(() => compile(svg().replace('<path ', '<path transform="matrix(1,,0,0,1,0,0)" '), options())).toThrow(/separator/i);
  });
  it("limits SVG size and nesting before unbounded traversal", async () => {
    const compile = await compiler();
    expect(() => compile(' '.repeat(1_000_001), options())).toThrow();
    const nested = svg().replace('<path ', '<g>'.repeat(40)+'<path ').replace('</svg>','</g>'.repeat(40)+'</svg>');
    expect(() => compile(nested, options())).toThrow();
  });
});
