export type MeasurementUnit = "in" | "cm" | "mm";
export type RulerAxis = "x" | "y";

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
  scaleX: number;
  scaleY: number;
  rotation: number;
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
  "joy-standard": { width: 4.5, height: 12 },
  "joy-standard-short": { width: 4.5, height: 6.5 },
  "joy-card": { width: 4.5, height: 6.25 },
};

export function getMatDimensionsInches(matPreset: string): MatDimensions {
  return MAT_DIMENSIONS_INCHES[matPreset] ?? { width: 4.5, height: 12 };
}

export function inchesToDisplayValue(valueInInches: number, unit: MeasurementUnit): number {
  switch (unit) {
    case "cm":
      return roundMeasurement(valueInInches * 2.54);
    case "mm":
      return roundMeasurement(valueInInches * 25.4);
    case "in":
    default:
      return roundMeasurement(valueInInches);
  }
}

export function getViewportTransform({ zoom, pan }: { zoom: number; pan: Point }): string {
  return `translate(${roundCss(pan.x)}px, ${roundCss(pan.y)}px) scale(${roundCss(zoom)})`;
}

export function getWorkspaceItemTransform({ x, y, rotation }: WorkspaceItemTransform): string {
  return `translate3d(${roundCss(x)}px, ${roundCss(y)}px, 0) rotate(${roundCss(rotation)}deg)`;
}

export function getWorkspaceItemVisualSize(frame: WorkspaceItemFrame, transform: WorkspaceItemTransform): { width: number; height: number } {
  return {
    width: frame.width * transform.scaleX,
    height: frame.height * transform.scaleY,
  };
}

export function normalizeWorkspaceItemTransform(transform: WorkspaceItemTransform): WorkspaceItemTransform {
  return {
    x: roundCss(Number.isFinite(transform.x) ? transform.x : 0),
    y: roundCss(Number.isFinite(transform.y) ? transform.y : 0),
    scaleX: clamp(roundCss(transform.scaleX), 0.1, 4),
    scaleY: clamp(roundCss(transform.scaleY), 0.1, 4),
    rotation: normalizeRotation(Number.isFinite(transform.rotation) ? roundCss(transform.rotation) : 0),
  };
}

export function getWorkspaceSelectionBounds(items: WorkspaceTransformableItem[]): WorkspaceBounds | null {
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
  const nextScaleX = transform.scaleX * scaleX;
  const nextScaleY = transform.scaleY * scaleY;

  // Convert the screen-space anchor back to the object's local pixel space so we
  // can re-apply it correctly after the new scale (screen-space scaling breaks for
  // rotated objects because local X/Y no longer align with screen X/Y).
  const localAnchorStart = rotatePoint(
    { x: anchor.x - transform.x, y: anchor.y - transform.y },
    -transform.rotation,
  );
  const startWidth = frame.width * transform.scaleX;
  const startHeight = frame.height * transform.scaleY;
  const anchorNormX = startWidth > 0 ? localAnchorStart.x / startWidth : 0.5;
  const anchorNormY = startHeight > 0 ? localAnchorStart.y / startHeight : 0.5;

  const localAnchorNew = {
    x: anchorNormX * frame.width * nextScaleX,
    y: anchorNormY * frame.height * nextScaleY,
  };
  const rotatedAnchorNew = rotatePoint(localAnchorNew, transform.rotation);

  return normalizeWorkspaceItemTransform({
    ...transform,
    x: anchor.x - rotatedAnchorNew.x,
    y: anchor.y - rotatedAnchorNew.y,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
  });
}

export function rotateWorkspaceItemTransformAroundPoint(
  transform: WorkspaceItemTransform,
  frame: WorkspaceItemFrame,
  center: Point,
  degrees: number,
): WorkspaceItemTransform {
  const itemCenter = getWorkspaceItemCenter({ transform, frame });
  const nextCenter = addPoint(center, rotatePoint({ x: itemCenter.x - center.x, y: itemCenter.y - center.y }, degrees));
  const nextRotation = transform.rotation + degrees;
  const nextCenterOffset = rotatePoint(
    { x: (frame.width * transform.scaleX) / 2, y: (frame.height * transform.scaleY) / 2 },
    nextRotation,
  );

  return normalizeWorkspaceItemTransform({
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
  const subdivisionDisplayValue = unit === "in" ? 0.25 : unit === "cm" ? 0.5 : 5;
  const ticks: MeasurementTick[] = [];
  const count = Math.ceil(maxDisplayValue / subdivisionDisplayValue);

  for (let index = 0; index <= count; index += 1) {
    const displayValue = Math.min(maxDisplayValue, roundMeasurement(index * subdivisionDisplayValue));
    const valueInches = displayValueToInches(displayValue, unit);
    const isEnd = Math.abs(displayValue - maxDisplayValue) < 0.001;
    const label = shouldLabelWholeNumber(displayValue, unit) ? formatTickLabel(displayValue, unit) : "";

    ticks.push({
      value: displayValue,
      label,
      position: roundCss((axis === "x" ? pan.x : pan.y) + valueInches * pixelsPerInch * zoom),
      major: label !== "" || isEnd,
    });

    if (isEnd) {
      break;
    }
  }

  return ticks;
}

function displayValueToInches(value: number, unit: MeasurementUnit): number {
  switch (unit) {
    case "cm":
      return value / 2.54;
    case "mm":
      return value / 25.4;
    case "in":
    default:
      return value;
  }
}

function getWorkspaceItemCenter({ transform, frame }: WorkspaceTransformableItem): Point {
  return addPoint(
    { x: transform.x, y: transform.y },
    rotatePoint({ x: (frame.width * transform.scaleX) / 2, y: (frame.height * transform.scaleY) / 2 }, transform.rotation),
  );
}

function getWorkspaceItemCorners({ transform, frame }: WorkspaceTransformableItem): Point[] {
  const width = frame.width * transform.scaleX;
  const height = frame.height * transform.scaleY;
  const topLeft = { x: transform.x, y: transform.y };

  return [
    topLeft,
    addPoint(topLeft, rotatePoint({ x: width, y: 0 }, transform.rotation)),
    addPoint(topLeft, rotatePoint({ x: width, y: height }, transform.rotation)),
    addPoint(topLeft, rotatePoint({ x: 0, y: height }, transform.rotation)),
  ];
}

function shouldLabelWholeNumber(value: number, unit: MeasurementUnit): boolean {
  if (!Number.isInteger(value)) {
    return false;
  }
  return unit !== "mm" || value % 10 === 0;
}

function formatTickLabel(value: number, unit: MeasurementUnit): string {
  if (unit === "mm") {
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

function normalizeRotation(value: number): number {
  const rotation = value % 360;
  return rotation > 180 ? rotation - 360 : rotation < -180 ? rotation + 360 : rotation;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
