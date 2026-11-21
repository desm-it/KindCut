export const MEASUREMENT_UNIT_STORAGE_KEY = 'kindcutMeasurementUnit';
export const WORKSPACE_PIXELS_PER_INCH = 80;
export const WORKSPACE_MIN_ZOOM = 0.45;
export const WORKSPACE_MAX_ZOOM = 3;
export const WORKSPACE_STAGE_LEFT_OFFSET = 42; // width of the Y ruler
export const WORKSPACE_STAGE_TOP_OFFSET = 32; // height of the X ruler (statusbar handled by grid layout)
export const WORKSPACE_HISTORY_LIMIT = 50;
export const ROTATION_SNAP_INTERVAL_DEGREES = 45;
export const ROTATION_SNAP_THRESHOLD_DEGREES = 4;
export const MOVEABLE_CENTER_DIRECTION = [0, 0] as const;
// How close (in SCREEN pixels) a single-axis resize must come to the item's natural
// proportions before it snaps to them. Small so it only catches near-misses.
export const ASPECT_RATIO_SNAP_SCREEN_PX = 8;

export type MeasurementUnit = 'in' | 'cm' | 'mm';
export type RulerAxis = 'x' | 'y';

export type Point = {
  x: number;
  y: number;
};

export type MatDimensions = {
  width: number;
  height: number;
};

export type WorkspaceItemTransform = {
  x: number;
  y: number;
  scaleX: number; // always positive — magnitude only
  scaleY: number; // always positive — magnitude only
  rotation: number;
  mirrorX?: boolean; // horizontal flip (applied last, independent of scale)
  mirrorY?: boolean; // vertical flip
};

export type WorkspaceItemFrame = {
  width: number;
  height: number;
};

export type WorkspaceTransformableItem = {
  transform: WorkspaceItemTransform;
  frame: WorkspaceItemFrame;
};

export type WorkspaceBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  center: Point;
};

export type MeasurementTick = {
  value: number;
  label: string;
  position: number;
  major: boolean;
};

const MAT_DIMENSIONS_INCHES: Record<string, MatDimensions> = {
  'joy-standard': { width: 4.5, height: 12 },
  'joy-standard-short': { width: 4.5, height: 6.5 },
  'joy-card': { width: 4.5, height: 6.25 },
};

export function getMatDimensionsInches(matPreset: string): MatDimensions {
  return MAT_DIMENSIONS_INCHES[matPreset] ?? { width: 4.5, height: 12 };
}

export type MatKind = 'standard' | 'card';

/** Physical mat family for visuals: the card mat is blue, the rest are the green Standard mat. */
export function getMatKind(matPreset: string): MatKind {
  return matPreset === 'joy-card' ? 'card' : 'standard';
}

// ── Card sizes (insert-card sub-options) ───────────────────────────────────────────
export type CardSize = 'small' | 'medium' | 'large';
export const CARD_SIZE_ORDER: CardSize[] = ['small', 'medium', 'large'];

// Card blank sizes (inches). "large" == the full card mat area.
export const CARD_SIZES: Record<CardSize, MatDimensions> = {
  small: { width: 3.5, height: 4.9 }, // 89 × 124 mm
  medium: { width: 4.25, height: 5.5 }, // 108 × 140 mm
  large: { width: 4.5, height: 6.25 }, // 114 × 159 mm (whole paper)
};

export function isCardSize(value: unknown): value is CardSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

const MM_PER_INCH = 25.4;
export function mmToWorkspacePx(mm: number): number {
  return (mm / MM_PER_INCH) * WORKSPACE_PIXELS_PER_INCH;
}

// ── Insert-card corner slots ───────────────────────────────────────────────────────
// 4 diagonal stadium slits, one per corner of the active card area, that hold the
// colored insert behind the folded card. Cut in the behind colour.
const SLOT_LENGTH_MM = 16;
const SLOT_THICKNESS_MM = 1.25;
const SLOT_EDGE_INSET_MM = 3; // gap from each paper edge

export type InsertSlot = { cx: number; cy: number; angle: number }; // px, degrees

// Slot centres + angles for an active area of (width × height) px.
export function getInsertSlots(width: number, height: number): InsertSlot[] {
  // Distance of the slot centre from the corner, along the 45° bisector, so the slit's
  // far ends sit SLOT_EDGE_INSET_MM from both edges.
  const inset = mmToWorkspacePx(SLOT_EDGE_INSET_MM + (SLOT_LENGTH_MM / 2) * Math.SQRT1_2);
  const corners: Array<{ x: number; y: number; sx: number; sy: number }> = [
    { x: 0, y: 0, sx: 1, sy: 1 },
    { x: width, y: 0, sx: -1, sy: 1 },
    { x: 0, y: height, sx: 1, sy: -1 },
    { x: width, y: height, sx: -1, sy: -1 },
  ];
  return corners.map(({ x, y, sx, sy }) => ({
    cx: x + sx * inset,
    cy: y + sy * inset,
    // Slit runs perpendicular to the corner bisector (so the card corner tucks under it).
    angle: (Math.atan2(sy, sx) * 180) / Math.PI + 90,
  }));
}

// Inner SVG (<path> elements) for the 4 corner slots of an active area, drawn in `color`
// (the behind/cut colour). Used both for the editor overlay and the cut export.
export function buildInsertSlotsPaths(width: number, height: number, color: string): string {
  const d = insertSlotPathD();
  return getInsertSlots(width, height)
    .map(
      (s) =>
        `<path d="${d}" transform="translate(${roundCss(s.cx)} ${roundCss(s.cy)}) rotate(${roundCss(s.angle)})" fill="${color}" stroke="${color}" stroke-width="0.5"/>`,
    )
    .join('');
}

// Stadium (fully-rounded slim rectangle) centred at the origin, long axis horizontal.
export function insertSlotPathD(): string {
  const L = mmToWorkspacePx(SLOT_LENGTH_MM);
  const T = mmToWorkspacePx(SLOT_THICKNESS_MM);
  const r = T / 2;
  const hx = L / 2;
  const f = (n: number) => Number(n.toFixed(3));
  return `M ${f(-hx + r)} ${f(-r)} H ${f(hx - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(hx - r)} ${f(r)} H ${f(-hx + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(-hx + r)} ${f(-r)} Z`;
}

export function inchesToDisplayValue(valueInInches: number, unit: MeasurementUnit): number {
  switch (unit) {
    case 'cm':
      return roundMeasurement(valueInInches * 2.54);
    case 'mm':
      return roundMeasurement(valueInInches * 25.4);
    case 'in':
    default:
      return roundMeasurement(valueInInches);
  }
}

export function getViewportTransform({ zoom, pan }: { zoom: number; pan: Point }): string {
  return `translate(${roundCss(pan.x)}px, ${roundCss(pan.y)}px) scale(${roundCss(zoom)})`;
}

export function getWorkspaceItemTransform({
  x,
  y,
  rotation,
  scaleX,
  scaleY,
  mirrorX,
  mirrorY,
}: WorkspaceItemTransform): string {
  // mirrorX/mirrorY are independent of scale — appended last so Moveable's scale math is unaffected.
  const mirror = mirrorX || mirrorY ? ` scale(${mirrorX ? -1 : 1}, ${mirrorY ? -1 : 1})` : '';
  return `translate3d(${roundCss(x)}px, ${roundCss(y)}px, 0) rotate(${roundCss(rotation)}deg)${mirror}`;
}

export function getWorkspaceItemVisualSize(
  frame: WorkspaceItemFrame,
  transform: WorkspaceItemTransform,
): { width: number; height: number } {
  return {
    width: frame.width * transform.scaleX, // scaleX is always positive
    height: frame.height * transform.scaleY,
  };
}

/**
 * Sanitises a transform for LIVE use during a drag/scale/rotate gesture:
 * clamps scale, coerces mirror flags, normalises rotation range, and removes
 * floating-point noise at a sub-pixel precision (1e-6) — but does NOT quantise
 * to 0.01 like commit-time rounding does. Keeping live values near-exact lets the
 * rendered element track Moveable's control box without shimmer/jitter.
 */
export function clampWorkspaceItemTransform(
  transform: WorkspaceItemTransform,
): WorkspaceItemTransform {
  return {
    x: roundFine(Number.isFinite(transform.x) ? transform.x : 0),
    y: roundFine(Number.isFinite(transform.y) ? transform.y : 0),
    scaleX: clamp(roundFine(Math.abs(transform.scaleX)), 0.01, 100),
    scaleY: clamp(roundFine(Math.abs(transform.scaleY)), 0.01, 100),
    mirrorX: Boolean(transform.mirrorX),
    mirrorY: Boolean(transform.mirrorY),
    rotation: normalizeRotation(
      Number.isFinite(transform.rotation) ? roundFine(transform.rotation) : 0,
    ),
  };
}

/**
 * Sanitises a transform for COMMIT/persistence: clamp + quantise to 0.01 so the
 * saved project file stays tidy. Use clampWorkspaceItemTransform for live frames.
 */
export function normalizeWorkspaceItemTransform(
  transform: WorkspaceItemTransform,
): WorkspaceItemTransform {
  return {
    x: roundCss(Number.isFinite(transform.x) ? transform.x : 0),
    y: roundCss(Number.isFinite(transform.y) ? transform.y : 0),
    scaleX: clamp(roundCss(Math.abs(transform.scaleX)), 0.01, 100),
    scaleY: clamp(roundCss(Math.abs(transform.scaleY)), 0.01, 100),
    mirrorX: Boolean(transform.mirrorX),
    mirrorY: Boolean(transform.mirrorY),
    rotation: normalizeRotation(
      Number.isFinite(transform.rotation) ? roundCss(transform.rotation) : 0,
    ),
  };
}

/**
 * Maps a point in the item's local box space (origin = top-left, range
 * [0,W]×[0,H]) to a world-space offset from the item's (x,y) origin, applying
 * BOTH the mirror reflection and the rotation exactly as CSS renders them:
 *   worldOffset = R(rotation) · M · localOffset      (M = mirror diagonal)
 * This is the single source of truth for "where does a corner/anchor land".
 */
export function localOffsetToWorld(
  offset: Point,
  transform: Pick<WorkspaceItemTransform, 'rotation' | 'mirrorX' | 'mirrorY'>,
): Point {
  const mirroredX = transform.mirrorX ? -offset.x : offset.x;
  const mirroredY = transform.mirrorY ? -offset.y : offset.y;
  return rotatePoint({ x: mirroredX, y: mirroredY }, transform.rotation);
}

/**
 * Inverse of localOffsetToWorld: given a world-space offset from the item origin,
 * recover the local box coordinates. Mirror is its own inverse, so:
 *   localOffset = M · R(-rotation) · worldOffset
 */
export function worldOffsetToLocal(
  offset: Point,
  transform: Pick<WorkspaceItemTransform, 'rotation' | 'mirrorX' | 'mirrorY'>,
): Point {
  const unrotated = rotatePoint(offset, -transform.rotation);
  return {
    x: transform.mirrorX ? -unrotated.x : unrotated.x,
    y: transform.mirrorY ? -unrotated.y : unrotated.y,
  };
}

export function getWorkspaceSelectionBounds(
  items: WorkspaceTransformableItem[],
): WorkspaceBounds | null {
  if (items.length === 0) {
    return null;
  }

  const points = items.flatMap((item) => getWorkspaceItemCorners(item));
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  const width = right - left;
  const height = bottom - top;

  return {
    left: roundCss(left),
    top: roundCss(top),
    right: roundCss(right),
    bottom: roundCss(bottom),
    width: roundCss(width),
    height: roundCss(height),
    center: { x: roundCss(left + width / 2), y: roundCss(top + height / 2) },
  };
}

export function scaleWorkspaceItemTransformFromAnchor(
  transform: WorkspaceItemTransform,
  frame: WorkspaceItemFrame,
  anchor: Point,
  scaleX: number,
  scaleY: number,
): WorkspaceItemTransform {
  // Clamp to positive minimum — prevents mirroring through drag and keeps position math stable.
  const nextScaleX = Math.max(0.01, transform.scaleX * scaleX);
  const nextScaleY = Math.max(0.01, transform.scaleY * scaleY);

  // Convert the screen-space anchor back to the object's local box space so we can
  // re-apply it correctly after the new scale. Uses worldOffsetToLocal so it stays
  // correct for rotated AND mirrored objects (mirror flips which local edge the
  // anchor maps to — without this, scaling a mirrored object jumps to the wrong side).
  const localAnchorStart = worldOffsetToLocal(
    { x: anchor.x - transform.x, y: anchor.y - transform.y },
    transform,
  );
  const startWidth = frame.width * transform.scaleX;
  const startHeight = frame.height * transform.scaleY;
  const anchorNormX = startWidth > 0 ? localAnchorStart.x / startWidth : 0.5;
  const anchorNormY = startHeight > 0 ? localAnchorStart.y / startHeight : 0.5;

  const localAnchorNew = {
    x: anchorNormX * frame.width * nextScaleX,
    y: anchorNormY * frame.height * nextScaleY,
  };
  const worldAnchorNew = localOffsetToWorld(localAnchorNew, transform);

  return clampWorkspaceItemTransform({
    ...transform,
    x: anchor.x - worldAnchorNew.x,
    y: anchor.y - worldAnchorNew.y,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
  });
}

/**
 * Aspect-ratio snap for a single-axis (side handle) resize. The item is at its
 * natural/original proportions when scaleX === scaleY (visual aspect === frame
 * aspect). While dragging one axis, if the resulting dimension comes within
 * `thresholdScreenPx` (screen px, zoom-corrected) of that natural value, snap the
 * dragged axis's scale factor so the proportions lock exactly.
 *
 * Returns the (possibly adjusted) scale factors plus whether a snap occurred.
 */
export function snapScaleFactorToAspect(params: {
  axis: 'x' | 'y';
  startScaleX: number;
  startScaleY: number;
  scaleFactorX: number;
  scaleFactorY: number;
  frame: WorkspaceItemFrame;
  zoom: number;
  thresholdScreenPx?: number;
}): { scaleFactorX: number; scaleFactorY: number; snapped: boolean } {
  const {
    axis,
    startScaleX,
    startScaleY,
    scaleFactorX,
    scaleFactorY,
    frame,
    zoom,
    thresholdScreenPx = ASPECT_RATIO_SNAP_SCREEN_PX,
  } = params;
  const prelimScaleX = Math.max(0.01, startScaleX * scaleFactorX);
  const prelimScaleY = Math.max(0.01, startScaleY * scaleFactorY);
  const snapWorkspacePx = thresholdScreenPx / Math.max(0.01, zoom);

  if (axis === 'x') {
    // Natural proportions: scaleX should equal the (fixed) scaleY.
    const targetScaleX = prelimScaleY;
    const widthDelta = frame.width * (prelimScaleX - targetScaleX);
    if (Math.abs(widthDelta) <= snapWorkspacePx) {
      return {
        scaleFactorX: targetScaleX / Math.max(0.001, startScaleX),
        scaleFactorY,
        snapped: true,
      };
    }
  } else {
    const targetScaleY = prelimScaleX;
    const heightDelta = frame.height * (prelimScaleY - targetScaleY);
    if (Math.abs(heightDelta) <= snapWorkspacePx) {
      return {
        scaleFactorX,
        scaleFactorY: targetScaleY / Math.max(0.001, startScaleY),
        snapped: true,
      };
    }
  }
  return { scaleFactorX, scaleFactorY, snapped: false };
}

export function rotateWorkspaceItemTransformAroundPoint(
  transform: WorkspaceItemTransform,
  frame: WorkspaceItemFrame,
  center: Point,
  degrees: number,
): WorkspaceItemTransform {
  const itemCenter = getWorkspaceItemCenter({ transform, frame });
  const nextCenter = addPoint(
    center,
    rotatePoint({ x: itemCenter.x - center.x, y: itemCenter.y - center.y }, degrees),
  );
  const nextRotation = transform.rotation + degrees;
  // Offset from the item origin to its centre under the NEW rotation, mirror-aware.
  const nextCenterOffset = localOffsetToWorld(
    { x: (frame.width * transform.scaleX) / 2, y: (frame.height * transform.scaleY) / 2 },
    { ...transform, rotation: nextRotation },
  );

  return clampWorkspaceItemTransform({
    ...transform,
    x: nextCenter.x - nextCenterOffset.x,
    y: nextCenter.y - nextCenterOffset.y,
    rotation: nextRotation,
  });
}

export function addPoint(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function rotatePoint(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function getMeasurementTicks({
  lengthInches,
  axis,
  unit,
  zoom,
  pan,
  pixelsPerInch,
}: {
  lengthInches: number;
  axis: RulerAxis;
  unit: MeasurementUnit;
  zoom: number;
  pan: Point;
  pixelsPerInch: number;
}): MeasurementTick[] {
  const maxDisplayValue = inchesToDisplayValue(lengthInches, unit);
  const subdivisionDisplayValue = unit === 'in' ? 0.25 : unit === 'cm' ? 0.5 : 5;
  const ticks: MeasurementTick[] = [];
  const count = Math.ceil(maxDisplayValue / subdivisionDisplayValue);

  for (let index = 0; index <= count; index += 1) {
    const displayValue = Math.min(
      maxDisplayValue,
      roundMeasurement(index * subdivisionDisplayValue),
    );
    const valueInches = displayValueToInches(displayValue, unit);
    const isEnd = Math.abs(displayValue - maxDisplayValue) < 0.001;
    const label = shouldLabelWholeNumber(displayValue, unit)
      ? formatTickLabel(displayValue, unit)
      : '';

    ticks.push({
      value: displayValue,
      label,
      position: roundCss((axis === 'x' ? pan.x : pan.y) + valueInches * pixelsPerInch * zoom),
      major: label !== '' || isEnd,
    });

    if (isEnd) {
      break;
    }
  }

  return ticks;
}

function displayValueToInches(value: number, unit: MeasurementUnit): number {
  switch (unit) {
    case 'cm':
      return value / 2.54;
    case 'mm':
      return value / 25.4;
    case 'in':
    default:
      return value;
  }
}

function getWorkspaceItemCenter({ transform, frame }: WorkspaceTransformableItem): Point {
  return addPoint(
    { x: transform.x, y: transform.y },
    localOffsetToWorld(
      { x: (frame.width * transform.scaleX) / 2, y: (frame.height * transform.scaleY) / 2 },
      transform,
    ),
  );
}

function getWorkspaceItemCorners({ transform, frame }: WorkspaceTransformableItem): Point[] {
  const width = frame.width * transform.scaleX;
  const height = frame.height * transform.scaleY;
  const topLeft = { x: transform.x, y: transform.y };

  return [
    topLeft,
    addPoint(topLeft, localOffsetToWorld({ x: width, y: 0 }, transform)),
    addPoint(topLeft, localOffsetToWorld({ x: width, y: height }, transform)),
    addPoint(topLeft, localOffsetToWorld({ x: 0, y: height }, transform)),
  ];
}

function shouldLabelWholeNumber(value: number, unit: MeasurementUnit): boolean {
  if (!Number.isInteger(value)) {
    return false;
  }
  return unit !== 'mm' || value % 10 === 0;
}

function formatTickLabel(value: number, unit: MeasurementUnit): string {
  if (unit === 'mm') {
    return String(Math.round(value));
  }
  return String(value);
}

function roundMeasurement(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundCss(value: number): number {
  return Math.round(value * 100) / 100;
}

// Sub-pixel precision for live gestures: erases float noise (~1e-16) while staying
// 10000× finer than commit rounding, so live tracking never visibly quantises.
function roundFine(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function normalizeRotation(value: number): number {
  const rotation = value % 360;
  return rotation > 180 ? rotation - 360 : rotation < -180 ? rotation + 360 : rotation;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatN(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function loadMeasurementUnitPreference(): MeasurementUnit {
  try {
    const saved = window.localStorage.getItem(MEASUREMENT_UNIT_STORAGE_KEY);
    return saved === 'in' || saved === 'cm' || saved === 'mm' ? saved : 'cm';
  } catch {
    return 'cm';
  }
}

export function saveMeasurementUnitPreference(unit: MeasurementUnit): void {
  try {
    window.localStorage.setItem(MEASUREMENT_UNIT_STORAGE_KEY, unit);
  } catch {
    // localStorage can be unavailable in constrained renderer contexts.
  }
}

// ── Fitting the mat in view and placing new objects ────────────────────────────

export type WorkspaceRect = { x: number; y: number; width: number; height: number };

/** The mat's coloured border around the paper, in workspace pixels. */
export function getMatBorder(kind: MatKind): { side: number; top: number; bottom: number } {
  return kind === 'card' ? { side: 33, top: 90, bottom: 78 } : { side: 33, top: 80, bottom: 80 };
}

/**
 * Zoom and pan that show the whole mat (paper plus its border) centred in the
 * visible canvas. `available` is the canvas size without the rulers.
 */
export function fitMatToView(input: {
  paper: MatDimensions; // workspace pixels
  border: { side: number; top: number; bottom: number };
  available: MatDimensions;
  padding?: number;
  maxZoom?: number;
}): { zoom: number; pan: Point } {
  const padding = input.padding ?? 20;
  const totalWidth = input.paper.width + input.border.side * 2;
  const totalHeight = input.paper.height + input.border.top + input.border.bottom;
  const fit = Math.min(
    (input.available.width - padding * 2) / totalWidth,
    (input.available.height - padding * 2) / totalHeight,
  );
  const zoom = clamp(Number.isFinite(fit) ? fit : 1, WORKSPACE_MIN_ZOOM, input.maxZoom ?? 1.25);
  return {
    zoom,
    pan: {
      x: (input.available.width - totalWidth * zoom) / 2 + input.border.side * zoom,
      y: (input.available.height - totalHeight * zoom) / 2 + input.border.top * zoom,
    },
  };
}

export function intersectRects(a: WorkspaceRect, b: WorkspaceRect): WorkspaceRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * Where to put a new object (its top-left corner): as close to the middle of
 * `area` as possible without covering objects that are already there. When
 * there is no free spot, it takes the spot that covers the least.
 */
export function findFreePlacement(input: {
  size: MatDimensions;
  area: WorkspaceRect;
  occupied: WorkspaceRect[];
  gap?: number;
  step?: number;
}): Point {
  const { size, area, occupied } = input;
  const gap = input.gap ?? 8;
  const step = input.step ?? 16;
  const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const centered = { x: center.x - size.width / 2, y: center.y - size.height / 2 };

  // Positions that keep the object fully inside the area (just the centre when it doesn't fit),
  // including flush against each edge so a tight fit isn't missed between grid steps.
  const range = (start: number, room: number, middle: number): number[] => {
    if (room <= 0) return [middle];
    const values = [middle, start, start + room];
    for (let offset = step; offset < room / 2; offset += step) {
      values.push(middle - offset, middle + offset);
    }
    return values;
  };
  const xs = range(area.x, area.width - size.width, centered.x);
  const ys = range(area.y, area.height - size.height, centered.y);
  const coveredArea = (box: WorkspaceRect) =>
    occupied.reduce((total, other) => {
      const overlap = intersectRects(box, other);
      return overlap ? total + overlap.width * overlap.height : total;
    }, 0);

  // Best spot: covers the least, then keeps the most breathing room, then is nearest the middle.
  let best = centered;
  let bestScore = [Infinity, Infinity, Infinity];
  for (const y of ys) {
    for (const x of xs) {
      const score = [
        coveredArea({ x, y, width: size.width, height: size.height }),
        coveredArea({
          x: x - gap,
          y: y - gap,
          width: size.width + gap * 2,
          height: size.height + gap * 2,
        }),
        Math.hypot(x - centered.x, y - centered.y),
      ];
      const better = score.findIndex(
        (value, index) => Math.abs(value - (bestScore[index] ?? 0)) > 0.5,
      );
      if (better >= 0 && (score[better] ?? 0) < (bestScore[better] ?? 0)) {
        best = { x, y };
        bestScore = score;
      }
    }
  }
  return { x: roundCss(best.x), y: roundCss(best.y) };
}

/**
 * A length for display in the user's unit, e.g. "1,5 cm". Workspace sizes are
 * stored in pixels (80 per inch) and mats in inches; people think in cm.
 */
export function formatLength(
  inches: number,
  unit: MeasurementUnit,
  language: 'nl' | 'en' = 'en',
): string {
  const value = unit === 'in' ? inches : unit === 'cm' ? inches * 2.54 : inches * 25.4;
  const decimals = unit === 'mm' ? (Math.abs(value) < 10 ? 1 : 0) : unit === 'cm' ? 1 : 2;
  const text = String(Number(value.toFixed(decimals)));
  return `${language === 'nl' ? text.replace('.', ',') : text} ${unit}`;
}

export function formatLengthPx(
  pixels: number,
  unit: MeasurementUnit,
  language: 'nl' | 'en' = 'en',
): string {
  return formatLength(pixels / WORKSPACE_PIXELS_PER_INCH, unit, language);
}

// ── Align, distribute, snap and nudge ───────────────────────────────────────

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

type IdentifiedItem = WorkspaceTransformableItem & { id: string };
type TransformUpdate = { id: string; transform: WorkspaceItemTransform };

function boundsOf(item: WorkspaceTransformableItem): WorkspaceBounds {
  return getWorkspaceSelectionBounds([item]) as WorkspaceBounds;
}

/**
 * Lines objects up. One object is aligned to the paper (so "centre" puts it in
 * the middle of the card); several objects are aligned to each other.
 * Rotated objects are aligned by the box around them.
 */
export function alignWorkspaceItems(
  items: IdentifiedItem[],
  mode: AlignMode,
  paper: WorkspaceRect,
): TransformUpdate[] {
  if (items.length === 0) return [];
  const group = getWorkspaceSelectionBounds(items) as WorkspaceBounds;
  const reference =
    items.length === 1
      ? {
          left: paper.x,
          top: paper.y,
          right: paper.x + paper.width,
          bottom: paper.y + paper.height,
        }
      : group;
  return items.map((item) => {
    const bounds = boundsOf(item);
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = reference.left - bounds.left;
    else if (mode === 'right') dx = reference.right - bounds.right;
    else if (mode === 'center') dx = (reference.left + reference.right) / 2 - bounds.center.x;
    else if (mode === 'top') dy = reference.top - bounds.top;
    else if (mode === 'bottom') dy = reference.bottom - bounds.bottom;
    else dy = (reference.top + reference.bottom) / 2 - bounds.center.y;
    return {
      id: item.id,
      transform: { ...item.transform, x: item.transform.x + dx, y: item.transform.y + dy },
    };
  });
}

/** Spreads three or more objects so the gaps between them are equal; the outer two stay put. */
export function distributeWorkspaceItems(
  items: IdentifiedItem[],
  axis: 'x' | 'y',
): TransformUpdate[] {
  if (items.length < 3) return [];
  const start = (bounds: WorkspaceBounds) => (axis === 'x' ? bounds.left : bounds.top);
  const size = (bounds: WorkspaceBounds) => (axis === 'x' ? bounds.width : bounds.height);
  const entries = items
    .map((item) => ({ item, bounds: boundsOf(item) }))
    .sort((a, b) =>
      axis === 'x' ? a.bounds.center.x - b.bounds.center.x : a.bounds.center.y - b.bounds.center.y,
    );
  const first = entries[0] as (typeof entries)[number];
  const last = entries[entries.length - 1] as (typeof entries)[number];
  const span = start(last.bounds) + size(last.bounds) - start(first.bounds);
  const gap =
    (span - entries.reduce((sum, entry) => sum + size(entry.bounds), 0)) / (entries.length - 1);
  let cursor = start(first.bounds);
  return entries.map(({ item, bounds }) => {
    const delta = cursor - start(bounds);
    cursor += size(bounds) + gap;
    return {
      id: item.id,
      transform:
        axis === 'x'
          ? { ...item.transform, x: item.transform.x + delta }
          : { ...item.transform, y: item.transform.y + delta },
    };
  });
}

export type SnapTargets = { x: number[]; y: number[] };
export type SnapGuide = { axis: 'x' | 'y'; position: number };

/** The lines a dragged object can snap to: the paper's edges and middle, and those of the other objects. */
export function getSnapTargets(
  paper: WorkspaceRect,
  others: WorkspaceTransformableItem[],
): SnapTargets {
  const x = [paper.x, paper.x + paper.width / 2, paper.x + paper.width];
  const y = [paper.y, paper.y + paper.height / 2, paper.y + paper.height];
  for (const other of others) {
    const bounds = boundsOf(other);
    x.push(bounds.left, bounds.center.x, bounds.right);
    y.push(bounds.top, bounds.center.y, bounds.bottom);
  }
  return { x, y };
}

function nearestSnap(
  edges: number[],
  targets: number[],
  threshold: number,
): { shift: number; position: number } | null {
  let best: { shift: number; position: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const shift = target - edge;
      if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, position: target };
      }
    }
  }
  return best;
}

/**
 * Adjusts a drag so the moved box lands exactly on a nearby snap line.
 * `bounds` is the box before the drag, `delta` how far it was dragged.
 */
export function snapDragDelta(input: {
  bounds: Pick<WorkspaceBounds, 'left' | 'right' | 'top' | 'bottom'>;
  delta: Point;
  targets: SnapTargets;
  threshold: number;
}): { delta: Point; guides: SnapGuide[] } {
  const { bounds, delta, targets, threshold } = input;
  const left = bounds.left + delta.x;
  const right = bounds.right + delta.x;
  const top = bounds.top + delta.y;
  const bottom = bounds.bottom + delta.y;
  const snapX = nearestSnap([left, (left + right) / 2, right], targets.x, threshold);
  const snapY = nearestSnap([top, (top + bottom) / 2, bottom], targets.y, threshold);
  const guides: SnapGuide[] = [];
  if (snapX) guides.push({ axis: 'x', position: snapX.position });
  if (snapY) guides.push({ axis: 'y', position: snapY.position });
  return { delta: { x: delta.x + (snapX?.shift ?? 0), y: delta.y + (snapY?.shift ?? 0) }, guides };
}

/** How far one press of an arrow key moves the selection, in workspace pixels. */
export function nudgeStepPx(unit: MeasurementUnit, size: 'fine' | 'normal' | 'large'): number {
  if (unit === 'in') {
    const inches = size === 'fine' ? 1 / 64 : size === 'large' ? 0.25 : 1 / 16;
    return inches * WORKSPACE_PIXELS_PER_INCH;
  }
  return mmToWorkspacePx(size === 'fine' ? 0.1 : size === 'large' ? 10 : 1);
}
