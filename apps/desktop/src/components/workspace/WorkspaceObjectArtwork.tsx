import type { WorkspaceObject } from "../../workspace-objects";
import type { WorkspaceTool } from "../../project-file";

export function WorkspaceObjectArtwork({ item, tools }: { item: WorkspaceObject; tools?: WorkspaceTool[] }) {
  // Text items: render using SVG <text> elements for live display
  if (item.textContent && item.paths.length === 0) {
    const tc = item.textContent;
    const lineH = tc.fontSize * tc.lineHeight;
    const matchedTool = tools?.find((t) => t.color.toLowerCase() === tc.color.toLowerCase());
    const displayColor = matchedTool ? matchedTool.color : tc.color;
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
            fill={displayColor} letterSpacing={tc.letterSpacing}
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
      {item.paths.map((path) => {
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
            strokeWidth={path.strokeWidth}
            strokeLinecap={path.strokeLinecap as "butt" | "round" | "square" | "inherit" | undefined}
            strokeLinejoin={path.strokeLinejoin as "miter" | "round" | "bevel" | "inherit" | undefined}
            transform={path.pathTransform}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
