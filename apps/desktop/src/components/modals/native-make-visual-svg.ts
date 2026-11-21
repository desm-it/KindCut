import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SVG_LENGTH = 1_000_000;
const MAX_NODES = 10_000;
const ALLOWED = new Set([
  'svg',
  'g',
  'defs',
  'clipPath',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
]);
const PAINT = new Set(['fill', 'stroke']);

/** Filter native-preview geometry without changing its SVG geometry or coordinate system. */
export function filterNativePreviewSvg(
  svg: string,
  colors: readonly string[],
  dimOthers = false,
): string {
  if (svg.length > MAX_SVG_LENGTH || /<!DOCTYPE|<!ENTITY/i.test(svg))
    throw new Error('Unsafe or oversized preview SVG');
  const selected = new Set(
    colors.map(canonicalColor).filter((color): color is string => color !== null),
  );
  let nodes = 0;
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: (e: string) => errors.push(e),
      error: (e: string) => errors.push(e),
      fatalError: (e: string) => errors.push(e),
    },
  }).parseFromString(svg, 'image/svg+xml');
  if (
    errors.length ||
    doc.doctype ||
    !doc.documentElement ||
    doc.documentElement.localName !== 'svg' ||
    doc.documentElement.namespaceURI !== SVG_NS
  )
    throw new Error('Malformed preview SVG');
  const root = doc.documentElement;
  const check = (node: Element): void => {
    if (++nodes > MAX_NODES) throw new Error('Preview SVG has too many nodes');
    if (node.namespaceURI !== SVG_NS || !ALLOWED.has(node.localName))
      throw new Error(`Unsupported SVG element: ${node.localName}`);
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i)!;
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (
        name !== 'xmlns' &&
        !name.startsWith('xmlns:') &&
        ((name.startsWith('on') && name.length > 2) ||
          name === 'style' ||
          name === 'href' ||
          name.endsWith(':href') ||
          /javascript:|data:|https?:/i.test(value) ||
          (/url\s*\(/i.test(value) && !/^url\(\s*#[\w.-]+\s*\)$/i.test(value)))
      )
        throw new Error('Unsafe preview SVG attribute');
      if (name === 'clip-path' && value && !/^url\(\s*#[\w.-]+\s*\)$/i.test(value))
        throw new Error('Unsupported clip reference');
    }
    for (const child of Array.from(node.childNodes))
      if (child.nodeType === 1) check(child as Element);
  };
  check(root);
  const paint = (node: Element, key: string): string | null => {
    let current: Element | null = node;
    while (current) {
      if (current.hasAttribute(key)) return canonicalColor(current.getAttribute(key)!);
      current = current.parentNode?.nodeType === 1 ? (current.parentNode as Element) : null;
    }
    return null;
  };
  const visit = (parent: Element): void => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      if (child.localName === 'defs' || child.localName === 'clipPath') continue;
      if (child.localName === 'g' || child.localName === 'svg') {
        visit(child);
        continue;
      }
      const fill = paint(child, 'fill'),
        stroke = paint(child, 'stroke');
      const keepFill = fill !== null && selected.has(fill),
        keepStroke = stroke !== null && selected.has(stroke);
      if (dimOthers) {
        const dim = (key: string) => {
          let owner: Element | null = child;
          while (owner && !owner.hasAttribute(key))
            owner = owner.parentNode?.nodeType === 1 ? (owner.parentNode as Element) : null;
          const raw = owner?.getAttribute(key)?.trim(),
            a = raw?.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw ?? 1);
          child.setAttribute(key, String((Number.isFinite(a) && a >= 0 && a <= 1 ? a : 1) * 0.18));
        };
        if (!keepFill && !keepStroke) {
          const a = Number(child.getAttribute('opacity') || 1);
          child.setAttribute(
            'opacity',
            String((Number.isFinite(a) && a >= 0 && a <= 1 ? a : 1) * 0.18),
          );
        } else {
          if (fill !== null && !keepFill) dim('fill-opacity');
          if (stroke !== null && !keepStroke) dim('stroke-opacity');
        }
        continue;
      }
      if (!keepFill && !keepStroke) {
        parent.removeChild(child);
        continue;
      }
      // A two-paint shape must not leak another tool's paint into this preview.
      if (!keepFill) child.setAttribute('fill', 'none');
      if (!keepStroke) child.setAttribute('stroke', 'none');
    }
  };
  visit(root);
  return new XMLSerializer().serializeToString(doc);
}

function canonicalColor(value: string): string | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1]!.toLowerCase();
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join('')}` : `#${hex}`;
}
