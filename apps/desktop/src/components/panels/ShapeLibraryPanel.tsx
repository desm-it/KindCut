import type { Language } from "../../i18n";
import { WORKSPACE_SHAPES, type WorkspaceShapeKind } from "../../workspace-shapes";

export function ShapeLibraryPanel({
  language,
  onAddShape,
}: {
  language: Language;
  onAddShape: (shapeKind: WorkspaceShapeKind) => void;
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
              <span aria-hidden="true">{shape.icon}</span>
              <strong>{label}</strong>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
