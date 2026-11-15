// Ready-made starting points for the things people make most on a Cricut Joy.
// A template is plain data (sizes in millimetres); it becomes ordinary objects on
// the mat, so everything in it can be moved, changed or removed afterwards.

import { DEFAULT_DASH } from "@cricut-companion/craft-core";
import type { WorkspaceObject, WorkspacePathData, WorkspaceSvgItem, WorkspaceTextContent } from "./workspace-objects";
import { LINE_SHAPE_HEIGHT, type WorkspaceShapeKind, buildShapePath, getWorkspaceShapeDefinition } from "./workspace-shapes";
import { type CardSize, mmToWorkspacePx, rotatePoint } from "./workspace-utils";

type Words = { nl: string; en: string };
type TemplateTool = "cut" | "pen";

export type TemplatePart =
  | { kind: "shape"; shape: Exclude<WorkspaceShapeKind, "line">; xMm: number; yMm: number; widthMm: number; heightMm: number; cornerRadiusMm?: number; tool: TemplateTool; /** The piece you keep: shown as its cut line, not as a hole. */ keep?: boolean }
  /** A straight line from one point to another; `fold` makes it a dashed fold line. */
  | { kind: "line"; x1Mm: number; y1Mm: number; x2Mm: number; y2Mm: number; tool: TemplateTool; fold?: boolean }
  /** Single-line pen writing, centred on a point. */
  | { kind: "text"; text: Words; centerXMm: number; centerYMm: number; sizeMm: number; tool: TemplateTool };

export type CardTemplate = {
  id: string;
  name: Words;
  description: Words;
  matPreset: string;
  materialId: number;
  cardSize: CardSize | null;
  insertSlots: boolean;
  /** The sheet the template is laid out on, for the preview. */
  paperMm: { width: number; height: number };
  parts: TemplatePart[];
};

// Everything is centred on the sheet: 57.15 mm is the middle of the 114.3 mm wide mat,
// 53.975 mm the middle of a medium insert card.
const MATERIAL_MEDIUM_CARDSTOCK = 19;
const MATERIAL_INSERT_CARD = 535;

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    id: "insert-card-heart",
    name: { nl: "Inlegkaart met hartje", en: "Insert card with heart" },
    description: { nl: "Een uitgesneden hart laat het gekleurde inlegvel zien.", en: "A cut-out heart shows the coloured insert." },
    matPreset: "joy-card",
    materialId: MATERIAL_INSERT_CARD,
    cardSize: "medium",
    insertSlots: true,
    paperMm: { width: 107.95, height: 139.7 },
    parts: [
      { kind: "shape", shape: "heart", xMm: 28.975, yMm: 34, widthMm: 50, heightMm: 46, tool: "cut" },
      { kind: "text", text: { nl: "Voor jou", en: "For you" }, centerXMm: 53.975, centerYMm: 103, sizeMm: 11, tool: "pen" },
    ],
  },
  {
    id: "folded-card",
    name: { nl: "Vouwkaart", en: "Folded card" },
    description: { nl: "Kaart van 10 × 14 cm uit eigen papier, met vouwlijn.", en: "A 10 × 14 cm card from your own paper, with a fold line." },
    matPreset: "joy-standard",
    materialId: MATERIAL_MEDIUM_CARDSTOCK,
    cardSize: null,
    insertSlots: false,
    paperMm: { width: 114.3, height: 304.8 },
    parts: [
      { kind: "shape", shape: "square", xMm: 7.15, yMm: 12, widthMm: 100, heightMm: 280, tool: "cut", keep: true },
      { kind: "line", x1Mm: 7.15, y1Mm: 152, x2Mm: 107.15, y2Mm: 152, tool: "cut", fold: true },
      // The lower half is the front once the card is folded.
      { kind: "shape", shape: "heart", xMm: 42.15, yMm: 185, widthMm: 30, heightMm: 27, tool: "pen" },
      { kind: "text", text: { nl: "Gefeliciteerd!", en: "Congratulations!" }, centerXMm: 57.15, centerYMm: 236, sizeMm: 11, tool: "pen" },
    ],
  },
  {
    id: "gift-tag",
    name: { nl: "Cadeaulabel", en: "Gift tag" },
    description: { nl: "Label van 5 × 9 cm met een gaatje voor een lint.", en: "A 5 × 9 cm tag with a hole for a ribbon." },
    matPreset: "joy-standard-short",
    materialId: MATERIAL_MEDIUM_CARDSTOCK,
    cardSize: null,
    insertSlots: false,
    paperMm: { width: 114.3, height: 165.1 },
    parts: [
      { kind: "shape", shape: "square", xMm: 32.15, yMm: 25, widthMm: 50, heightMm: 90, cornerRadiusMm: 6, tool: "cut", keep: true },
      { kind: "shape", shape: "circle", xMm: 54.65, yMm: 32, widthMm: 5, heightMm: 5, tool: "cut" },
      { kind: "text", text: { nl: "Voor jou", en: "For you" }, centerXMm: 57.15, centerYMm: 75, sizeMm: 9, tool: "pen" },
    ],
  },
  {
    id: "place-card",
    name: { nl: "Tafelkaartje", en: "Place card" },
    description: { nl: "Staand kaartje van 9 × 5,5 cm voor een naam.", en: "A standing 9 × 5.5 cm card for a name." },
    matPreset: "joy-standard-short",
    materialId: MATERIAL_MEDIUM_CARDSTOCK,
    cardSize: null,
    insertSlots: false,
    paperMm: { width: 114.3, height: 165.1 },
    parts: [
      { kind: "shape", shape: "square", xMm: 12.15, yMm: 25, widthMm: 90, heightMm: 110, tool: "cut", keep: true },
      { kind: "line", x1Mm: 12.15, y1Mm: 80, x2Mm: 102.15, y2Mm: 80, tool: "cut", fold: true },
      { kind: "text", text: { nl: "Naam", en: "Name" }, centerXMm: 57.15, centerYMm: 107.5, sizeMm: 14, tool: "pen" },
    ],
  },
];

export function templateTextContent(part: Extract<TemplatePart, { kind: "text" }>, language: "nl" | "en", color: string): WorkspaceTextContent {
  return {
    text: part.text[language],
    fontFamily: "sans-serif",
    fontSize: Math.round(mmToWorkspacePx(part.sizeMm)),
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
    textAlign: "left",
    letterSpacing: 0,
    lineHeight: 1.25,
    color,
    singleLine: true,
  };
}

/**
 * Turns a template into objects on the mat. Text needs the browser to measure
 * it, so the caller supplies `createText` (the same one the Text button uses).
 */
export function buildTemplateItems(input: {
  template: CardTemplate;
  language: "nl" | "en";
  cutColor: string;
  penColor: string;
  timestamp: number;
  createText: (content: WorkspaceTextContent, index: number, id: string) => WorkspaceSvgItem;
}): WorkspaceSvgItem[] {
  const { template, language, cutColor, penColor, timestamp } = input;
  const colorOf = (tool: TemplateTool) => (tool === "pen" ? penColor : cutColor);
  return template.parts.map((part, index): WorkspaceSvgItem => {
    const id = `template-${timestamp}-${index}`;
    if (part.kind === "text") {
      const item = input.createText(templateTextContent(part, language, colorOf(part.tool)), index, id);
      return {
        ...item,
        transform: {
          ...item.transform,
          x: mmToWorkspacePx(part.centerXMm) - item.frame.width / 2,
          y: mmToWorkspacePx(part.centerYMm) - item.frame.height / 2,
        },
      };
    }
    const shape: WorkspaceShapeKind = part.kind === "line" ? "line" : part.shape;
    const definition = getWorkspaceShapeDefinition(shape);
    let frame: { width: number; height: number };
    let transform: WorkspaceObject["transform"];
    let cornerRadius = 0;
    if (part.kind === "line") {
      const start = { x: mmToWorkspacePx(part.x1Mm), y: mmToWorkspacePx(part.y1Mm) };
      const end = { x: mmToWorkspacePx(part.x2Mm), y: mmToWorkspacePx(part.y2Mm) };
      const rotation = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
      frame = { width: Math.hypot(end.x - start.x, end.y - start.y), height: LINE_SHAPE_HEIGHT };
      // The line runs through the middle of its box, and the box turns around its top-left corner.
      const lift = rotatePoint({ x: 0, y: LINE_SHAPE_HEIGHT / 2 }, rotation);
      transform = { x: start.x - lift.x, y: start.y - lift.y, scaleX: 1, scaleY: 1, rotation };
    } else {
      frame = { width: mmToWorkspacePx(part.widthMm), height: mmToWorkspacePx(part.heightMm) };
      transform = { x: mmToWorkspacePx(part.xMm), y: mmToWorkspacePx(part.yMm), scaleX: 1, scaleY: 1, rotation: 0 };
      cornerRadius = mmToWorkspacePx(part.cornerRadiusMm ?? 0);
    }
    const path: WorkspacePathData = {
      id: "path-1",
      d: buildShapePath(shape, frame.width, frame.height, cornerRadius),
      fill: "none",
      stroke: colorOf(part.tool),
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    };
    const isFold = part.kind === "line" && part.fold === true;
    return {
      id,
      type: "path",
      kind: "shape",
      sourceKind: "shape",
      shapeKind: shape,
      fileName: isFold ? (language === "nl" ? "Vouwlijn" : "Fold line") : language === "nl" ? definition.labelNl : definition.labelEn,
      fileSize: language === "nl" ? "KindCut-vorm" : "KindCut shape",
      sizeCopy: `${Math.round(frame.width)} × ${Math.round(frame.height)} px`,
      frame,
      transform,
      paths: [path],
      cornerRadius,
      dashed: isFold ? { ...DEFAULT_DASH } : undefined,
      hollow: part.kind === "shape" && part.keep ? true : undefined,
    };
  });
}

/** A small drawing of the template for the start screen (millimetre units). */
export function buildTemplatePreviewSvg(template: CardTemplate, language: "nl" | "en"): string {
  const { width, height } = template.paperMm;
  const cut = "#2f2a26";
  const pen = "#4f7a3a";
  const n = (value: number) => Number(value.toFixed(2));
  const parts = template.parts.map((part) => {
    const stroke = part.tool === "pen" ? pen : cut;
    if (part.kind === "text") {
      return `<text x="${n(part.centerXMm)}" y="${n(part.centerYMm + part.sizeMm * 0.3)}" text-anchor="middle" font-family="sans-serif" font-size="${n(part.sizeMm)}" fill="${stroke}">${part.text[language]}</text>`;
    }
    if (part.kind === "line") {
      const dash = part.fold ? ` stroke-dasharray="${DEFAULT_DASH.dashMm} ${DEFAULT_DASH.gapMm}"` : "";
      return `<path d="M ${n(part.x1Mm)} ${n(part.y1Mm)} L ${n(part.x2Mm)} ${n(part.y2Mm)}" fill="none" stroke="${stroke}" stroke-width="1.1"${dash}/>`;
    }
    const d = buildShapePath(part.shape, part.widthMm, part.heightMm, part.cornerRadiusMm ?? 0);
    return `<path d="${d}" transform="translate(${n(part.xMm)} ${n(part.yMm)})" fill="none" stroke="${stroke}" stroke-width="1.1" stroke-linejoin="round"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n(width + 4)} ${n(height + 4)}"><rect width="${n(width)}" height="${n(height)}" rx="1.5" fill="#ffffff" stroke="rgba(41,37,33,0.25)" stroke-width="0.8"/>${parts.join("")}</svg>`;
}
