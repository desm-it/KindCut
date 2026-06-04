export function normalizeAiSvg(svg: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const root = doc.querySelector("svg");
  if (!root) return svg;

  const vb = root.getAttribute("viewBox") ?? "";
  const vbParts = vb.split(/\s+/).map(Number);
  const vbW = vbParts[2] ?? 0;
  const vbH = vbParts[3] ?? 0;

  function resolveDim(val: string | null, refSize: number): number {
    if (!val) return 0;
    const trimmed = val.trim();
    if (trimmed.endsWith("%")) return (parseFloat(trimmed) / 100) * refSize;
    const n = parseFloat(trimmed);
    return isNaN(n) ? 0 : n;
  }

  function isLightOrDefault(c: string): boolean {
    const cleaned = c.trim().toLowerCase();
    return (
      cleaned === "" || cleaned === "white" || cleaned === "#fff" ||
      cleaned === "#ffffff" || cleaned === "transparent" || cleaned === "none"
    );
  }

  function coversViewBox(el: Element): boolean {
    const x = resolveDim(el.getAttribute("x"), vbW);
    const y = resolveDim(el.getAttribute("y"), vbH);
    const w = resolveDim(el.getAttribute("width"), vbW);
    const h = resolveDim(el.getAttribute("height"), vbH);
    if (w === 0 || h === 0 || vbW === 0 || vbH === 0) return false;
    // Covers ≥ 85 % of viewBox starting near the origin
    return x <= vbW * 0.1 && y <= vbH * 0.1 && w >= vbW * 0.85 && h >= vbH * 0.85;
  }

  // Remove ALL rects that are either large background candidates or light-colored.
  // Also remove any rect whose stroke would be invisible (no stroke = SVG default none on rects).
  for (const rect of Array.from(root.querySelectorAll("rect"))) {
    const fill = rect.getAttribute("fill") ?? "";
    const stroke = rect.getAttribute("stroke") ?? "";
    // Keep only rects that are small design elements with an explicit dark stroke
    const isSmall = !coversViewBox(rect);
    const hasVisibleStroke = stroke && !isLightOrDefault(stroke);
    const hasDarkFill = fill && !isLightOrDefault(fill);
    if (!(isSmall && (hasVisibleStroke || hasDarkFill))) {
      rect.remove();
    }
  }

  // Strip inline styles from groups/svg root before processing shapes
  for (const el of Array.from(root.querySelectorAll("g"))) {
    el.removeAttribute("style");
  }
  root.removeAttribute("style");

  // Normalize all path/shape elements.
  // Potrace outputs fill="#000000" stroke="none".
  // We keep fill="#000000" so the saved SVG file has fill data baked in
  // (visible in library previews and portable to other tools).
  // stroke="#000000" is kept for tool color matching in WorkspaceObjectArtwork.
  const shapeSelectors = ["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"];
  for (const el of Array.from(root.querySelectorAll(shapeSelectors.join(",")))) {
    el.setAttribute("stroke", "#000000");
    el.setAttribute("fill", "#000000");
    el.setAttribute("stroke-width", "1");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    el.removeAttribute("style");
    el.removeAttribute("stroke-opacity");
    el.removeAttribute("fill-opacity");
    el.removeAttribute("opacity");
  }

  return new XMLSerializer().serializeToString(doc);
}

export function aiSvgPreviewSrc(svg: string): string {
  const c = "#5a3a1a";
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(
    svg
      .replace(/\sfill="[^"]*"/gi, ` fill="${c}"`)
      .replace(/\sfill='[^']*'/gi, ` fill='${c}'`)
      .replace(/\sstroke="[^"]*"/gi, ' stroke="none"')
      .replace(/\sstroke='[^']*'/gi, " stroke='none'")
      .replace(/\sstroke-width="[^"]*"/gi, "")
      .replace(/\sstroke-width='[^']*'/gi, ""),
  )))}`;
}

export function getSandboxedSvgPreview(svg: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline';" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        display: grid;
        place-items: center;
        background: #fffdf9;
      }

      svg {
        max-width: 92%;
        max-height: 92%;
        overflow: visible;
      }

      svg [stroke]:not([stroke="none"]) {
        vector-effect: non-scaling-stroke;
      }
    </style>
  </head>
  <body>${svg}</body>
</html>`;
}
