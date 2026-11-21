import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from '@xmldom/xmldom';
import {
  compileNativeMakeDesign,
  NativeMakePreview,
  NativeMakeToolPlans,
  NativeMakeStageIcon,
} from './native-make-design';
import { filterNativePreviewSvg } from './native-make-visual-svg';
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="4.5in" height="6.5in" viewBox="0 0 324 468"><path fill="none" stroke="#0000ff" d="M30 30L60 30"/><path fill="#aabbcc" opacity="0.5" d="M90 90h30v30z"/></svg>',
  source = {
    previewOnly: true as const,
    svg: svg.replace('fill="#aabbcc" opacity="0.5"', 'fill="none" stroke="#aabbcc"'),
    visualSvg: svg,
    materialId: 218,
    mat: { widthIn: 4.5, heightIn: 6.5 },
    strokeTools: {
      '#0000ff': { tool: 'pen' as const, operation: 'draw' as const },
      '#aabbcc': { tool: 'fine_point_blade' as const, operation: 'cut' as const },
    },
  };
it('dims other paint but never makes it disappear or changes its original opacity semantics', () => {
  const d = new DOMParser().parseFromString(
    filterNativePreviewSvg(svg, ['#0000ff'], true),
    'image/svg+xml',
  );
  const p = d.getElementsByTagName('path');
  expect(p.length).toBe(2);
  expect(p.item(1)?.getAttribute('fill')).toBe('#aabbcc');
  expect(Number(p.item(1)?.getAttribute('opacity'))).toBeCloseTo(0.09);
});
it('uses selected card mat in central and Plan glyphs, never long mat', () => {
  const design = compileNativeMakeDesign({ ...source, matPreset: 'joy-card' });
  const h = renderToStaticMarkup(
    <NativeMakeToolPlans design={design} selected={null} onHover={() => {}} language="en" />,
  );
  expect(h.match(/mat-icon--card/g)?.length).toBe(2);
  expect(h).not.toContain('mat-icon--long');
  expect(
    renderToStaticMarkup(<NativeMakeStageIcon kind="load" matVariant="card" large />),
  ).toContain('mat-icon--card');
});
it('has a selected mat frame, no visible preview heading/button/explanation, and no clickable tool tile', () => {
  for (const matPreset of ['joy-card', 'joy-long']) {
    const design = compileNativeMakeDesign({ ...source, matPreset });
    const h = renderToStaticMarkup(
      <NativeMakePreview design={design} selected={null} language="en" />,
    );
    expect(h).toContain(
      matPreset === 'joy-card' ? 'native-make__mat-wrap--card' : 'native-make__mat-wrap--long',
    );
    expect(h).not.toContain('<button');
    expect(h).not.toContain('preview-heading');
    expect(h).not.toContain('preview-caption');
    expect(h).not.toContain('<strong>Full design');
    const plan = renderToStaticMarkup(
      <NativeMakeToolPlans design={design} selected={null} onHover={() => {}} language="en" />,
    );
    expect(plan).not.toContain('<button');
    expect(plan).not.toContain('role="tab"');
    expect(plan).toContain('tabindex="0"');
  }
});
it('fallback preview preserves all tool geometry while dimming others', () => {
  const d = compileNativeMakeDesign({ ...source, visualSvg: undefined });
  const h = renderToStaticMarkup(<NativeMakePreview design={d} selected={0} language="en" />);
  expect(h).toContain('#aabbcc');
  expect(h).toContain('opacity="0.18"');
});
