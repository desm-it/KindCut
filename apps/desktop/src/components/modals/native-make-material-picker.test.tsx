import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeMakeMaterialPicker } from './native-make-material-picker';
it('shows graphical editor weight choices for paper/cardstock with their exact IDs', () => {
  const h = renderToStaticMarkup(
    <NativeMakeMaterialPicker materialId={218} language="nl" onChange={() => {}} />,
  );
  expect(h).toContain('weight-icon');
  expect(h).toContain('Licht');
  expect(h).toContain('Middel');
  expect(h).toContain('Zwaar');
  for (const id of [218, 19, 211]) expect(h).toContain(`data-material-id="${id}"`);
  expect(h).not.toContain('<select');
});
it('shows only the supported on-mat vinyl mode and no paper weights when vinyl is selected', () => {
  const h = renderToStaticMarkup(
    <NativeMakeMaterialPicker materialId={20} language="nl" onChange={() => {}} />,
  );
  expect(h).toContain('Vinyl op mat');
  expect(h).not.toContain('weight-icon');
  expect(h).not.toContain('Smart Vinyl');
});
it('does not mark an unsupported current material as an accepted paper weight', () => {
  const h = renderToStaticMarkup(
    <NativeMakeMaterialPicker materialId={99999} language="en" onChange={() => {}} />,
  );
  expect(h).not.toContain('aria-checked="true"');
});

it('offers insert-card material 535 with the shared card icon, selected independently of paper weights', () => {
  const h = renderToStaticMarkup(
    <NativeMakeMaterialPicker materialId={535} language="nl" onChange={() => {}} />,
  );
  expect(h).toContain('data-material-id="535"');
  expect(h).toContain('Inlegkaart');
  expect(h).toContain('material-icon--insert');
  expect(h).not.toContain('native-make__paper-weights');
  expect(h).toContain('is-selected');
});

it('shows editable card-size and real corner-cut controls for insert cards', () => {
  const h = renderToStaticMarkup(
    <NativeMakeMaterialPicker
      materialId={535}
      language="nl"
      onChange={() => {}}
      cardSize="medium"
      insertSlots
      onCardSizeChange={() => {}}
      onInsertSlotsChange={() => {}}
    />,
  );
  expect(h).toContain('Kaartformaat');
  expect(h).toContain('Hoeksleuven snijden');
  expect(h).toContain('type="checkbox"');
  expect(h).toContain('checked=""');
  expect(h).toContain('Groot');
});

import { readFileSync } from 'node:fs';
import postcss from 'postcss';
it('has one component-owned three-category layout without a competing global definition', () => {
  const global = postcss.parse(readFileSync(new URL('../../styles.css', import.meta.url), 'utf8'));
  const component = postcss.parse(
    readFileSync(new URL('./native-make-preview.css', import.meta.url), 'utf8'),
  );
  const leaked: string[] = [];
  global.walkRules((r) => {
    if (r.selector.includes('native-make')) leaked.push(r.selector);
  });
  expect(leaked).toEqual([]);
  const grids: postcss.Rule[] = [];
  component.walkRules((r) => {
    if (r.selectors.includes('.native-make__material-kinds')) grids.push(r);
  });
  expect(grids).toHaveLength(1);
  const values: string[] = [];
  grids[0]!.walkDecls('grid-template-columns', (d) => {
    values.push(d.value.replace(/\s+/g, ''));
  });
  expect(values).toEqual(['repeat(3,minmax(0,1fr))']);
  const responsive: string[] = [];
  component.walkAtRules('media', (m) => {
    m.walkRules((r) => {
      if (r.selector === '.native-make__workspace')
        r.walkDecls('grid-template-columns', (d) => {
          responsive.push(d.value);
        });
    });
  });
  expect(responsive).toContain('1fr');
});
