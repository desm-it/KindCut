export interface SvgPreflightResult {
  ok: boolean;
  issues: string[];
  warnings: string[];
}

export function preflightSvg(svg: string): SvgPreflightResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!svg.includes("<svg")) {
    issues.push("Input does not look like an SVG document.");
  }

  if (/<(filter|mask|clipPath)/i.test(svg)) {
    warnings.push("SVG uses filters, masks, or clipping paths that may not cut predictably.");
  }

  if (/<text/i.test(svg)) {
    warnings.push("SVG contains text. Convert text to outlines before sending to Cricut.");
  }

  if (!/<path/i.test(svg)) {
    warnings.push("SVG has no path elements yet. Preflight currently focuses on path-based Cricut output.");
  }

  return { ok: issues.length === 0, issues, warnings };
}
