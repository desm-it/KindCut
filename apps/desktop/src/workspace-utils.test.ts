import { describe, expect, it } from 'vitest';

import {
  type WorkspaceItemFrame,
  type WorkspaceItemTransform,
  CARD_SIZES,
  alignWorkspaceItems,
  distributeWorkspaceItems,
  getSnapTargets,
  nudgeStepPx,
  snapDragDelta,
  buildInsertSlotsPaths,
  getInsertSlots,
  isCardSize,
  getWorkspaceSelectionBounds,
  findFreePlacement,
  fitMatToView,
  getMatBorder,
  getMatDimensionsInches,
  getMeasurementTicks,
  getViewportTransform,
  getWorkspaceItemTransform,
  inchesToDisplayValue,
  localOffsetToWorld,
  normalizeWorkspaceItemTransform,
  rotateWorkspaceItemTransformAroundPoint,
  scaleWorkspaceItemTransformFromAnchor,
  snapScaleFactorToAspect,
  worldOffsetToLocal,
} from './workspace-utils';

// Screen position of a normalised local box point (0..1, 0..1) under a transform,
// matching exactly how CSS renders translate(x,y) rotate(θ) scale(±1,±1) with
// transform-origin: top left.
function worldPointOf(
  transform: WorkspaceItemTransform,
  frame: WorkspaceItemFrame,
  normX: number,
  normY: number,
): { x: number; y: number } {
  const offset = localOffsetToWorld(
    { x: normX * frame.width * transform.scaleX, y: normY * frame.height * transform.scaleY },
    transform,
  );
  return { x: transform.x + offset.x, y: transform.y + offset.y };
}

describe('workspace measurement helpers', () => {
  it('resolves known Cricut Joy mat presets to workpiece sizes in inches', () => {
    expect(getMatDimensionsInches('joy-standard')).toEqual({ width: 4.5, height: 12 });
    expect(getMatDimensionsInches('joy-standard-short')).toEqual({ width: 4.5, height: 6.5 });
    expect(getMatDimensionsInches('joy-card')).toEqual({ width: 4.5, height: 6.25 });
  });

  it('converts inch coordinates for inch, cm, and mm unit settings', () => {
    expect(inchesToDisplayValue(2, 'in')).toBe(2);
    expect(inchesToDisplayValue(2, 'cm')).toBe(5.08);
    expect(inchesToDisplayValue(2, 'mm')).toBe(50.8);
  });

  it('creates ruler ticks from the workpiece top-left origin at the current zoom and pan', () => {
    const ticks = getMeasurementTicks({
      lengthInches: 4.5,
      axis: 'x',
      unit: 'in',
      zoom: 2,
      pan: { x: 120, y: 40 },
      pixelsPerInch: 80,
    });

    expect(ticks[0]).toMatchObject({ value: 0, label: '0', position: 120, major: true });
    expect(ticks).toContainEqual(
      expect.objectContaining({ value: 1, label: '1', position: 280, major: true }),
    );
    expect(ticks.at(-1)).toMatchObject({ value: 4.5, label: '' });
  });

  it('labels every whole centimeter and hides decimal labels on metric rulers', () => {
    const ticks = getMeasurementTicks({
      lengthInches: 4.5,
      axis: 'x',
      unit: 'cm',
      zoom: 0.85,
      pan: { x: 260, y: 90 },
      pixelsPerInch: 80,
    });

    expect(ticks.map((tick) => tick.label).filter(Boolean)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
    ]);
    expect(ticks.some((tick) => tick.label.includes('.'))).toBe(false);
  });

  it('keeps pan and zoom as a single viewport transform for scroll/drag/zoom synced rulers', () => {
    expect(getViewportTransform({ zoom: 1.5, pan: { x: -48, y: 72 } })).toBe(
      'translate(-48px, 72px) scale(1.5)',
    );
  });

  it('formats image transforms with position and rotation only (scale encoded in size)', () => {
    expect(
      getWorkspaceItemTransform({
        x: 12.345,
        y: 67.891,
        scaleX: 1.234,
        scaleY: 0.876,
        rotation: 14.567,
      }),
    ).toBe('translate3d(12.35px, 67.89px, 0) rotate(14.57deg)');
  });

  it('normalizes image transforms without clamping x/y to the mat', () => {
    expect(
      normalizeWorkspaceItemTransform({ x: -12, y: 999, scaleX: 8, scaleY: 0.02, rotation: 370 }),
    ).toEqual({
      x: -12,
      y: 999,
      scaleX: 8,
      scaleY: 0.02,
      rotation: 10,
      mirrorX: false,
      mirrorY: false,
    });
  });

  it('builds one selection bounds box around multiple transformed workspace items', () => {
    const bounds = getWorkspaceSelectionBounds([
      {
        frame: { width: 100, height: 50 },
        transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
      },
      {
        frame: { width: 40, height: 30 },
        transform: { x: 150, y: 40, scaleX: 2, scaleY: 1, rotation: 0 },
      },
    ]);

    expect(bounds).toMatchObject({
      left: 10,
      top: 20,
      right: 230,
      bottom: 70,
      width: 220,
      height: 50,
      center: { x: 120, y: 45 },
    });
  });

  it('scales and rotates item transforms around a shared selection anchor', () => {
    expect(
      scaleWorkspaceItemTransformFromAnchor(
        { x: 20, y: 30, scaleX: 1, scaleY: 2, rotation: 0 },
        { width: 10, height: 10 },
        { x: 10, y: 10 },
        2,
        0.5,
      ),
    ).toEqual({ x: 30, y: 20, scaleX: 2, scaleY: 1, rotation: 0, mirrorX: false, mirrorY: false });

    expect(
      rotateWorkspaceItemTransformAroundPoint(
        { x: 20, y: 10, scaleX: 1, scaleY: 1, rotation: 0 },
        { width: 10, height: 10 },
        { x: 10, y: 10 },
        90,
      ),
    ).toEqual({ x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 90, mirrorX: false, mirrorY: false });
  });

  it('keeps the anchor fixed when scaling a rotated object along one axis', () => {
    // Object at (0,0), 100×100 frame, scale 1, rotated 90°.
    // Right-center in local space = (100, 50) → screen anchor = (-50, 100).
    // Scale X by 2: anchor must stay at (-50, 100).
    const result = scaleWorkspaceItemTransformFromAnchor(
      { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90 },
      { width: 100, height: 100 },
      { x: -50, y: 100 },
      2,
      1,
    );
    const r = (result.rotation * Math.PI) / 180;
    const anchorX =
      result.x + Math.cos(r) * (100 * result.scaleX) - Math.sin(r) * (50 * result.scaleY);
    const anchorY =
      result.y + Math.sin(r) * (100 * result.scaleX) + Math.cos(r) * (50 * result.scaleY);
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(1);
    expect(anchorX).toBeCloseTo(-50);
    expect(anchorY).toBeCloseTo(100);
  });

  it('round-trips local↔world offsets including mirror and rotation', () => {
    const transform = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 37,
      mirrorX: true,
      mirrorY: false,
    };
    const original = { x: 42, y: -17 };
    const roundTripped = worldOffsetToLocal(localOffsetToWorld(original, transform), transform);
    expect(roundTripped.x).toBeCloseTo(original.x);
    expect(roundTripped.y).toBeCloseTo(original.y);
  });

  it('keeps the grabbed edge pinned when scaling a horizontally mirrored object', () => {
    // Mirrored object: its visual LEFT edge corresponds to local x = width.
    // Dragging the east handle fixes local x = 0 (direction[0] === 1), which for a
    // mirrored item is the visual RIGHT edge. Whichever edge we pin must stay put.
    const frame = { width: 100, height: 60 };
    const start: WorkspaceItemTransform = {
      x: 200,
      y: 50,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      mirrorX: true,
      mirrorY: false,
    };

    // Pin the local-left edge (normX 0) at its current world position, then scale X up.
    const anchor = worldPointOf(start, frame, 0, 0.5);
    const scaled = scaleWorkspaceItemTransformFromAnchor(start, frame, anchor, 2, 1);

    // The same normalised local point must still land on the original anchor.
    const after = worldPointOf(scaled, frame, 0, 0.5);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
    expect(scaled.scaleX).toBeCloseTo(2);
    expect(scaled.mirrorX).toBe(true);
  });

  it('keeps the anchor fixed when scaling a mirrored, rotated object', () => {
    const frame = { width: 80, height: 120 };
    const start: WorkspaceItemTransform = {
      x: 10,
      y: 20,
      scaleX: 1.5,
      scaleY: 1,
      rotation: 33,
      mirrorX: true,
      mirrorY: true,
    };
    const anchor = worldPointOf(start, frame, 1, 0); // a specific corner
    const scaled = scaleWorkspaceItemTransformFromAnchor(start, frame, anchor, 1.7, 0.6);
    const after = worldPointOf(scaled, frame, 1, 0);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  describe('snapScaleFactorToAspect', () => {
    const frame = { width: 100, height: 100 };

    it('snaps the X axis to natural proportions when within the threshold', () => {
      // start undistorted (1:1); drag X to 1.05 → 5px from natural at zoom 1 (< 8px).
      const result = snapScaleFactorToAspect({
        axis: 'x',
        startScaleX: 1,
        startScaleY: 1,
        scaleFactorX: 1.05,
        scaleFactorY: 1,
        frame,
        zoom: 1,
      });
      expect(result.snapped).toBe(true);
      expect(result.scaleFactorX).toBeCloseTo(1); // snapped back to scaleY
    });

    it('does not snap when the dragged axis is well past the threshold', () => {
      const result = snapScaleFactorToAspect({
        axis: 'x',
        startScaleX: 1,
        startScaleY: 1,
        scaleFactorX: 1.2,
        scaleFactorY: 1,
        frame,
        zoom: 1,
      });
      expect(result.snapped).toBe(false);
      expect(result.scaleFactorX).toBe(1.2);
    });

    it('widens the snap window in workspace space when zoomed out', () => {
      // 12px from natural: skipped at zoom 1, caught at zoom 0.5 (threshold → 16 workspace px).
      const zoomedIn = snapScaleFactorToAspect({
        axis: 'x',
        startScaleX: 1,
        startScaleY: 1,
        scaleFactorX: 1.12,
        scaleFactorY: 1,
        frame,
        zoom: 1,
      });
      expect(zoomedIn.snapped).toBe(false);
      const zoomedOut = snapScaleFactorToAspect({
        axis: 'x',
        startScaleX: 1,
        startScaleY: 1,
        scaleFactorX: 1.12,
        scaleFactorY: 1,
        frame,
        zoom: 0.5,
      });
      expect(zoomedOut.snapped).toBe(true);
    });

    it('snaps the Y axis toward the fixed X scale (already-distorted item)', () => {
      // Item distorted to scaleX 2; drag Y near 2 → should lock to 2:1 → undistorted.
      const result = snapScaleFactorToAspect({
        axis: 'y',
        startScaleX: 2,
        startScaleY: 1,
        scaleFactorX: 1,
        scaleFactorY: 1.97,
        frame,
        zoom: 1,
      });
      expect(result.snapped).toBe(true);
      // nextScaleY = startScaleY * factor = 1 * 2 = 2 === scaleX
      expect(result.scaleFactorY * 1).toBeCloseTo(2);
    });
  });

  describe('insert-card sizes & slots', () => {
    it('recognises valid card sizes', () => {
      expect(isCardSize('small')).toBe(true);
      expect(isCardSize('large')).toBe(true);
      expect(isCardSize('huge')).toBe(false);
      expect(isCardSize(null)).toBe(false);
    });

    it('orders card sizes small < medium < large by area', () => {
      const area = (s: keyof typeof CARD_SIZES) => CARD_SIZES[s].width * CARD_SIZES[s].height;
      expect(area('small')).toBeLessThan(area('medium'));
      expect(area('medium')).toBeLessThan(area('large'));
    });

    it('places one slot per corner inset symmetrically', () => {
      const slots = getInsertSlots(400, 600);
      expect(slots).toHaveLength(4);
      const inset = slots[0]!.cx; // top-left slot offset from (0,0)
      expect(inset).toBeGreaterThan(0);
      // Opposite corners are inset by the same amount from their corner.
      expect(400 - slots[1]!.cx).toBeCloseTo(inset); // top-right
      expect(600 - slots[2]!.cy).toBeCloseTo(inset); // bottom-left
      // Opposing corners share an angle; adjacent corners differ by 90°.
      expect(Math.abs(slots[0]!.angle - slots[3]!.angle) % 180).toBeCloseTo(0);
      expect(Math.abs(slots[0]!.angle - slots[1]!.angle) % 180).toBeCloseTo(90);
    });

    it('builds 4 slot paths in the given colour', () => {
      const svg = buildInsertSlotsPaths(400, 600, '#8f4f2b');
      expect((svg.match(/<path /g) ?? []).length).toBe(4);
      expect(svg).toContain('#8f4f2b');
      expect(svg).toContain('rotate(');
    });
  });
});

describe('fitMatToView', () => {
  it('shows the whole long mat, border included, centred in the canvas', () => {
    const paper = { width: 360, height: 960 };
    const border = getMatBorder('standard');
    const available = { width: 880, height: 687 };
    const { zoom, pan } = fitMatToView({ paper, border, available });
    const top = pan.y - border.top * zoom;
    const bottom = pan.y + (paper.height + border.bottom) * zoom;
    expect(top).toBeGreaterThanOrEqual(19.9);
    expect(bottom).toBeLessThanOrEqual(available.height - 19.9);
    expect(top).toBeCloseTo(available.height - bottom);
    const left = pan.x - border.side * zoom;
    const right = pan.x + (paper.width + border.side) * zoom;
    expect(left).toBeCloseTo(available.width - right);
  });

  it('does not blow a small mat up beyond a comfortable size', () => {
    const { zoom } = fitMatToView({
      paper: { width: 360, height: 520 },
      border: getMatBorder('standard'),
      available: { width: 3000, height: 2000 },
    });
    expect(zoom).toBe(1.25);
  });
});

describe('findFreePlacement', () => {
  const area = { x: 0, y: 0, width: 360, height: 520 };

  it('puts the first object in the middle of the area', () => {
    expect(findFreePlacement({ size: { width: 100, height: 60 }, area, occupied: [] })).toEqual({
      x: 130,
      y: 230,
    });
  });

  it('puts the next object beside the first instead of on top of it', () => {
    const first = { x: 130, y: 230, width: 100, height: 60 };
    const spot = findFreePlacement({ size: { width: 100, height: 60 }, area, occupied: [first] });
    const overlapsX = spot.x < first.x + first.width && spot.x + 100 > first.x;
    const overlapsY = spot.y < first.y + first.height && spot.y + 60 > first.y;
    expect(overlapsX && overlapsY).toBe(false);
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.x + 100).toBeLessThanOrEqual(360);
    expect(spot.y).toBeGreaterThanOrEqual(0);
    expect(spot.y + 60).toBeLessThanOrEqual(520);
  });

  it('uses a tight fit against the edge when that avoids covering anything', () => {
    // A 170 px shape in the middle leaves exactly 175 px below it on a 520 px sheet.
    const first = { x: 95, y: 175, width: 170, height: 170 };
    const second = findFreePlacement({
      size: { width: 170, height: 170 },
      area,
      occupied: [first],
    });
    expect(second.y >= 345 || second.y + 170 <= 175).toBe(true);
    const third = findFreePlacement({
      size: { width: 170, height: 170 },
      area,
      occupied: [first, { ...second, width: 170, height: 170 }],
    });
    const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      a.x < b.x + 170 && b.x < a.x + 170 && a.y < b.y + 170 && b.y < a.y + 170;
    expect(overlaps(third, first)).toBe(false);
    expect(overlaps(third, second)).toBe(false);
  });

  it('centres an object that is bigger than the area', () => {
    expect(findFreePlacement({ size: { width: 400, height: 600 }, area, occupied: [] })).toEqual({
      x: -20,
      y: -40,
    });
  });

  it('takes the least covered spot when the area is full', () => {
    const spot = findFreePlacement({
      size: { width: 100, height: 100 },
      area,
      occupied: [{ x: 0, y: 0, width: 360, height: 400 }],
    });
    expect(spot.y).toBeGreaterThan(380);
  });
});

describe('align, distribute, snap and nudge', () => {
  const box = (id: string, x: number, y: number, width: number, height: number, rotation = 0) => ({
    id,
    frame: { width, height },
    transform: { x, y, scaleX: 1, scaleY: 1, rotation },
  });
  const paper = { x: 0, y: 0, width: 400, height: 600 };

  it('centres a single object on the paper', () => {
    const [update] = alignWorkspaceItems([box('a', 10, 10, 100, 50)], 'center', paper);
    expect(update?.transform.x).toBe(150);
    expect(update?.transform.y).toBe(10);
    const [middle] = alignWorkspaceItems([box('a', 10, 10, 100, 50)], 'middle', paper);
    expect(middle?.transform.y).toBe(275);
    const [right] = alignWorkspaceItems([box('a', 10, 10, 100, 50)], 'right', paper);
    expect(right?.transform.x).toBe(300);
  });

  it('aligns several objects to each other, not to the paper', () => {
    const updates = alignWorkspaceItems(
      [box('a', 20, 0, 100, 50), box('b', 60, 100, 40, 40)],
      'left',
      paper,
    );
    expect(updates.map((update) => update.transform.x)).toEqual([20, 20]);
    const centred = alignWorkspaceItems(
      [box('a', 20, 0, 100, 50), box('b', 60, 100, 40, 40)],
      'center',
      paper,
    );
    // The pair spans 20..120, so both centres go to 70.
    expect(centred.map((update) => update.transform.x)).toEqual([20, 50]);
  });

  it('aligns a rotated object by the box around it', () => {
    // 100×20 turned a quarter: it occupies x from -20 to 0 around its origin.
    const [update] = alignWorkspaceItems([box('a', 50, 50, 100, 20, 90)], 'left', paper);
    expect(update?.transform.x).toBeCloseTo(20, 6);
  });

  it('distributes with equal gaps and keeps the outer objects in place', () => {
    const updates = distributeWorkspaceItems(
      [box('a', 0, 0, 20, 20), box('c', 180, 0, 20, 20), box('b', 30, 0, 40, 20)],
      'x',
    );
    const byId = Object.fromEntries(updates.map((update) => [update.id, update.transform.x]));
    expect(byId).toEqual({ a: 0, b: 80, c: 180 });
    expect(
      distributeWorkspaceItems([box('a', 0, 0, 20, 20), box('b', 30, 0, 40, 20)], 'x'),
    ).toEqual([]);
  });

  it('snaps a dragged box to the nearest line within reach', () => {
    const targets = getSnapTargets(paper, [box('other', 300, 500, 50, 50)]);
    expect(targets.x).toEqual([0, 200, 400, 300, 325, 350]);
    const bounds = { left: 0, right: 100, top: 0, bottom: 50 };
    // Centre at 153 → snaps to the paper's middle (200) by moving 3 further.
    const snapped = snapDragDelta({ bounds, delta: { x: 147, y: 200 }, targets, threshold: 5 });
    expect(snapped.delta).toEqual({ x: 150, y: 200 });
    expect(snapped.guides).toEqual([{ axis: 'x', position: 200 }]);
    // Out of reach: untouched.
    const free = snapDragDelta({ bounds, delta: { x: 120, y: 200 }, targets, threshold: 5 });
    expect(free.delta).toEqual({ x: 120, y: 200 });
    expect(free.guides).toEqual([]);
    // Both axes: bottom edge onto the other object's top (500), left edge onto its left (300).
    const both = snapDragDelta({ bounds, delta: { x: 298, y: 452 }, targets, threshold: 5 });
    expect(both.delta).toEqual({ x: 300, y: 450 });
    expect(both.guides).toHaveLength(2);
  });

  it('nudges by a millimetre, or a sixteenth of an inch', () => {
    expect(nudgeStepPx('mm', 'normal')).toBeCloseTo(80 / 25.4, 6);
    expect(nudgeStepPx('cm', 'large')).toBeCloseTo(800 / 25.4, 6);
    expect(nudgeStepPx('in', 'normal')).toBe(5);
    expect(nudgeStepPx('mm', 'fine')).toBeLessThan(nudgeStepPx('mm', 'normal'));
  });
});
