import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  nativeMakePreviewMatLayout,
  NativeMakePreview,
  NativeMakeToolPlans,
  compileNativeMakeDesign,
} from './native-make-design';
it.each([12, 6.5, 6.25])(
  'uses half-inch sides and one-inch ends around a 4.5 × %s inch paper',
  (height) => {
    const l = nativeMakePreviewMatLayout(4.5 * 72, height * 72);
    expect(l.outerWidthPt).toBe(5.5 * 72);
    expect(l.outerHeightPt).toBe((height + 2) * 72);
    const [top = NaN, side = NaN] = l.inset.split(' ').map(parseFloat);
    expect((top / 100) * l.outerHeightPt).toBeCloseTo(72);
    expect((side / 100) * l.outerWidthPt).toBeCloseTo(36);
    expect(l.widthPx / 350).toBeCloseTo(5.5 / (height + 2));
  },
);
it('uses a plain preview backing and paper, without a mat grid or fallback SVG pattern', () => {
  const d = compileNativeMakeDesign({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="1152" viewBox="0 0 432 1152"><path fill="none" stroke="#000000" d="M40 40 L60 60"/></svg>',
    materialId: 218,
    mat: { widthIn: 4.5, heightIn: 12 },
    strokeTools: { '#000000': { tool: 'pen', operation: 'draw' } },
  });
  const h = renderToStaticMarkup(<NativeMakePreview design={d} selected={null} language="en" />);
  expect(h).not.toContain('<pattern');
  expect(h).not.toContain('mat-icon__grid');
  expect(h).toContain('native-make__mat-backing');
  const plan = renderToStaticMarkup(
    <NativeMakeToolPlans design={d} selected={null} language="en" />,
  );
  expect(plan).toContain('mat-icon--short');
});
