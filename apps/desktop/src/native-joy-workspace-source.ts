import type { NativeConfigurationSource } from './native-joy-configuration-types';
/** Keep only stroke tools actually used by the workspace SVG. No device work. */
export function nativeWorkspaceStrokeTools(
  svg: string,
  map: Record<string, string>,
): NativeConfigurationSource['strokeTools'] {
  const result: NativeConfigurationSource['strokeTools'] = {};
  for (const m of svg.matchAll(/\bstroke\s*=\s*["'](#[0-9a-fA-F]{3,8})["']/g)) {
    const color = m[1]!.toLowerCase();
    const tool = map[color.slice(1)];
    if (tool !== 'pen' && tool !== 'fine_point_blade')
      throw new Error('A workspace stroke has no supported tool mapping.');
    result[color] = { tool, operation: tool === 'pen' ? 'draw' : 'cut' };
  }
  if (!Object.keys(result).length)
    throw new Error('No explicit supported workspace stroke colors.');
  return result;
}
