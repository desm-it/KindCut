import { it, expect } from 'vitest';
import {
  createProjectDocument,
  projectDocumentSignature,
  restoreProjectObjects,
  type ProjectDocumentState,
} from './project-document';
import {
  DEFAULT_TOOLS,
  DEFAULT_PAPER_COLOR,
  serializeProjectFile,
  parseProjectFile,
} from '../../project-file';
import { createWorkspaceObjectItem } from '../../utils/workspace-factory';
function document(): ProjectDocumentState {
  const item = createWorkspaceObjectItem({
    id: 'fixture-shape',
    type: 'path',
    kind: 'shape',
    sourceKind: 'shape',
    fileName: 'Synthetic shape.svg',
    fileSize: '100 B',
    frame: { width: 30, height: 40 },
    paths: [
      { id: 'path-1', d: 'M 1 1 L 20 20', fill: 'none', stroke: '#111111', strokeWidth: '1' },
    ],
    language: 'en',
    index: 0,
  });
  return {
    language: 'en',
    importedSvg: item,
    importedSvgs: [item],
    selectedSvgId: item.id,
    selectedMaterialId: 218,
    selectedMatPreset: 'joy-small',
    measurementUnit: 'in',
    tools: DEFAULT_TOOLS,
    paperColor: DEFAULT_PAPER_COLOR,
    cardSize: null,
    insertSlots: false,
  };
}
it('selection changes are not document edits, while paths and material settings are', () => {
  const d = document(),
    signature = projectDocumentSignature(d);
  expect(projectDocumentSignature({ ...d, selectedSvgId: null })).toBe(signature);
  expect(projectDocumentSignature({ ...d, paperColor: '#aabbcc' })).not.toBe(signature);
  expect(projectDocumentSignature({ ...d, importedSvgs: [] })).not.toBe(signature);
});
it('saves and restores actual object geometry and selection through the existing file parser', () => {
  const d = document();
  const saved = createProjectDocument(d),
    parsed = parseProjectFile(serializeProjectFile(saved)),
    restored = restoreProjectObjects(parsed, 'en');
  expect(restored.items).toHaveLength(1);
  expect(restored.selectedId).toBe(d.selectedSvgId);
  expect(restored.items[0]!.paths).toEqual(d.importedSvgs[0]!.paths);
  expect(restored.items[0]!.transform).toEqual({
    ...d.importedSvgs[0]!.transform,
    mirrorX: false,
    mirrorY: false,
  });
  expect(parsed.workspace.selectedMaterialId).toBe(d.selectedMaterialId);
});
