import { describe, expect, it } from "vitest";

import {
  type WorkspaceItemFrame,
  type WorkspaceItemTransform,
  getWorkspaceSelectionBounds,
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
} from "./workspace-utils";

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

describe("workspace measurement helpers", () => {
  it("resolves known Cricut Joy mat presets to workpiece sizes in inches", () => {
    expect(getMatDimensionsInches("joy-standard")).toEqual({ width: 4.5, height: 12 });
    expect(getMatDimensionsInches("joy-standard-short")).toEqual({ width: 4.5, height: 6.5 });
    expect(getMatDimensionsInches("joy-card")).toEqual({ width: 4.5, height: 6.25 });
  });

  it("converts inch coordinates for inch, cm, and mm unit settings", () => {
    expect(inchesToDisplayValue(2, "in")).toBe(2);
    expect(inchesToDisplayValue(2, "cm")).toBe(5.08);
    expect(inchesToDisplayValue(2, "mm")).toBe(50.8);
  });

  it("creates ruler ticks from the workpiece top-left origin at the current zoom and pan", () => {
    const ticks = getMeasurementTicks({
      lengthInches: 4.5,
      axis: "x",
      unit: "in",
      zoom: 2,
      pan: { x: 120, y: 40 },
      pixelsPerInch: 80,
    });

    expect(ticks[0]).toMatchObject({ value: 0, label: "0", position: 120, major: true });
    expect(ticks).toContainEqual(expect.objectContaining({ value: 1, label: "1", position: 280, major: true }));
    expect(ticks.at(-1)).toMatchObject({ value: 4.5, label: "" });
  });

  it("labels every whole centimeter and hides decimal labels on metric rulers", () => {
    const ticks = getMeasurementTicks({
      lengthInches: 4.5,
      axis: "x",
      unit: "cm",
      zoom: 0.85,
      pan: { x: 260, y: 90 },
      pixelsPerInch: 80,
    });

    expect(ticks.map((tick) => tick.label).filter(Boolean)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
    ]);
    expect(ticks.some((tick) => tick.label.includes("."))).toBe(false);
  });

  it("keeps pan and zoom as a single viewport transform for scroll/drag/zoom synced rulers", () => {
    expect(getViewportTransform({ zoom: 1.5, pan: { x: -48, y: 72 } })).toBe("translate(-48px, 72px) scale(1.5)");
  });

  it("formats image transforms with position and rotation only (scale encoded in size)", () => {
    expect(getWorkspaceItemTransform({ x: 12.345, y: 67.891, scaleX: 1.234, scaleY: 0.876, rotation: 14.567 })).toBe(
      "translate3d(12.35px, 67.89px, 0) rotate(14.57deg)",
    );
  });

  it("normalizes image transforms without clamping x/y to the mat", () => {
    expect(normalizeWorkspaceItemTransform({ x: -12, y: 999, scaleX: 8, scaleY: 0.02, rotation: 370 })).toEqual({
      x: -12,
      y: 999,
      scaleX: 8,
      scaleY: 0.02,
      rotation: 10,
      mirrorX: false,
      mirrorY: false,
    });
  });

  it("builds one selection bounds box around multiple transformed workspace items", () => {
    const bounds = getWorkspaceSelectionBounds([
      { frame: { width: 100, height: 50 }, transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 } },
      { frame: { width: 40, height: 30 }, transform: { x: 150, y: 40, scaleX: 2, scaleY: 1, rotation: 0 } },
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

  it("scales and rotates item transforms around a shared selection anchor", () => {
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

  it("keeps the anchor fixed when scaling a rotated object along one axis", () => {
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
    const anchorX = result.x + Math.cos(r) * (100 * result.scaleX) - Math.sin(r) * (50 * result.scaleY);
    const anchorY = result.y + Math.sin(r) * (100 * result.scaleX) + Math.cos(r) * (50 * result.scaleY);
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(1);
    expect(anchorX).toBeCloseTo(-50);
    expect(anchorY).toBeCloseTo(100);
  });

  it("round-trips local↔world offsets including mirror and rotation", () => {
    const transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 37, mirrorX: true, mirrorY: false };
    const original = { x: 42, y: -17 };
    const roundTripped = worldOffsetToLocal(localOffsetToWorld(original, transform), transform);
    expect(roundTripped.x).toBeCloseTo(original.x);
    expect(roundTripped.y).toBeCloseTo(original.y);
  });

  it("keeps the grabbed edge pinned when scaling a horizontally mirrored object", () => {
    // Mirrored object: its visual LEFT edge corresponds to local x = width.
    // Dragging the east handle fixes local x = 0 (direction[0] === 1), which for a
    // mirrored item is the visual RIGHT edge. Whichever edge we pin must stay put.
    const frame = { width: 100, height: 60 };
    const start: WorkspaceItemTransform = { x: 200, y: 50, scaleX: 1, scaleY: 1, rotation: 0, mirrorX: true, mirrorY: false };

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

  it("keeps the anchor fixed when scaling a mirrored, rotated object", () => {
    const frame = { width: 80, height: 120 };
    const start: WorkspaceItemTransform = { x: 10, y: 20, scaleX: 1.5, scaleY: 1, rotation: 33, mirrorX: true, mirrorY: true };
    const anchor = worldPointOf(start, frame, 1, 0); // a specific corner
    const scaled = scaleWorkspaceItemTransformFromAnchor(start, frame, anchor, 1.7, 0.6);
    const after = worldPointOf(scaled, frame, 1, 0);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  describe("snapScaleFactorToAspect", () => {
    const frame = { width: 100, height: 100 };

    it("snaps the X axis to natural proportions when within the threshold", () => {
      // start undistorted (1:1); drag X to 1.05 → 5px from natural at zoom 1 (< 8px).
      const result = snapScaleFactorToAspect({
        axis: "x", startScaleX: 1, startScaleY: 1, scaleFactorX: 1.05, scaleFactorY: 1, frame, zoom: 1,
      });
      expect(result.snapped).toBe(true);
      expect(result.scaleFactorX).toBeCloseTo(1); // snapped back to scaleY
    });

    it("does not snap when the dragged axis is well past the threshold", () => {
      const result = snapScaleFactorToAspect({
        axis: "x", startScaleX: 1, startScaleY: 1, scaleFactorX: 1.2, scaleFactorY: 1, frame, zoom: 1,
      });
      expect(result.snapped).toBe(false);
      expect(result.scaleFactorX).toBe(1.2);
    });

    it("widens the snap window in workspace space when zoomed out", () => {
      // 12px from natural: skipped at zoom 1, caught at zoom 0.5 (threshold → 16 workspace px).
      const zoomedIn = snapScaleFactorToAspect({
        axis: "x", startScaleX: 1, startScaleY: 1, scaleFactorX: 1.12, scaleFactorY: 1, frame, zoom: 1,
      });
      expect(zoomedIn.snapped).toBe(false);
      const zoomedOut = snapScaleFactorToAspect({
        axis: "x", startScaleX: 1, startScaleY: 1, scaleFactorX: 1.12, scaleFactorY: 1, frame, zoom: 0.5,
      });
      expect(zoomedOut.snapped).toBe(true);
    });

    it("snaps the Y axis toward the fixed X scale (already-distorted item)", () => {
      // Item distorted to scaleX 2; drag Y near 2 → should lock to 2:1 → undistorted.
      const result = snapScaleFactorToAspect({
        axis: "y", startScaleX: 2, startScaleY: 1, scaleFactorX: 1, scaleFactorY: 1.97, frame, zoom: 1,
      });
      expect(result.snapped).toBe(true);
      // nextScaleY = startScaleY * factor = 1 * 2 = 2 === scaleX
      expect(result.scaleFactorY * 1).toBeCloseTo(2);
    });
  });
});
