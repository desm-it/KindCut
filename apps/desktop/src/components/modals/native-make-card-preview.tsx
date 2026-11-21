import {
  CARD_SIZES,
  WORKSPACE_PIXELS_PER_INCH,
  buildInsertSlotsPaths,
  getInsertSlots,
  insertSlotPathD,
  type CardSize,
} from '../../workspace-utils';
/** Same geometry as the editor/legacy visual export, never an executable source. */
export function nativeMakeCardVisual(
  mat: { width: number; height: number },
  size: CardSize | null,
  slots: boolean,
  color: string,
  insert: boolean,
) {
  const paper = insert && size ? CARD_SIZES[size] : mat,
    width = paper.width * WORKSPACE_PIXELS_PER_INCH,
    height = paper.height * WORKSPACE_PIXELS_PER_INCH;
  return {
    slotsSvg: insert && slots ? buildInsertSlotsPaths(width, height, color) : '',
    paper: { x: 0, y: 0, width, height },
  };
}
export function NativeMakeCardBacking({ inset }: { inset: string }) {
  const [top, side] = inset.split(' ');
  return (
    <div className="workpiece-mat workpiece-mat--card native-make__card-backing" aria-hidden="true">
      <div
        className="workpiece-mat__band workpiece-mat__band--top"
        style={{ height: top, left: side, right: side }}
      >
        <span className="workpiece-mat__arrow">▲</span>
        <span className="workpiece-mat__label workpiece-mat__label--right">CardMat</span>
      </div>
      <div
        className="workpiece-mat__band workpiece-mat__band--bottom"
        style={{ height: top, left: side, right: side }}
      />
    </div>
  );
}
export function NativeMakeCardDetails({
  widthPt,
  heightPt,
  size,
  color,
  slots,
  dimSlots = false,
}: {
  widthPt: number;
  heightPt: number;
  size: CardSize | null;
  color: string;
  slots: boolean;
  dimSlots?: boolean;
}) {
  const w = (widthPt / 72) * WORKSPACE_PIXELS_PER_INCH,
    h = (heightPt / 72) * WORKSPACE_PIXELS_PER_INCH,
    area = size ? CARD_SIZES[size].width * CARD_SIZES[size].height : 0,
    card = size ? CARD_SIZES[size] : { width: widthPt / 72, height: heightPt / 72 };
  return (
    <svg className="native-make__card-guides" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {(['medium', 'small'] as const)
        .filter((s) => !size || CARD_SIZES[s].width * CARD_SIZES[s].height >= area)
        .map((s) => {
          const x = CARD_SIZES[s].width * WORKSPACE_PIXELS_PER_INCH,
            y = CARD_SIZES[s].height * WORKSPACE_PIXELS_PER_INCH;
          return (
            <path
              key={s}
              className="native-make__card-guide"
              d={`M ${x} 0 V ${y} H 0`}
              fill="none"
            />
          );
        })}
      {slots && (
        <g opacity={dimSlots ? 0.18 : 1}>
          {getInsertSlots(
            card.width * WORKSPACE_PIXELS_PER_INCH,
            card.height * WORKSPACE_PIXELS_PER_INCH,
          ).map((s, i) => (
            <path
              className="native-make__corner-slot"
              key={i}
              d={insertSlotPathD()}
              transform={`translate(${s.cx} ${s.cy}) rotate(${s.angle})`}
              fill={color}
              stroke={color}
              strokeWidth={0.5}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
