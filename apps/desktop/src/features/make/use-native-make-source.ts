import { useCallback } from 'react';
import { buildNativeWorkspaceBundle } from '../../native-joy-workspace-bundle';
import type { NativeConfigurationSource } from '../../native-joy-configuration-types';
import { normalizeWorkspaceSvgForJoy } from '../../native-joy-workspace-normalize';
import { getBehindColor } from '../../project-file';
import type { WorkspaceObject } from '../../workspace-objects';
import type { CardSize } from '../../workspace-utils';
import type { WorkspaceTool } from '../../project-file';

type Input = {
  items: WorkspaceObject[];
  resolveItems: (items: WorkspaceObject[]) => Promise<WorkspaceObject[]>;
  matPreset: string;
  mat: { width: number; height: number };
  tools: WorkspaceTool[];
  materialId: number;
  cardSize: CardSize | null;
  insertSlots: boolean;
  colorMap: Record<string, string>;
  paperColor: string;
};

/** Native Make source and visual preview share geometry but have distinct invalidation needs. */
export function useNativeMakeSource(input: Input) {
  const {
    items,
    resolveItems,
    matPreset,
    mat,
    tools,
    materialId,
    cardSize,
    insertSlots,
    colorMap,
    paperColor,
  } = input;
  const getBundle = useCallback(async () => {
    const resolved = await resolveItems(items);
    return buildNativeWorkspaceBundle({
      items: resolved,
      matPreset,
      mat,
      tools,
      materialId,
      cardSize,
      insertSlots,
      behindColor: getBehindColor(tools),
      colorMap,
    });
  }, [items, resolveItems, matPreset, mat, tools, materialId, cardSize, insertSlots, colorMap]);

  const getWorkspaceSource = useCallback(
    async (): Promise<NativeConfigurationSource> => (await getBundle()).source,
    [getBundle],
  );
  const getConfigurationSource = useCallback(async (): Promise<NativeConfigurationSource> => {
    const source = await getWorkspaceSource();
    return {
      ...source,
      svg: normalizeWorkspaceSvgForJoy(source.svg, source.mat, source.strokeTools),
    };
  }, [getWorkspaceSource]);
  const getPreviewSource = useCallback(async () => {
    const bundle = await getBundle();
    return {
      ...bundle.source,
      previewOnly: true as const,
      matPreset,
      cardSize: materialId === 535 ? cardSize : null,
      insertSlots: materialId === 535 && insertSlots,
      visualSvg: bundle.visualSvg,
      paperColor,
      behindColor: getBehindColor(tools),
    };
  }, [getBundle, matPreset, materialId, cardSize, insertSlots, paperColor, tools]);

  return { getWorkspaceSource, getConfigurationSource, getPreviewSource };
}
