import { describe, expect, it } from 'vitest';
import { CARD_TEMPLATES, buildTemplateItems, buildTemplatePreviewSvg } from './card-templates';
import { buildWorkspaceCutSvg } from './workspace-objects';
import {
  CARD_SIZES,
  getMatDimensionsInches,
  getWorkspaceSelectionBounds,
  mmToWorkspacePx,
} from './workspace-utils';
import type { WorkspaceSvgItem, WorkspaceTextContent } from './workspace-objects';

// Stand-in for the browser's text measuring.
function createText(content: WorkspaceTextContent, _index: number, id: string): WorkspaceSvgItem {
  return {
    id,
    type: 'path',
    kind: 'text',
    sourceKind: 'text',
    fileName: content.text,
    fileSize: '',
    sizeCopy: '',
    frame: { width: content.text.length * content.fontSize * 0.5, height: content.fontSize * 1.25 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    paths: [] as unknown as WorkspaceSvgItem['paths'],
    textContent: content,
  } as WorkspaceSvgItem;
}

function build(id: string) {
  const template = CARD_TEMPLATES.find((candidate) => candidate.id === id)!;
  return {
    template,
    items: buildTemplateItems({
      template,
      language: 'nl',
      cutColor: '#8f4f2b',
      penColor: '#000000',
      timestamp: 1,
      createText,
    }),
  };
}

describe('card templates', () => {
  it('keeps every template on its paper', () => {
    for (const template of CARD_TEMPLATES) {
      const { items } = build(template.id);
      const dims = template.cardSize
        ? CARD_SIZES[template.cardSize]
        : getMatDimensionsInches(template.matPreset);
      const bounds = getWorkspaceSelectionBounds(items)!;
      expect(bounds.left, template.id).toBeGreaterThanOrEqual(0);
      expect(bounds.top, template.id).toBeGreaterThanOrEqual(0);
      expect(bounds.right, template.id).toBeLessThanOrEqual(dims.width * 80);
      expect(bounds.bottom, template.id).toBeLessThanOrEqual(dims.height * 80);
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      // Centred left to right on the sheet, so the paper's middle line and the design's coincide.
      expect(bounds.center.x, template.id).toBeCloseTo((dims.width * 80) / 2, 0);
    }
  });

  it('puts the fold line across the middle of the folded card, as a dashed cut', () => {
    const { items } = build('folded-card');
    const card = items[0]!;
    const fold = items.find((item) => item.dashed)!;
    expect(fold.shapeKind).toBe('line');
    expect(fold.dashed?.enabled).toBe(true);
    const cardBounds = getWorkspaceSelectionBounds([card])!;
    const foldBounds = getWorkspaceSelectionBounds([fold])!;
    expect(foldBounds.center.y).toBeCloseTo(cardBounds.center.y, 3);
    expect(foldBounds.left).toBeCloseTo(cardBounds.left, 3);
    expect(foldBounds.right).toBeCloseTo(cardBounds.right, 3);
    // Only the card outline and the fold are cut; the decoration is drawn.
    expect(items.filter((item) => item.paths[0]?.stroke === '#8f4f2b')).toHaveLength(2);
  });

  it('sends a fold line to the cutter as separate short cuts', () => {
    const { items } = build('place-card');
    const fold = items.find((item) => item.dashed)!;
    const svg = buildWorkspaceCutSvg([fold], 360, 520, [{ color: '#8f4f2b', type: 'cut' }]);
    const d = svg.match(/ d="([^"]+)"/)?.[1] ?? '';
    const pieces = d.split('M').filter(Boolean);
    // 90 mm of 3 mm cuts and 3 mm bridges.
    expect(pieces.length).toBe(15);
    const [x1, , x2] = pieces[0]!.split(/[ L]/).map(Number);
    expect(x2! - x1!).toBeCloseTo(mmToWorkspacePx(3), 1);
    expect(svg).toContain('fill="none"');
  });

  it('centres text on its point and uses the app language', () => {
    const { items } = build('gift-tag');
    const text = items.find((item) => item.textContent)!;
    expect(text.textContent?.text).toBe('Voor jou');
    const bounds = getWorkspaceSelectionBounds([text])!;
    expect(bounds.center.x).toBeCloseTo(mmToWorkspacePx(57.15), 1);
    expect(bounds.center.y).toBeCloseTo(mmToWorkspacePx(75), 1);
  });

  it('draws a preview for every template', () => {
    for (const template of CARD_TEMPLATES) {
      const svg = buildTemplatePreviewSvg(template, 'en');
      expect(svg).toMatch(/^<svg /);
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });
});
