import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  compileNativeMakeDesign,
  NativeMakePreview,
  NativeMakeToolPlans,
} from './native-make-design';
const base = {
  previewOnly: true as const,
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="4.5in" height="12in" viewBox="0 0 360 960"><path fill="none" stroke="#000000" d="M20 20L40 40"/></svg>',
  materialId: 218,
  mat: { widthIn: 4.5, heightIn: 12 },
  strokeTools: { '#000000': { tool: 'pen' as const, operation: 'draw' as const } },
};
it.each([
  ['joy-standard', 'long'],
  ['joy-standard-short', 'short'],
  ['joy-card', 'card'],
])(
  'uses actual %s mat only in preview, keeping compact right-side mat illustrations',
  (matPreset, variant) => {
    const d = compileNativeMakeDesign({ ...base, matPreset });
    const preview = renderToStaticMarkup(
      <NativeMakePreview design={d} selected={null} language="en" />,
    );
    expect(preview).toContain(`native-make__mat-wrap--${variant}`);
    expect(preview).toContain('native-make__mat-backing');
    const right = renderToStaticMarkup(
      <NativeMakeToolPlans design={d} selected={null} language="en" />,
    );
    expect(right).not.toContain('native-make__mat-wrap--long');
    expect(right).toContain(variant === 'card' ? 'mat-icon--card' : 'mat-icon--short');
    expect(d.widthPt).toBe(324);
    expect(d.heightPt).toBe(864);
  },
);
it('infers a long preview from the actual dimensions when older visual inputs omit matPreset', () => {
  const d = compileNativeMakeDesign(base);
  expect(
    renderToStaticMarkup(<NativeMakePreview design={d} selected={null} language="en" />),
  ).toContain('native-make__mat-wrap--long');
});
