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

  // Shapes render in a viewBox that matches their ACTUAL (scaled) size, so the path is
  // never stretched per-axis. That keeps the pen outline an even thickness and the
  // corners truly circular even when the shape is squashed flat (a frame-sized viewBox
  // with preserveAspectRatio="none" would stretch the stroke into blobs on the ends).
  if (item.shapeKind) {
    const sx = Math.abs(item.transform.scaleX) || 1;
    const sy = Math.abs(item.transform.scaleY) || 1;
    const aw = Math.max(1, item.frame.width * sx);
    const ah = Math.max(1, item.frame.height * sy);
    const worldRadius = Math.min((item.cornerRadius ?? 0) * Math.min(sx, sy), Math.min(aw, ah) / 2);
    const d = buildShapePath(item.shapeKind, aw, ah, worldRadius);
    const path = item.paths[0];
    const matchedTool = tools?.find((tl) => tl.color.toLowerCase() === (path?.stroke ?? "").toLowerCase());
    const isPen = matchedTool?.type === "pen";
    const strokeColor = matchedTool ? matchedTool.color : path?.stroke ?? "#000000";
    const fill = isPen
      ? "none"
      : matchedTool
        ? matchedTool.color
        : path?.fill && path.fill !== "none"
          ? path.fill
          : path?.stroke ?? "#000000";
    return (
      <svg aria-hidden="true" focusable="false" width="100%" height="100%" overflow="visible"
        viewBox={`0 0 ${aw} ${ah}`} preserveAspectRatio="none"
      >
        <path d={d} fill={fill} stroke={strokeColor} strokeWidth={1.25}
          strokeLinecap="round" strokeLinejoin="round" />
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
        // Draw every outline at a constant pen-tip width regardless of the object's
        // size/scale; dividing by the object scale cancels the viewBox→item scaling.
        const penStrokeWidth = 1.25 / Math.max(0.01, Math.min(Math.abs(item.transform.scaleX), Math.abs(item.transform.scaleY)));
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
            d={path.d}
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
