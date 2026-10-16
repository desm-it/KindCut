import { useId } from "react";
import type { PenFillTile } from "@cricut-companion/craft-core";
import type { WorkspaceObject } from "../../workspace-objects";
import type { WorkspaceTool } from "../../project-file";
import { traceCenterlinePathD } from "../../centerline-trace";
import { buildShapePath } from "../../workspace-shapes";
import { PEN_LINE_WIDTH_PX, activePenFill, penFillTileFor, penPathsByColor } from "../../pen-fill-render";

/**
 * The repeating tile of a pen fill. `patternTransform` maps the tile's real-size
 * units into the SVG's user space, so the on-screen spacing matches the strokes
 * that will be drawn (both come from the same lattice in craft-core).
 */
export function PenFillPatternDef({ id, tile, color, patternTransform }: { id: string; tile: PenFillTile; color: string; patternTransform: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={tile.width} height={tile.height}
      patternTransform={`${patternTransform} rotate(${tile.rotation})`}
    >
      <path d={tile.d} fill="none" stroke={color} strokeWidth={PEN_LINE_WIDTH_PX} strokeLinecap="round" strokeLinejoin="round" />
      {tile.dots.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={tile.dotRadius} fill="none" stroke={color} strokeWidth={PEN_LINE_WIDTH_PX} />
      ))}
    </pattern>
  );
}

export function WorkspaceObjectArtwork({ item, tools }: { item: WorkspaceObject; tools?: WorkspaceTool[] }) {
  // SVG ids are document-wide; React ids contain characters that are awkward in url(#…).
  const fillId = `pen-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const penFill = activePenFill(item, tools);
  const fillTile = penFill ? penFillTileFor(item) : null;
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
    // Glyph outlines only exist once the text is traced for cutting, so on screen the
    // fill pattern paints the live glyphs; the cutter gets the same pattern clipped to the trace.
    const textFill = isPen && fillTile ? `url(#${fillId})` : isPen ? "none" : displayColor;
    return (
      <svg aria-hidden="true" focusable="false" width="100%" height="100%" overflow="visible"
        viewBox={`0 0 ${item.frame.width} ${item.frame.height}`} preserveAspectRatio="xMinYMin meet"
      >
        {isPen && fillTile ? (
          <defs>
            <PenFillPatternDef id={fillId} tile={fillTile} color={displayColor} patternTransform={`scale(${1 / glyphScale})`} />
          </defs>
        ) : null}
        {tc.text.split("\n").map((line, i) => (
          <text key={i} x={anchorX} y={tc.fontSize + i * lineH}
            fontFamily={tc.fontFamily} fontSize={tc.fontSize}
            fontWeight={tc.fontWeight} fontStyle={tc.fontStyle}
            textDecoration={tc.textDecoration} textAnchor={textAnchor}
            fill={textFill}
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
    // data-shape-geometry: live resizing rewrites these paths' d directly in the DOM.
    return (
      <svg aria-hidden="true" focusable="false" width="100%" height="100%" overflow="visible"
        viewBox={`0 0 ${aw} ${ah}`} preserveAspectRatio="none"
      >
        {isPen && fillTile ? (
          <>
            <defs>
              <PenFillPatternDef id={fillId} tile={fillTile} color={strokeColor} patternTransform="" />
              <clipPath id={`${fillId}-clip`}>
                <path data-shape-geometry="" d={d} />
              </clipPath>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${fillId})`} clipPath={`url(#${fillId}-clip)`} />
          </>
        ) : null}
        <path data-shape-geometry="" d={d} fill={fill} stroke={strokeColor} strokeWidth={1.25}
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
      {fillTile ? (() => {
        // The pattern is drawn in real-size units, so undo the frame→screen stretch.
        const sx = Math.abs(item.transform.scaleX) || 1;
        const sy = Math.abs(item.transform.scaleY) || 1;
        return penPathsByColor(item, tools).map(({ color, paths }, index) => (
          <g key={color}>
            <defs>
              <PenFillPatternDef id={`${fillId}-${index}`} tile={fillTile} color={color} patternTransform={`scale(${1 / sx} ${1 / sy})`} />
              <clipPath id={`${fillId}-${index}-clip`}>
                {paths.map((path) => (
                  <path key={path.id} d={path.d} transform={path.pathTransform}
                    clipRule={path.fillRule === "evenodd" ? "evenodd" : "nonzero"} />
                ))}
              </clipPath>
            </defs>
            <rect x={-item.frame.width} y={-item.frame.height} width={item.frame.width * 3} height={item.frame.height * 3}
              fill={`url(#${fillId}-${index})`} clipPath={`url(#${fillId}-${index}-clip)`} />
          </g>
        ));
      })() : null}
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
