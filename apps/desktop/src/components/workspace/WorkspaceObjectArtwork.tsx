import type { WorkspaceObject } from "../../workspace-objects";
import type { WorkspaceTool } from "../../project-file";
import { traceCenterlinePathD } from "../../centerline-trace";
import { buildShapePath } from "../../workspace-shapes";

export function WorkspaceObjectArtwork({ item, tools }: { item: WorkspaceObject; tools?: WorkspaceTool[] }) {
  // Text items: render using SVG <text> elements for live display
  if (item.textContent && item.paths.length === 0) {
    const tc = item.textContent;
    const lineH = tc.fontSize * tc.lineHeight;
    const matchedTool = tools?.find((t) => t.color.toLowerCase() === tc.color.toLowerCase());
    const displayColor = matchedTool ? matchedTool.color : tc.color;
    // A pen draws the glyph outline, not a fill — so pen text renders hollow (outline
    // only), just like shapes/SVGs on a pen tool. Cut text stays filled.
    const isPen = matchedTool?.type === "pen";
    // A pen line is a fixed real-world width (the pen tip), so the stroke shouldn't get
    // fatter just because the text box was scaled up. The viewBox scales by the glyph
    // scale (preserveAspectRatio="meet" → min axis), so dividing by it keeps a constant
    // ~1.5 workspace-px line that still thins out as you zoom away.
    const glyphScale = Math.max(0.01, Math.min(Math.abs(item.transform.scaleX), Math.abs(item.transform.scaleY)));
    const penStrokeWidth = 1.25 / glyphScale;
    // Single-line text: draw open Hershey stroke polylines (a true single pen line),
    // not filled glyphs.
    if (tc.singleLine) {
      const d = traceCenterlinePathD(tc, item.frame);
      return (
        <svg aria-hidden="true" focusable="false" width="100%" height="100%" overflow="visible"
          viewBox={`0 0 ${item.frame.width} ${item.frame.height}`} preserveAspectRatio="xMinYMin meet"
        >
          <path d={d} fill="none" stroke={displayColor} strokeWidth={penStrokeWidth}
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    const anchorX = tc.textAlign === "center" ? item.frame.width / 2 : tc.textAlign === "right" ? item.frame.width - 1 : 1;
    const textAnchor = tc.textAlign === "center" ? "middle" : tc.textAlign === "right" ? "end" : "start";
    return (
      <svg aria-hidden="true" focusable="false" width="100%" height="100%" overflow="visible"
        viewBox={`0 0 ${item.frame.width} ${item.frame.height}`} preserveAspectRatio="xMinYMin meet"
      >
        {tc.text.split("\n").map((line, i) => (
          <text key={i} x={anchorX} y={tc.fontSize + i * lineH}
            fontFamily={tc.fontFamily} fontSize={tc.fontSize}
            fontWeight={tc.fontWeight} fontStyle={tc.fontStyle}
            textDecoration={tc.textDecoration} textAnchor={textAnchor}
            fill={isPen ? "none" : displayColor}
            stroke={isPen ? displayColor : undefined}
            strokeWidth={isPen ? penStrokeWidth : undefined}
            letterSpacing={tc.letterSpacing}
          >{line || " "}</text>
        ))}
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="100%"
      overflow="visible"
      viewBox={`0 0 ${item.frame.width} ${item.frame.height}`}
      preserveAspectRatio="none"
    >
      {(() => {
        // Draw every outline at a constant pen-tip width (~1.5 workspace px) regardless
        // of the object's size/scale, so shapes, SVGs and text all match. Dividing by the
        // object scale cancels the viewBox→item scaling; it still thins out on zoom-out.
        const penStrokeWidth = 1.25 / Math.max(0.01, Math.min(Math.abs(item.transform.scaleX), Math.abs(item.transform.scaleY)));
        // Shapes are generated from their kind + size + corner radius (scale-aware so
        // rounded corners stay circular under non-uniform scaling).
        const shapeD = item.shapeKind
          ? buildShapePath(item.shapeKind, item.frame.width, item.frame.height, item.cornerRadius ?? 0, item.transform.scaleX, item.transform.scaleY)
          : null;
        return item.paths.map((path) => {
        const matchedTool = tools?.find((t) => t.color.toLowerCase() === (path.stroke ?? "").toLowerCase());
        const isPen = matchedTool?.type === "pen";
        let effectiveFill: string;
        if (isPen) {
          effectiveFill = "none";
        } else if (matchedTool) {
          effectiveFill = matchedTool.color;
        } else if (path.fill && path.fill !== "none") {
          effectiveFill = path.fill;
        } else {
          effectiveFill = path.stroke ?? "#000000";
        }
        return (
          <path
            key={path.id}
            d={shapeD ?? path.d}
            fill={effectiveFill}
            fillRule={path.fillRule as "evenodd" | "nonzero" | undefined}
            stroke={path.stroke}
            strokeWidth={penStrokeWidth}
            strokeLinecap={path.strokeLinecap as "butt" | "round" | "square" | "inherit" | undefined}
            strokeLinejoin={path.strokeLinejoin as "miter" | "round" | "bevel" | "inherit" | undefined}
            transform={path.pathTransform}
          />
        );
        });
      })()}
    </svg>
  );
}
