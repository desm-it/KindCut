// Renderer side of dot prints: loads the stored picture's pixels, generates the
// dots (cached, so the canvas and the settings panel share one run) and turns
// them into real pen paths for the cutter.

import { useEffect, useState } from 'react';
import {
  DEFAULT_DOT_PRINT,
  DEFAULT_INK_PEN_COLORS,
  type DotPrintChannel,
  type DotPrintSettings,
  type RasterImage,
  dotPrintInkTip,
  dotPrintInks,
  dotStroke,
  generateDotPrint,
} from '@cricut-companion/craft-core';
import type { WorkspaceTool } from './project-file';
import { getPens, withPens } from './project-file';
import type { WorkspaceObject, WorkspacePathData } from './workspace-objects';
import { WORKSPACE_PX_PER_MM } from './pen-fill-render';

/** Pictures are stored at most this size; that's finer than any useful pen-dot grid. */
const MAX_STORED_IMAGE_PX = 800;
/** Dots per SliceBug path; keeps each message to the machine a manageable size. */
const DOTS_PER_PATH = 400;

const imageCache = new Map<string, Promise<RasterImage>>();

/** Decodes a picture data URL into RGBA pixels (cached per picture). */
export function loadRasterImage(dataUrl: string): Promise<RasterImage> {
  let pending = imageCache.get(dataUrl);
  if (!pending) {
    pending = (async () => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available.');
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      return { data, width, height };
    })();
    imageCache.set(dataUrl, pending);
    pending.catch(() => imageCache.delete(dataUrl));
  }
  return pending;
}

export function useRasterImage(dataUrl: string | undefined): RasterImage | null {
  const [image, setImage] = useState<RasterImage | null>(null);
  useEffect(() => {
    let alive = true;
    setImage(null);
    if (dataUrl) {
      loadRasterImage(dataUrl)
        .then((loaded) => {
          if (alive) setImage(loaded);
        })
        .catch((error) => console.error('[DotPrint] Could not read the picture:', error));
    }
    return () => {
      alive = false;
    };
  }, [dataUrl]);
  return image;
}

/** Printed size in millimetres. */
export function dotPrintSizeMm(item: WorkspaceObject): { width: number; height: number } {
  return {
    width: (item.frame.width * Math.abs(item.transform.scaleX || 1)) / WORKSPACE_PX_PER_MM,
    height: (item.frame.height * Math.abs(item.transform.scaleY || 1)) / WORKSPACE_PX_PER_MM,
  };
}

const channelCache = new WeakMap<RasterImage, Map<string, DotPrintChannel[]>>();

/** The dots for a dot-print object (positions in mm from its top-left), cached per picture/size/settings. */
export function dotPrintChannels(item: WorkspaceObject, image: RasterImage): DotPrintChannel[] {
  if (!item.dotPrint) return [];
  const size = dotPrintSizeMm(item);
  // Ink bleed only changes how dots look, not where they go, so it isn't part of the key.
  const {
    inkBleed: _previewOnly,
    blackInkBleed: _blackPreviewOnly,
    ...placement
  } = item.dotPrint.settings;
  const key = JSON.stringify([size.width.toFixed(3), size.height.toFixed(3), placement]);
  let byKey = channelCache.get(image);
  if (!byKey) {
    byKey = new Map();
    channelCache.set(image, byKey);
  }
  let channels = byKey.get(key);
  if (!channels) {
    channels = generateDotPrint(image, size, item.dotPrint.settings);
    // Keep a few recent results (slider drags produce many variants).
    if (byKey.size > 8) byKey.delete(byKey.keys().next().value as string);
    byKey.set(key, channels);
  }
  return channels;
}

/** Reads a picture file and stores it downscaled, keeping transparency for PNGs. */
export async function readDotPrintImageFile(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const scale = Math.min(
      1,
      MAX_STORED_IMAGE_PX / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available.');
    context.drawImage(image, 0, 0, width, height);
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    return {
      dataUrl: canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.92),
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/**
 * Makes sure the project has a pen for every ink, reusing pens that already
 * have the ink's colour, and returns the updated tools plus the pen per ink.
 */
export function ensureInkPens(tools: WorkspaceTool[]): {
  tools: WorkspaceTool[];
  pens: DotPrintSettings['pens'];
} {
  const pens = getPens(tools);
  const added: WorkspaceTool[] = [];
  for (const [ink, color] of Object.entries(DEFAULT_INK_PEN_COLORS)) {
    if (
      !pens.some((pen) => pen.color.toLowerCase() === color) &&
      !added.some((pen) => pen.color === color)
    ) {
      added.push({ id: `pen-${ink}-${Date.now()}`, color, type: 'pen' });
    }
  }
  return {
    tools: added.length > 0 ? withPens(tools, [...pens, ...added]) : tools,
    pens: { ...DEFAULT_INK_PEN_COLORS },
  };
}

/** Ink pen colours a dot print uses that aren't pens in the project (they would be skipped). */
export function missingInkPens(item: WorkspaceObject, tools: WorkspaceTool[]): string[] {
  if (!item.dotPrint) return [];
  const penColors = new Set(getPens(tools).map((pen) => pen.color.toLowerCase()));
  return dotPrintInks(item.dotPrint.settings)
    .map((ink) => item.dotPrint!.settings.pens[ink])
    .filter((color) => !penColors.has(color.toLowerCase()));
}

/**
 * The dots as real pen paths in the object's frame space, one colour after the
 * other in drawing order, so the cut pipeline treats them like any pen drawing.
 */
export function dotPrintToPaths(item: WorkspaceObject, image: RasterImage): WorkspacePathData[] {
  if (!item.dotPrint) return [];
  const settings = item.dotPrint.settings;
  const sx = Math.abs(item.transform.scaleX || 1);
  const sy = Math.abs(item.transform.scaleY || 1);
  const toFrame = (point: { x: number; y: number }) => ({
    x: (point.x * WORKSPACE_PX_PER_MM) / sx,
    y: (point.y * WORKSPACE_PX_PER_MM) / sy,
  });
  const format = (value: number) => String(Math.round(value * 1000) / 1000);
  const paths: WorkspacePathData[] = [];
  for (const channel of dotPrintChannels(item, image)) {
    const tipInFrame =
      (dotPrintInkTip(settings, channel.ink) * WORKSPACE_PX_PER_MM) / Math.min(sx, sy);
    for (let start = 0; start < channel.dots.length; start += DOTS_PER_PATH) {
      const d = channel.dots
        .slice(start, start + DOTS_PER_PATH)
        .map((dot) => {
          // Dot shapes are built in mm, then mapped, so they keep their real size.
          const { points, closed } = dotStroke(dot.x, dot.y, settings.dotStyle, 1);
          return (
            points
              .map((point, index) => {
                const mapped = toFrame(point);
                return `${index === 0 ? 'M' : 'L'}${format(mapped.x)} ${format(mapped.y)}`;
              })
              .join('') + (closed ? 'Z' : '')
          );
        })
        .join('');
      paths.push({
        id: `${item.id}-${channel.ink}-${start / DOTS_PER_PATH}`,
        d,
        fill: 'none',
        stroke: channel.color,
        strokeWidth: format(tipInFrame),
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      });
    }
  }
  return paths;
}

export function defaultDotPrintSettings(pens: DotPrintSettings['pens']): DotPrintSettings {
  return { ...DEFAULT_DOT_PRINT, pens: { ...pens } };
}
