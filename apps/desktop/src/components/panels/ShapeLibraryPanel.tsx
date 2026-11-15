import type { Language } from "../../i18n";
import { WORKSPACE_SHAPES, type WorkspaceShapeKind, buildShapePath } from "../../workspace-shapes";

/** The real outline of a shape, small, so the tile shows exactly what you get. */
function ShapeIcon({ kind, dashed = false }: { kind: WorkspaceShapeKind; dashed?: boolean }) {
  return (
    <svg className="shape-tile__icon" viewBox="-2 -2 34 34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={buildShapePath(kind, 30, 30, kind === "rounded-square" ? 7 : 0)} strokeDasharray={dashed ? "4 4" : undefined} />
    </svg>
  );
}

export function ShapeLibraryPanel({
  language,
  onAddShape,
}: {
  language: Language;
  onAddShape: (shapeKind: WorkspaceShapeKind, options?: { fold?: boolean }) => void;
}) {
  return (
    <aside
      id="shape-library-panel"
      className="shape-library no-drag"
      aria-label={language === "nl" ? "Vormenbibliotheek" : "Shape library"}
    >
      <p className="panel-label">{language === "nl" ? "Vormen" : "Shapes"}</p>
      <h2>{language === "nl" ? "Kies een basisvorm" : "Choose a basic shape"}</h2>
      <p>{language === "nl" ? "Plaats een vorm op de mat. Daarna kun je hem slepen, vergroten, draaien of kopieren." : "Place a shape on the mat. Then move, resize, rotate, or copy it."}</p>
      <div className="shape-library__grid">
        {WORKSPACE_SHAPES.map((shape) => {
          const label = language === "nl" ? shape.labelNl : shape.labelEn;
          return (
            <button key={shape.kind} type="button" className="shape-tile" onClick={() => onAddShape(shape.kind)}>
              <ShapeIcon kind={shape.kind} />
              <strong>{label}</strong>
            </button>
          );
        })}
        <button type="button" className="shape-tile" onClick={() => onAddShape("line", { fold: true })}
          title={language === "nl"
            ? "Een stippellijn die gesneden wordt: het papier vouwt erlangs maar blijft heel"
            : "A dashed line that is cut: the paper folds along it but stays in one piece"}
        >
          <ShapeIcon kind="line" dashed />
          <strong>{language === "nl" ? "Vouwlijn" : "Fold line"}</strong>
        </button>
      </div>
    </aside>
  );
}
