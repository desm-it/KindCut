import { buildProjectFile, type KindCutProjectFile, type WorkspaceTool } from '../../project-file';
import type { WorkspaceSvgItem } from '../../workspace-objects';
import type { Language } from '../../i18n';
import type { MeasurementUnit, CardSize } from '../../workspace-utils';
import { createWorkspaceObjectItem } from '../../utils/workspace-factory';
export interface ProjectDocumentState {
  language: Language;
  importedSvg: WorkspaceSvgItem | null;
  importedSvgs: WorkspaceSvgItem[];
  selectedSvgId: string | null;
  selectedMaterialId: number;
  selectedMatPreset: string;
  measurementUnit: MeasurementUnit;
  tools: WorkspaceTool[];
  paperColor: string;
  cardSize: CardSize | null;
  insertSlots: boolean;
}
export function projectDocumentSignature({
  language,
  importedSvg,
  importedSvgs,
  selectedSvgId,
  selectedMaterialId,
  selectedMatPreset,
  measurementUnit,
  tools,
  paperColor,
  cardSize,
  insertSlots,
}: ProjectDocumentState): string {
  return JSON.stringify({
    m: selectedMaterialId,
    mat: selectedMatPreset,
    unit: measurementUnit,
    tools,
    paper: paperColor,
    card: cardSize,
    slots: insertSlots,
    objects: importedSvgs.map((o) => ({
      id: o.id,
      type: o.type,
      kind: o.kind,
      shapeKind: o.shapeKind,
      fileName: o.fileName,
      paths: o.paths,
      frame: o.frame,
      transform: o.transform,
      textContent: o.textContent,
      cornerRadius: o.cornerRadius,
      penFill: o.penFill,
      spotify: o.spotify,
      dotPrint: o.dotPrint,
      dashed: o.dashed,
      outline: o.outline,
      hollow: o.hollow,
    })),
  });
}
export function createProjectDocument({
  language,
  importedSvg,
  importedSvgs,
  selectedSvgId,
  selectedMaterialId,
  selectedMatPreset,
  measurementUnit,
  tools,
  paperColor,
  cardSize,
  insertSlots,
}: ProjectDocumentState): KindCutProjectFile {
  return buildProjectFile({
    name: importedSvg?.fileName ?? (language === 'nl' ? 'Nieuw leeg ontwerp' : 'New blank design'),
    selectedMaterialId,
    selectedMatPreset,
    measurementUnit,
    tools,
    paperColor,
    cardSize,
    insertSlots,
    importedSvg: null,
    importedSvgs: [],
    workspaceObjects: importedSvgs.map((item) => ({
      id: item.id,
      type: item.type,
      kind: item.kind,
      sourceKind: item.sourceKind,
      shapeKind: item.shapeKind,
      fileName: item.fileName,
      fileSize: item.fileSize,
      frame: item.frame,
      paths: item.paths,
      transform: item.transform,
      textContent: item.textContent,
      cornerRadius: item.cornerRadius,
      penFill: item.penFill,
      spotify: item.spotify,
      dotPrint: item.dotPrint,
      dashed: item.dashed,
      outline: item.outline,
      hollow: item.hollow,
    })),
    selectedObjectId: selectedSvgId,
    selectedSvgId: null,
  });
}
export function restoreProjectObjects(projectFile: KindCutProjectFile, language: Language) {
  const restoredItems = projectFile.workspaceObjects.map((item, index) => {
    const base = createWorkspaceObjectItem({
      id: item.id ?? `svg-${index + 1}`,
      type: item.type,
      kind: item.kind ?? 'image',
      sourceKind: item.sourceKind ?? item.kind ?? 'image',
      shapeKind: item.shapeKind,
      fileName: item.fileName,
      fileSize: item.fileSize,
      frame: item.frame,
      paths: item.paths,
      language,
      index,
      transform: item.transform,
      cornerRadius: item.cornerRadius,
      penFill: item.penFill,
      spotify: item.spotify,
      dotPrint: item.dotPrint,
      dashed: item.dashed,
      outline: item.outline,
      hollow: item.hollow,
    });
    if (item.textContent) base.textContent = item.textContent;
    return base;
  });
  const restoredSelectedId =
    projectFile.selectedObjectId ?? projectFile.selectedSvgId ?? restoredItems[0]?.id ?? null;
  return { items: restoredItems, selectedId: restoredSelectedId };
}
