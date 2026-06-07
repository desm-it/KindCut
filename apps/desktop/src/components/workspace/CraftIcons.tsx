// Shared craft glyphs used by the workspace material/mat pickers and the cut modal's
// visual progress, so the icons stay consistent across the app.

// Material categories → slicebug material IDs.
export const PAPER_MATERIAL_IDS = [218, 19, 211]; // light, medium, heavy
export const MATERIAL_INSERT_ID = 535;
export const MATERIAL_VINYL_ID = 20;

export type MaterialKind = "paper" | "insert" | "vinyl";

export function materialCategoryOf(id: number): MaterialKind {
  if (id === MATERIAL_INSERT_ID) return "insert";
  if (id === MATERIAL_VINYL_ID) return "vinyl";
  return "paper";
}

export type MatVariant = "long" | "short" | "card";

export function matPresetToVariant(matPreset: string): MatVariant {
  if (matPreset === "joy-card") return "card";
  if (matPreset === "joy-standard-short") return "short";
  return "long";
}

/**
 * Tiny mat illustration. Green long/short show a gridded green middle; the blue card
 * shows raised bands + a white middle. Both have a small white line where the text sits.
 */
// Real Joy mat aspect ratios (width ÷ height): the long standard mat is slim and tall; the
// short standard and card mats are much wider. Width follows the height so a large icon (e.g.
// the cut modal's load/unload step) keeps the right shape instead of looking long and narrow.
const MAT_ASPECT: Record<MatVariant, number> = {
  long: 4.5 / 12, // 0.375 — slim
  short: 4.5 / 6.5, // 0.69 — wide
  card: 4.5 / 6.25, // 0.72 — wide
};

export function MatIcon({ variant, height }: { variant: MatVariant; height?: number }) {
  const h = height ?? (variant === "long" ? 80 : variant === "short" ? 43 : 42);
  const w = Math.round(h * MAT_ASPECT[variant]);
  if (variant === "card") {
    return (
      <span className="mat-icon mat-icon--card" style={{ width: w, height: h }} aria-hidden="true">
        <span className="mat-icon__band mat-icon__band--top" />
        <span className="mat-icon__paper" />
        <span className="mat-icon__band mat-icon__band--bottom" />
        <span className="mat-icon__line" />
      </span>
    );
  }
  return (
    <span className={`mat-icon mat-icon--${variant}`} style={{ width: w, height: h }} aria-hidden="true">
      <span className="mat-icon__grid" />
      <span className="mat-icon__line" />
    </span>
  );
}

/** Colored glyph for a material category. */
export function MaterialIcon({ kind }: { kind: MaterialKind }) {
  return (
    <span className={`material-icon material-icon--${kind}`} aria-hidden="true">
      {kind === "paper" && (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3"/></svg>
      )}
      {kind === "insert" && (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6 C8 4.8 5.5 4.8 3.5 5.5 L3.5 14.5 C5.5 13.8 8 13.8 10 15"/><path d="M10 6 C12 4.8 14.5 4.8 16.5 5.5 L16.5 14.5 C14.5 13.8 12 13.8 10 15"/></svg>
      )}
      {kind === "vinyl" && (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <g transform="rotate(-45 10 10)">
            <path d="M6 6 H12.5"/>
            <path d="M6 14 H12.5"/>
            <path d="M12.5 6 A2 4 0 0 1 12.5 14"/>
            <ellipse cx="6" cy="10" rx="2" ry="4"/>
            <ellipse cx="6" cy="10" rx="0.8" ry="1.7"/>
          </g>
        </svg>
      )}
    </span>
  );
}

// A used cutting tool: a pen drawn in its colour, or the blade for a cut.
export type CutToolKind = "pen" | "fine_point_blade";

export function ToolGlyph({ tool, color }: { tool: CutToolKind; color: string }) {
  if (tool === "pen") {
    return (
      <span className="tool-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19l2-5L16 5l3 3-9 9-5 2z" />
          <path d="M14 7l3 3" />
        </svg>
      </span>
    );
  }
  return (
    <span className="tool-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <path d="M8 7.5L20 18 M8 16.5L20 6" />
      </svg>
    </span>
  );
}

// "fine_point_blade" → "Fine point blade", "pen" → "Pen".
export function prettyToolName(tool: string): string {
  const spaced = tool.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
