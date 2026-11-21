import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  compileNativeMakeDesign,
  NativeMakeToolPlans,
  NativeMakePreview,
} from './native-make-design';
const source = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#112233" d="M50 50 L80 50"/><path fill="none" stroke="#445566" d="M50 80 L80 80"/><path fill="none" stroke="#aa8866" d="M100 100 L140 100 L140 140 Z"/></svg>',
  materialId: 211,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: {
    '#112233': { tool: 'pen' as const, operation: 'draw' as const },
    '#445566': { tool: 'pen' as const, operation: 'draw' as const },
    '#aa8866': { tool: 'fine_point_blade' as const, operation: 'cut' as const },
  },
};
it('builds one preview/tool step for each pen colour and then cut', () => {
  const d = compileNativeMakeDesign(source);
  expect(d.tools).toHaveLength(3);
  expect(d.tools.filter((t) => t.tool === 'pen').map((t) => t.paths[0]!.color)).toEqual([
    '#112233',
    '#445566',
  ]);
});
it('uses original-style load / each coloured pen / cut / unload icons, not numeric generic stages', () => {
  const h = renderToStaticMarkup(
    <NativeMakeToolPlans
      design={compileNativeMakeDesign(source)}
      selected={null}
      onHover={() => {}}
      language="en"
    />,
  );
  expect(h.match(/data-step-kind=/g)).toHaveLength(5);
  expect(h).toContain('data-step-kind="load"');
  expect(h).toContain('data-step-kind="unload"');
  expect(h).toContain('#112233');
  expect(h).toContain('#445566');
  expect(h).not.toContain('native-make__tool-number');
  expect(h).not.toContain('Prepare</');
});
it('offers a full-design preview by default rather than showing only the first tool', () => {
  const h = renderToStaticMarkup(
    <NativeMakePreview design={compileNativeMakeDesign(source)} selected={null} language="en" />,
  );
  expect(h).toContain('Full design');
  expect(h).toContain('#112233');
  expect(h).toContain('#445566');
  expect(h).toContain('#aa8866');
});

const visual =
  '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><defs><clipPath id="paper"><rect width="432" height="1152"/></clipPath></defs><g clip-path="url(#paper)" transform="translate(0 0)"><path d="M50 50 L80 50" fill="none" stroke="#112233"/><path d="M50 80 L80 80" fill="none" stroke="#445566"/><path d="M100 100h60v60h-60z M110 110v30h30v-30z" fill="#aa8866" fill-rule="evenodd"/></g></svg>';
const decodedPreview = (selected: number | null) => {
  const d = compileNativeMakeDesign({
    ...source,
    svg: source.svg.replace('width="432" height="1152"', 'width="4.5in" height="12in"'),
    previewOnly: true as const,
    visualSvg: visual,
    paperColor: '#ffffff',
    behindColor: '#aa8866',
  });
  const h = renderToStaticMarkup(
    <NativeMakePreview design={d} selected={selected} language="en" />,
  );
  const encoded = h.match(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/)?.[1];
  expect(encoded).toBeDefined();
  return decodeURIComponent(encoded!);
};
it('keeps original filled-cut holes and both pens in full preview', () => {
  const svg = decodedPreview(null);
  expect(svg).toBe(visual);
  expect(svg).toContain('fill="#aa8866"');
  expect(svg).toContain('fill-rule="evenodd"');
});
it('hovered pen keeps every tool paint and dims only the other paths', () => {
  const svg = decodedPreview(1);
  expect(svg).toContain('stroke="#445566"');
  expect(svg).toContain('stroke="#112233"');
  expect(svg).toContain('fill="#aa8866"');
  expect(svg.match(/opacity="0.18"/g)).toHaveLength(2);
  expect(svg).toContain('clip-path="url(#paper)"');
});
it('hovered cut preserves the filled compound hole and dims both pens', () => {
  const svg = decodedPreview(2);
  expect(svg).toContain('fill="#aa8866"');
  expect(svg).toContain('fill-rule="evenodd"');
  expect(svg).toContain('M110 110v30h30v-30z');
  expect(svg).toContain('stroke="#112233"');
  expect(svg).toContain('stroke="#445566"');
  expect(svg.match(/opacity="0.18"/g)).toHaveLength(2);
});

it('keeps accessible tool labels out of icon layout instead of rendering a second text row inside the tile', () => {
  const h = renderToStaticMarkup(
    <NativeMakeToolPlans
      design={compileNativeMakeDesign(source)}
      selected={null}
      onHover={() => {}}
      language="en"
    />,
  );
  expect(h).not.toContain('class="sr-only"');
  expect(h).toContain('aria-label="Pen #112233"');
});
