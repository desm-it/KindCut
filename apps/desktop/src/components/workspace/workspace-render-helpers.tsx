import type { ReactNode } from 'react';
import { type WorkspaceTool, getBehindColor, getPens } from '../../project-file';
import { type Language } from '../../i18n';
import { type PenFillPattern, penFillPatternTile } from '@cricut-companion/craft-core';
import {
  WORKSPACE_PIXELS_PER_INCH,
  type Point,
  type CardSize,
  CARD_SIZES,
  buildInsertSlotsPaths,
  getMatBorder,
} from '../../workspace-utils';
import { PenFillPatternDef } from './WorkspaceObjectArtwork';
export const ARROW_DIRECTIONS: Record<string, Point | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
export const SNAP_ALL_DIRECTIONS = {
  top: true,
  left: true,
  bottom: true,
  right: true,
  center: true,
  middle: true,
};
export const PEN_FILL_LABELS: Record<PenFillPattern, { nl: string; en: string }> = {
  lines: { nl: 'Lijnen', en: 'Lines' },
  cross: { nl: 'Kruis', en: 'Cross' },
  grid: { nl: 'Raster', en: 'Grid' },
  triangles: { nl: 'Driehoek', en: 'Triangles' },
  cubic: { nl: 'Kubus', en: 'Cubic' },
  honeycomb: { nl: 'Honingraat', en: 'Honeycomb' },
  dots: { nl: 'Stippen', en: 'Dots' },
};
export function PenFillSwatch({ pattern }: { pattern: PenFillPattern }) {
  const tile = penFillPatternTile(
    { enabled: true, pattern, density: 30, angle: 45, dotStyle: 'circle' },
    1.25,
  );
  if (!tile) return null;
  const id = `pen-fill-swatch-${pattern}`;
  return (
    <svg className="pen-fill-pattern__swatch" viewBox="0 0 40 26" aria-hidden="true">
      <defs>
        <PenFillPatternDef id={id} tile={tile} color="currentColor" patternTransform="" />
      </defs>
      <rect
        x="1"
        y="1"
        width="38"
        height="24"
        rx="4"
        fill={`url(#${id})`}
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}
export function PaperIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </svg>
  );
}
export function BehindIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="9" height="9" rx="1.5" />
      <path d="M6 11v2.5A1.5 1.5 0 0 0 7.5 15H13a1.5 1.5 0 0 0 1.5-1.5V8A1.5 1.5 0 0 0 13 6.5h-2" />
    </svg>
  );
}
export function PenIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 2l3 3-8.5 8.5L2 14l.5-3.5z" />
      <path d="M9.5 3.5l3 3" />
    </svg>
  );
}
export function ScissorsIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="3.5" cy="4.5" r="1.8" />
      <circle cx="3.5" cy="11.5" r="1.8" />
      <path d="M5.2 5.6 14 11M5.2 10.4 14 5" />
    </svg>
  );
}
export function HexShape({ color, add, warn }: { color?: string; add?: boolean; warn?: boolean }) {
  const cx = 19;
  const cy = 22;
  const s = Math.sqrt(3) / 2;
  const hex = (r: number) => {
    const pts: Array<[number, number]> = [
      [cx, cy - r],
      [cx + r * s, cy - r / 2],
      [cx + r * s, cy + r / 2],
      [cx, cy + r],
      [cx - r * s, cy + r / 2],
      [cx - r * s, cy - r / 2],
    ];
    return pts.map(([x, y]) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`).join(' ');
  };
  const borderColor = warn ? '#d9a300' : add ? 'rgba(41,37,33,0.45)' : 'rgba(41,37,33,0.4)';
  return (
    <svg className="pen-hex__svg" viewBox="0 0 38 44" width="38" height="44" aria-hidden="true">
      {/* Outer border (2px), rounded joins; the transparent ring to the fill is the 1px gap */}
      <polygon
        points={hex(20)}
        fill={add ? 'rgba(41,37,33,0.07)' : 'none'}
        stroke={borderColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {!add && color && (
        <polygon
          points={hex(17)}
          fill={color}
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
      {add && (
        <path
          d="M19 14.5v15M11.5 22h15"
          stroke="rgba(41,37,33,0.7)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
export function ColorRow({
  icon,
  label,
  color,
  onChange,
  title,
}: {
  icon: ReactNode;
  label?: string;
  color: string;
  onChange: (color: string) => void;
  title?: string;
}) {
  return (
    <label className="color-row" title={title}>
      <span className="color-row__icon" aria-hidden="true">
        {icon}
      </span>
      {label ? <span className="color-row__label">{label}</span> : null}
      <span className="color-row__chip" style={{ backgroundColor: color }}>
        <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}
export function SwatchPicker({
  tools,
  selectedColor,
  onPick,
  language,
}: {
  tools: WorkspaceTool[];
  selectedColor: string;
  onPick: (color: string) => void;
  language: Language;
}) {
  const nl = language === 'nl';
  const pens = getPens(tools);
  const behind = getBehindColor(tools);
  const sel = (selectedColor ?? '').toLowerCase();
  const activePen = pens.find((pen) => pen.color.toLowerCase() === sel) ?? null;
  const cutActive = !activePen && behind.toLowerCase() === sel;
  return (
    <div className="tool-picker" role="group">
      <div className="tool-choice">
        <button
          type="button"
          className={`tool-choice__btn${cutActive ? ' tool-choice__btn--active' : ''}`}
          onClick={() => onPick(behind)}
          aria-pressed={cutActive}
        >
          <ScissorsIcon />
          <strong>{nl ? 'Snijden' : 'Cut'}</strong>
          <span>{nl ? 'Het mesje snijdt de vorm uit' : 'The blade cuts the shape out'}</span>
        </button>
        <button
          type="button"
          className={`tool-choice__btn${activePen ? ' tool-choice__btn--active' : ''}`}
          onClick={() => {
            if (!activePen && pens[0]) onPick(pens[0].color);
          }}
          aria-pressed={Boolean(activePen)}
          disabled={pens.length === 0}
        >
          <PenIcon />
          <strong>{nl ? 'Tekenen' : 'Draw'}</strong>
          <span>{nl ? 'Een pen tekent de lijnen' : 'A pen draws the lines'}</span>
        </button>
      </div>

      {activePen ? (
        <div className="tool-picker__pens-row">
          <span className="object-settings__label">{nl ? 'Penkleur' : 'Pen colour'}</span>
          <div className="tool-picker__pens">
            {pens.map((pen, i) => {
              const active = pen === activePen;
              return (
                <button
                  key={pen.id}
                  type="button"
                  className={`pen-dot${active ? ' pen-dot--active' : ''}`}
                  onClick={() => onPick(pen.color)}
                  aria-pressed={active}
                  aria-label={`${nl ? 'Pen' : 'Pen'} ${i + 1}`}
                  title={`${nl ? 'Pen' : 'Pen'} ${i + 1}`}
                  style={{ backgroundColor: pen.color }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
export function WorkspaceMat({
  kind,
  width,
  height,
}: {
  kind: 'standard' | 'card';
  width: number;
  height: number;
}) {
  const { side: SIDE, top: TOP, bottom: BOTTOM } = getMatBorder(kind);
  const style = {
    top: -TOP,
    left: -SIDE,
    width: width + SIDE * 2,
    height: height + TOP + BOTTOM,
  };
  if (kind === 'card') {
    return (
      <div className="workpiece-mat workpiece-mat--card" style={style} aria-hidden="true">
        {/* Raised bands align with the paper column, not the full mat width */}
        <div
          className="workpiece-mat__band workpiece-mat__band--top"
          style={{ height: TOP, left: SIDE, width }}
        >
          <span className="workpiece-mat__arrow">▲</span>
          <span className="workpiece-mat__label workpiece-mat__label--right">CardMat</span>
        </div>
        <div
          className="workpiece-mat__band workpiece-mat__band--bottom"
          style={{ height: BOTTOM, left: SIDE, width }}
        />
      </div>
    );
  }
  return (
    <div className="workpiece-mat workpiece-mat--standard" style={style} aria-hidden="true">
      {/* Labels align to the paper edges on the x-axis (inset by SIDE). */}
      <span
        className="workpiece-mat__label workpiece-mat__label--right"
        style={{ top: (TOP - 20) / 2, right: SIDE }}
      >
        Standard
      </span>
      <span
        className="workpiece-mat__label workpiece-mat__label--bottom-left"
        style={{ bottom: (BOTTOM - 20) / 2, left: SIDE }}
      >
        Standard
      </span>
    </div>
  );
}
export function WorkspaceCardGuides({
  width,
  height,
  activeCardSize,
}: {
  width: number;
  height: number;
  activeCardSize: CardSize | null;
}) {
  // Dotted guides for the small + medium card blanks (large == the paper edge). When a
  // size is selected, hide the guides smaller than it.
  const guideSizes: CardSize[] = ['medium', 'small'];
  const areaOf = (s: CardSize) => CARD_SIZES[s].width * CARD_SIZES[s].height;
  const activeArea = activeCardSize ? areaOf(activeCardSize) : 0;
  return (
    <div
      className="workpiece-card-guides"
      style={{ width, height, overflow: 'visible' }}
      aria-hidden="true"
    >
      {guideSizes
        .filter((s) => !activeCardSize || areaOf(s) >= activeArea)
        .map((s) => (
          <div
            key={s}
            className="workpiece-mat__card-guide"
            style={{
              width: CARD_SIZES[s].width * WORKSPACE_PIXELS_PER_INCH,
              height: CARD_SIZES[s].height * WORKSPACE_PIXELS_PER_INCH,
              left: 0,
              top: 0,
            }}
          />
        ))}
    </div>
  );
}
export function InsertSlotsOverlay({
  width,
  height,
  color,
}: {
  width: number;
  height: number;
  color: string;
}) {
  return (
    <svg
      className="workpiece-insert-slots"
      width={width}
      height={height}
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      overflow="visible"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: buildInsertSlotsPaths(width, height, color) }}
    />
  );
}
