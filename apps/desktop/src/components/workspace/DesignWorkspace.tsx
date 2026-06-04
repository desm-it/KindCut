import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
import Moveable from "react-moveable";
import type {
  OnDrag,
  OnDragGroup,
  OnDragGroupStart,
  OnDragStart,
  OnRotate,
  OnRotateGroup,
  OnRotateGroupStart,
  OnRotateStart,
  OnScale,
  OnScaleGroup,
  OnScaleGroupStart,
  OnScaleStart,
} from "react-moveable";
import { APP_NAME } from "../../onboarding-copy";
import type { WorkspaceTool } from "../../project-file";
import type { WorkspaceSvgItem, WorkspaceTextContent } from "../../workspace-objects";
import {
  type Language,
  createTranslator,
  getMaterialName,
  getMatName,
} from "../../i18n";
import { MAT_PRESETS, MATERIAL_OPTIONS } from "@cricut-companion/slicebug-bridge";
import {
  MOVEABLE_CENTER_DIRECTION,
  ROTATION_SNAP_INTERVAL_DEGREES,
  ROTATION_SNAP_THRESHOLD_DEGREES,
  WORKSPACE_MAX_ZOOM,
  WORKSPACE_MIN_ZOOM,
  WORKSPACE_PIXELS_PER_INCH,
  WORKSPACE_STAGE_LEFT_OFFSET,
  WORKSPACE_STAGE_TOP_OFFSET,
  type MeasurementUnit,
  type Point,
  type WorkspaceItemTransform,
  clampWorkspaceItemTransform,
  getMatDimensionsInches,
  getMeasurementTicks,
  getViewportTransform,
  getWorkspaceItemTransform,
  getWorkspaceItemVisualSize,
  getWorkspaceSelectionBounds,
  localOffsetToWorld,
  rotateWorkspaceItemTransformAroundPoint,
  scaleWorkspaceItemTransformFromAnchor,
  snapScaleFactorToAspect,
} from "../../workspace-utils";
import type { WorkspaceShapeKind } from "../../workspace-shapes";
import type { AiSvgInput } from "../../ai-svg-generate";
import type { CutSessionSnapshot, LibraryImage, SlicebugPlanResult } from "../../app-types";
import { cssEscape, isEditableKeyboardTarget } from "../../utils/dom-utils";
import { Ruler } from "./Ruler";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { TextEditOverlay } from "./TextEditOverlay";
import { WorkspaceObjectArtwork } from "./WorkspaceObjectArtwork";
import { ImageLibraryPanel } from "../panels/ImageLibraryPanel";
import { ShapeLibraryPanel } from "../panels/ShapeLibraryPanel";
import { EmptyImportState } from "../screens/ImportPanel";

export function DesignWorkspace({
  language,
  measurementUnit,
  selectedMaterialId,
  selectedMatPreset,
  importedSvg,
  importedSvgs,
  selectedSvgId,
  selectedSvgIds,
  importedPlan: _importedPlan,
  importedPlanLoading,
  samplePlan: _samplePlan,
  samplePlanLoading: _samplePlanLoading,
  validationOk: _validationOk,
  importMessage,
  projectMessage,
  currentProjectPath: _currentProjectPath,
  projectSaving,
  projectOpening,
  cutSession: _cutSession,
  cutBusy,
  canPaste,
  onBackWelcome,
  onMaterialChange,
  onMatChange,
  tools,
  onToolsChange,
  onSvgFileChange,
  onAddShape,
  onAddText,
  editingTextId,
  onEnterTextEdit,
  onExitTextEdit,
  onTextContentChange,
  onSelectSvg,
  onSelectSvgGroup,
  onSelectAllSvgs,
  onCopySvgs,
  onPasteSvgs,
  onCutSvgs,
  onDeleteSvgs,
  onGroupSvgs,
  onUngroupSvg,
  onFlipX,
  onFlipY,
  onRenameObject,
  onChangeObjectColor,
  onUndoSvgs,
  onRedoSvgs,
  onWorkspaceContextMenu,
  onSvgTransformsCommit,
  onPrepareImportedPlan: _onPrepareImportedPlan,
  onOpenProject,
  onSaveProject,
  onGenerateSamplePlan: _onGenerateSamplePlan,
  onStartCut,
  onContinueCut: _onContinueCut,
  onStopCut: _onStopCut,
  hasActiveAiKey,
  onOpenSettings,
  onOpenAiGenerate,
  onAiGenerateSvg: _onAiGenerateSvg,
  imageLibrary,
  imageLibraryLoading,
  onLoadImageLibrary,
  onDeleteLibraryImage,
  onAddLibraryImageToWorkspace,
}: {
  language: Language;
  measurementUnit: MeasurementUnit;
  selectedMaterialId: number;
  selectedMatPreset: string;
  importedSvg: WorkspaceSvgItem | null;
  importedSvgs: WorkspaceSvgItem[];
  selectedSvgId: string | null;
  selectedSvgIds: string[];
  importedPlan: SlicebugPlanResult | null;
  importedPlanLoading: boolean;
  samplePlan: SlicebugPlanResult | null;
  samplePlanLoading: boolean;
  validationOk: boolean;
  importMessage: string | null;
  projectMessage: string | null;
  currentProjectPath: string | null;
  projectSaving: boolean;
  projectOpening: boolean;
  cutSession: CutSessionSnapshot | null;
  cutBusy: boolean;
  canPaste: boolean;
  onBackWelcome: () => void;
  onMaterialChange: (materialId: number) => void;
  onMatChange: (matPreset: string) => void;
  tools: WorkspaceTool[];
  onToolsChange: (tools: WorkspaceTool[]) => void;
  onSvgFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddShape: (shapeKind: WorkspaceShapeKind) => void;
  onSelectSvg: (id: string | null) => void;
  onSelectSvgGroup: (ids: string[]) => void;
  onSelectAllSvgs: () => void;
  onCopySvgs: () => boolean;
  onPasteSvgs: () => boolean;
  onCutSvgs: () => boolean;
  onDeleteSvgs: () => boolean;
  onGroupSvgs: () => boolean;
  onUngroupSvg: () => boolean;
  onFlipX: () => boolean;
  onFlipY: () => boolean;
  onRenameObject: (id: string, newName: string) => void;
  onChangeObjectColor: (id: string, color: string) => void;
  onUndoSvgs: () => boolean;
  onRedoSvgs: () => boolean;
  onWorkspaceContextMenu: (selectedObjectCount?: number) => void;
  onSvgTransformsCommit: (updates: Array<{ id: string; transform: WorkspaceItemTransform }>) => void;
  onPrepareImportedPlan: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onGenerateSamplePlan: () => void;
  onStartCut: () => void;
  onContinueCut: () => void;
  onStopCut: () => void;
  hasActiveAiKey: boolean;
  onOpenSettings: () => void;
  onOpenAiGenerate: () => void;
  onAiGenerateSvg: (input: Omit<AiSvgInput, "settings">) => Promise<string>;
  imageLibrary: LibraryImage[];
  imageLibraryLoading: boolean;
  onLoadImageLibrary: () => void;
  onDeleteLibraryImage: (path: string) => void;
  onAddLibraryImageToWorkspace: (img: LibraryImage) => void;
  onAddText: () => void;
  editingTextId: string | null;
  onEnterTextEdit: (id: string) => void;
  onExitTextEdit: (id: string) => void;
  onTextContentChange: (id: string, patch: Partial<WorkspaceTextContent>) => void;
}) {
  const { t } = createTranslator(language);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState<Point>({ x: 260, y: 90 });
  const [shapeDrawerOpen, setShapeDrawerOpen] = useState(false);
  const [imageDrawerOpen, setImageDrawerOpen] = useState(false);
  const drawerOpen = imageDrawerOpen || shapeDrawerOpen;

  function openImageDrawer() {
    setImageDrawerOpen(true);
    setShapeDrawerOpen(false);
    onLoadImageLibrary();
  }
  function openShapeDrawer() {
    setShapeDrawerOpen(true);
    setImageDrawerOpen(false);
  }
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const pendingRenameRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const workpieceTransformRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<null | { pointerId: number; pointer: Point; pan: Point }>(null);
  const recentScrollRef = useRef(false);
  const recentScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directItemDragStart = useRef<null | {
    pointerId: number;
    id: string;
    pointer: Point;
    transform: WorkspaceItemTransform;
    moved: boolean;
  }>(null);
  const moveableTransformStart = useRef(new Map<string, WorkspaceItemTransform>());
  const moveableGroupCenterStart = useRef<Point | null>(null);
  const latestMoveableTransforms = useRef(new Map<string, WorkspaceItemTransform>());
  const moveableRef = useRef<Moveable | null>(null);
  const [moveableTargets, setMoveableTargets] = useState<HTMLElement[]>([]);
  const [isDirectItemDragging, setIsDirectItemDragging] = useState(false);
  const matDimensions = getMatDimensionsInches(selectedMatPreset);
  const materialName =
    getMaterialName(selectedMaterialId, language) ??
    MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.name ??
    "Material";
  const matName = getMatName(selectedMatPreset, language) ?? MAT_PRESETS.find((mat) => mat.id === selectedMatPreset)?.name ?? "Mat";
  const workpieceWidth = matDimensions.width * WORKSPACE_PIXELS_PER_INCH;
  const workpieceHeight = matDimensions.height * WORKSPACE_PIXELS_PER_INCH;
  const xTicks = getMeasurementTicks({
    axis: "x",
    lengthInches: matDimensions.width,
    unit: measurementUnit,
    zoom,
    pan,
    pixelsPerInch: WORKSPACE_PIXELS_PER_INCH,
  });
  const yTicks = getMeasurementTicks({
    axis: "y",
    lengthInches: matDimensions.height,
    unit: measurementUnit,
    zoom,
    pan,
    pixelsPerInch: WORKSPACE_PIXELS_PER_INCH,
  });
  const canCut = importedSvgs.length > 0 && !importedPlanLoading && !cutBusy;
  const selectedSvgIdSet = useMemo(() => new Set(selectedSvgIds), [selectedSvgIds]);
  const lastPointerDownItemId = useRef<{ id: string; time: number } | null>(null);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  useEffect(() => {
    void window.cricutCompanion?.system?.getFonts().then((fonts) => {
      if (fonts && fonts.length > 0) setSystemFonts(fonts.sort());
    });
  }, []);
  const selectedItems = useMemo(() => importedSvgs.filter((item) => selectedSvgIdSet.has(item.id)), [importedSvgs, selectedSvgIdSet]);
  const selectedGroup = selectedItems.length === 1 && selectedItems[0]?.type === "group" ? selectedItems[0] : null;

  useEffect(() => {
    const root = workpieceTransformRef.current;
    if (!root || selectedItems.length === 0) {
      setMoveableTargets([]);
      return;
    }
    setMoveableTargets(
      selectedItems
        .map((item) => root.querySelector<HTMLElement>(`[data-workspace-item-id="${cssEscape(item.id)}"]`))
        .filter((target): target is HTMLElement => Boolean(target)),
    );
  }, [selectedItems]);

  useEffect(() => {
    requestAnimationFrame(() => { moveableRef.current?.updateRect(); });
  }, [importedSvgs]);

  useEffect(() => {
    if (pendingRenameRef.current) {
      clearTimeout(pendingRenameRef.current.timer);
      pendingRenameRef.current = null;
    }
  }, [selectedSvgIds]);

  function clampZoom(nextZoom: number) {
    return Math.min(WORKSPACE_MAX_ZOOM, Math.max(WORKSPACE_MIN_ZOOM, nextZoom));
  }

  function resetZoomToActualSize() {
    const rect = viewportRef.current?.getBoundingClientRect();
    const viewportWidth = rect?.width ?? workpieceWidth + WORKSPACE_STAGE_LEFT_OFFSET * 2;
    const viewportHeight = rect?.height ?? workpieceHeight + WORKSPACE_STAGE_TOP_OFFSET * 2;
    setZoom(1);
    setPan({
      x: (viewportWidth - workpieceWidth) / 2 - WORKSPACE_STAGE_LEFT_OFFSET,
      y: (viewportHeight - workpieceHeight) / 2 - WORKSPACE_STAGE_TOP_OFFSET,
    });
  }

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const sensitivity = event.deltaMode === 0 ? 0.01 : 0.005;
      const nextZoom = clampZoom(zoom - event.deltaY * sensitivity);
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const worldX = (cx - pan.x) / zoom;
      const worldY = (cy - pan.y) / zoom;
      setZoom(nextZoom);
      setPan({ x: cx - worldX * nextZoom, y: cy - worldY * nextZoom });
      return;
    }
    recentScrollRef.current = true;
    if (recentScrollTimerRef.current) clearTimeout(recentScrollTimerRef.current);
    recentScrollTimerRef.current = setTimeout(() => { recentScrollRef.current = false; }, 300);
    setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".moveable-control-box")) {
      return;
    }
    if (selectedSvgId && !target.closest(".workspace-image-item")) {
      onSelectSvg(null);
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerId: event.pointerId, pointer: { x: event.clientX, y: event.clientY }, pan };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - dragStart.current.pointer.x;
    const deltaY = event.clientY - dragStart.current.pointer.y;
    setPan({ x: dragStart.current.pan.x + deltaX, y: dragStart.current.pan.y + deltaY });
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current?.pointerId === event.pointerId) {
      dragStart.current = null;
    }
  }

  function handleItemPointerDown(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    // Double-click detection → enter text edit mode
    if (item.textContent) {
      const now = Date.now();
      const last = lastPointerDownItemId.current;
      if (last && last.id === item.id && now - last.time < 400) {
        lastPointerDownItemId.current = null;
        onEnterTextEdit(item.id);
        return;
      }
      lastPointerDownItemId.current = { id: item.id, time: now };
    }

    if ((event.metaKey || event.ctrlKey || event.shiftKey) && selectedSvgIdSet.has(item.id) && selectedItems.length > 1) {
      onSelectSvgGroup(selectedSvgIds.filter((id) => id !== item.id));
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      onSelectSvgGroup([...selectedSvgIds, item.id]);
      return;
    }
    if (!selectedSvgIdSet.has(item.id) || selectedItems.length <= 1) {
      onSelectSvg(item.id);
    }
    if (!selectedSvgIdSet.has(item.id)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      directItemDragStart.current = {
        pointerId: event.pointerId,
        id: item.id,
        pointer: { x: event.clientX, y: event.clientY },
        transform: item.transform,
        moved: false,
      };
      setIsDirectItemDragging(true);
    }
  }

  function handleItemPointerMove(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    const drag = directItemDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== item.id) {
      return;
    }
    const deltaX = (event.clientX - drag.pointer.x) / zoom;
    const deltaY = (event.clientY - drag.pointer.y) / zoom;
    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      drag.moved = true;
    }
    const next = clampWorkspaceItemTransform({
      ...drag.transform,
      x: drag.transform.x + deltaX,
      y: drag.transform.y + deltaY,
    });
    event.currentTarget.style.transform = getWorkspaceItemTransform(next);
  }

  function stopDirectItemDrag(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    const drag = directItemDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== item.id) {
      return;
    }
    directItemDragStart.current = null;
    setIsDirectItemDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const deltaX = (event.clientX - drag.pointer.x) / zoom;
    const deltaY = (event.clientY - drag.pointer.y) / zoom;
    const next = clampWorkspaceItemTransform({
      ...drag.transform,
      x: drag.transform.x + deltaX,
      y: drag.transform.y + deltaY,
    });
    event.currentTarget.style.transform = getWorkspaceItemTransform(next);
    if (drag.moved) {
      onSvgTransformsCommit([{ id: item.id, transform: next }]);
    }
  }

  function handleItemContextMenu(event: MouseEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    event.stopPropagation();
    if (!selectedSvgIdSet.has(item.id)) {
      onSelectSvg(item.id);
    }
    onWorkspaceContextMenu(selectedSvgIdSet.has(item.id) ? selectedSvgIds.length : 1);
  }

  function beginMoveableTransform(targets: Array<HTMLElement | SVGElement>) {
    const startEntries = targets.flatMap((target) => {
      const item = getWorkspaceItemFromTarget(target);
      return item ? [[item.id, item.transform] as const] : [];
    });
    moveableTransformStart.current = new Map(startEntries);
    latestMoveableTransforms.current = new Map(moveableTransformStart.current);
    const startItems = startEntries.flatMap(([id, transform]) => {
      const item = importedSvgs.find((candidate) => candidate.id === id);
      return item ? [{ frame: item.frame, transform }] : [];
    });
    moveableGroupCenterStart.current = getWorkspaceSelectionBounds(startItems)?.center ?? null;
  }

  function handleMoveableDragStart(event: OnDragStart) {
    beginMoveableTransform([event.target]);
    const item = getWorkspaceItemFromTarget(event.target);
    if (item) {
      event.set([item.transform.x, item.transform.y]);
    }
  }

  function handleMoveableDragGroupStart(event: OnDragGroupStart) {
    beginMoveableTransform(event.targets);
    event.events.forEach((childEvent) => {
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set([item.transform.x, item.transform.y]);
      }
    });
  }

  function handleMoveableDrag(event: OnDrag) {
    updateMoveableTargetTransform(event.target, { x: event.beforeTranslate[0], y: event.beforeTranslate[1] });
  }

  function handleMoveableDragGroup(event: OnDragGroup) {
    event.events.forEach(handleMoveableDrag);
  }

  function handleMoveableScaleStart(event: OnScaleStart) {
    beginMoveableTransform([event.target]);
    const item = getWorkspaceItemFromTarget(event.target);
    if (item) {
      event.set([item.transform.scaleX, item.transform.scaleY]);
      event.setTransform(getWorkspaceItemTransform(item.transform));
      if (isCornerScaleDirection(event.direction)) {
        event.setRatio(item.frame.width / item.frame.height);
      }
      event.setFixedDirection(getScaleFixedDirection(event.direction, isCenterScaleModifier(event.inputEvent)));
    }
  }

  function handleMoveableScaleGroupStart(event: OnScaleGroupStart) {
    beginMoveableTransform(event.targets);
    if (isCornerScaleDirection(event.direction)) {
      const bounds = getWorkspaceSelectionBounds(selectedItems);
      if (bounds?.height) {
        event.setRatio(bounds.width / bounds.height);
      }
    }
    event.setFixedDirection(getScaleFixedDirection(event.direction, isCenterScaleModifier(event.inputEvent)));
    event.events.forEach((childEvent) => {
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set([item.transform.scaleX, item.transform.scaleY]);
        childEvent.setTransform(getWorkspaceItemTransform(item.transform));
        if (isCornerScaleDirection(childEvent.direction)) {
          childEvent.setRatio(item.frame.width / item.frame.height);
        }
        childEvent.setFixedDirection(getScaleFixedDirection(childEvent.direction, isCenterScaleModifier(childEvent.inputEvent)));
      }
    });
  }

  function handleMoveableScale(event: OnScale) {
    updateMoveableTargetScale(
      event.target,
      event.scale[0] ?? 1,
      event.scale[1] ?? 1,
      event.direction,
      isCenterScaleModifier(event.inputEvent),
      null,
    );
  }

  function handleMoveableScaleGroup(event: OnScaleGroup) {
    const groupBounds = getMoveableStartBounds();
    event.events.forEach((childEvent) => {
      updateMoveableTargetScale(
        childEvent.target,
        childEvent.scale[0] ?? 1,
        childEvent.scale[1] ?? 1,
        childEvent.direction,
        isCenterScaleModifier(childEvent.inputEvent),
        groupBounds,
      );
    });
  }

  function handleMoveableRotateStart(event: OnRotateStart) {
    beginMoveableTransform([event.target]);
    setMoveableRotationCenter(event);
    const item = getWorkspaceItemFromTarget(event.target);
    if (item) {
      event.set(item.transform.rotation);
      event.setTransform(getWorkspaceItemTransform(item.transform));
    }
  }

  function handleMoveableRotateGroupStart(event: OnRotateGroupStart) {
    beginMoveableTransform(event.targets);
    setMoveableRotationCenter(event);
    event.events.forEach((childEvent) => {
      setMoveableRotationCenter(childEvent);
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set(item.transform.rotation);
        childEvent.setTransform(getWorkspaceItemTransform(item.transform));
      }
    });
  }

  function handleMoveableRotate(event: OnRotate) {
    updateMoveableTargetRotation(event.target, event.rotation, isPreciseRotationModifier(event.inputEvent), null);
  }

  function handleMoveableRotateGroup(event: OnRotateGroup) {
    const groupCenter = moveableGroupCenterStart.current;
    event.events.forEach((childEvent) => {
      updateMoveableTargetRotation(
        childEvent.target,
        childEvent.rotation,
        isPreciseRotationModifier(childEvent.inputEvent),
        groupCenter,
      );
    });
  }

  function updateMoveableTargetTransform(
    target: HTMLElement | SVGElement,
    transformPart: Partial<WorkspaceItemTransform>,
  ) {
    const item = getWorkspaceItemFromTarget(target);
    if (!item) {
      return;
    }
    const start = moveableTransformStart.current.get(item.id) ?? item.transform;
    // Live frame → clamp (sub-pixel), not normalize (0.01 quantised) so the element
    // tracks Moveable's control box exactly. Commit re-rounds via handleSvgTransformsCommit.
    applyMoveableTargetTransform(target, item.id, clampWorkspaceItemTransform({ ...start, ...transformPart }));
  }

  function updateMoveableTargetScale(
    target: HTMLElement | SVGElement,
    absoluteScaleX: number,
    absoluteScaleY: number,
    direction: number[],
    fromCenter: boolean,
    groupBounds: ReturnType<typeof getMoveableStartBounds>,
  ) {
    const item = getWorkspaceItemFromTarget(target);
    if (!item) {
      return;
    }
    const start = moveableTransformStart.current.get(item.id) ?? item.transform;
    let scaleFactorX = absoluteScaleX / Math.max(0.001, start.scaleX);
    let scaleFactorY = absoluteScaleY / Math.max(0.001, start.scaleY);
    if (isCornerScaleDirection(direction)) {
      const uniformScale = Math.max(scaleFactorX, scaleFactorY);
      scaleFactorX = uniformScale;
      scaleFactorY = uniformScale;
    } else if (direction[0] === 0) {
      scaleFactorX = 1;
    } else if (direction[1] === 0) {
      scaleFactorY = 1;
    }
    // Single item + single-axis resize: snap to the item's natural proportions when
    // the dragged dimension passes near them. (Groups keep their relative layout, so
    // per-item aspect snapping would break them — skip when groupBounds is set.)
    if (!groupBounds && !isCornerScaleDirection(direction)) {
      const snapped = snapScaleFactorToAspect({
        axis: direction[1] === 0 ? "x" : "y",
        startScaleX: start.scaleX,
        startScaleY: start.scaleY,
        scaleFactorX,
        scaleFactorY,
        frame: item.frame,
        zoom,
      });
      scaleFactorX = snapped.scaleFactorX;
      scaleFactorY = snapped.scaleFactorY;
    }
    const anchor = groupBounds
      ? getScaleAnchorForBounds(groupBounds, direction, fromCenter)
      : getScaleAnchorForItem(start, item.frame, direction, fromCenter);
    const next = scaleWorkspaceItemTransformFromAnchor(start, item.frame, anchor, scaleFactorX, scaleFactorY);
    applyMoveableTargetTransform(target, item.id, next);
  }

  function updateMoveableTargetRotation(
    target: HTMLElement | SVGElement,
    absoluteRotation: number,
    preciseRotation: boolean,
    groupCenter: Point | null,
  ) {
    const item = getWorkspaceItemFromTarget(target);
    if (!item) {
      return;
    }
    const start = moveableTransformStart.current.get(item.id) ?? item.transform;
    const anchor = groupCenter ?? getWorkspaceItemCenterPoint(start, item.frame);
    const rotationDelta = groupCenter
      ? getSnappedRotation(absoluteRotation - start.rotation, preciseRotation)
      : getSnappedRotation(absoluteRotation, preciseRotation) - start.rotation;
    const next = rotateWorkspaceItemTransformAroundPoint(start, item.frame, anchor, rotationDelta);
    applyMoveableTargetTransform(target, item.id, next);
  }

  function applyMoveableTargetTransform(target: HTMLElement | SVGElement, id: string, transform: WorkspaceItemTransform) {
    latestMoveableTransforms.current.set(id, transform);
    if (target instanceof HTMLElement) {
      target.style.transform = getWorkspaceItemTransform(transform);
      const frame = importedSvgs.find((item) => item.id === id)?.frame;
      if (frame) {
        const size = getWorkspaceItemVisualSize(frame, transform);
        target.style.width = `${size.width}px`;
        target.style.height = `${size.height}px`;
      }
    }
  }

  function commitMoveableTransforms() {
    const updates = Array.from(latestMoveableTransforms.current, ([id, transform]) => ({ id, transform }));
    moveableTransformStart.current = new Map();
    moveableGroupCenterStart.current = null;
    latestMoveableTransforms.current = new Map();
    onSvgTransformsCommit(updates);
  }

  function getWorkspaceItemFromTarget(target: HTMLElement | SVGElement): WorkspaceSvgItem | null {
    const id = target instanceof HTMLElement ? target.dataset.workspaceItemId : undefined;
    return id ? importedSvgs.find((item) => item.id === id) ?? null : null;
  }

  function getWorkspaceItemCenterPoint(transform: WorkspaceItemTransform, frame: { width: number; height: number }): Point {
    const centerOffset = localOffsetToWorld(
      { x: (frame.width * transform.scaleX) / 2, y: (frame.height * transform.scaleY) / 2 },
      transform,
    );
    return { x: transform.x + centerOffset.x, y: transform.y + centerOffset.y };
  }

  function getMoveableStartBounds() {
    const startItems = Array.from(moveableTransformStart.current, ([id, transform]) => {
      const item = importedSvgs.find((candidate) => candidate.id === id);
      return item ? { frame: item.frame, transform } : null;
    }).filter((item): item is { frame: { width: number; height: number }; transform: WorkspaceItemTransform } => Boolean(item));
    return getWorkspaceSelectionBounds(startItems);
  }

  function getScaleAnchorForItem(
    transform: WorkspaceItemTransform,
    frame: { width: number; height: number },
    direction: number[],
    fromCenter: boolean,
  ): Point {
    if (fromCenter) {
      return getWorkspaceItemCenterPoint(transform, frame);
    }
    const width = frame.width * transform.scaleX;
    const height = frame.height * transform.scaleY;
    const localAnchor = {
      x: direction[0] === -1 ? width : direction[0] === 1 ? 0 : width / 2,
      y: direction[1] === -1 ? height : direction[1] === 1 ? 0 : height / 2,
    };
    // Mirror-aware: when the item is flipped, the fixed local edge maps to the
    // opposite world side, so scaling a mirrored item keeps the correct edge pinned.
    const worldAnchor = localOffsetToWorld(localAnchor, transform);
    return { x: transform.x + worldAnchor.x, y: transform.y + worldAnchor.y };
  }

  function getScaleAnchorForBounds(
    bounds: NonNullable<ReturnType<typeof getWorkspaceSelectionBounds>>,
    direction: number[],
    fromCenter: boolean,
  ): Point {
    if (fromCenter) {
      return bounds.center;
    }
    return {
      x: direction[0] === -1 ? bounds.right : direction[0] === 1 ? bounds.left : bounds.center.x,
      y: direction[1] === -1 ? bounds.bottom : direction[1] === 1 ? bounds.top : bounds.center.y,
    };
  }

  function getScaleFixedDirection(direction: number[], fromCenter: boolean): number[] {
    return fromCenter ? [0, 0] : [-(direction[0] ?? 0), -(direction[1] ?? 0)];
  }

  function isCornerScaleDirection(direction: number[]): boolean {
    return (direction[0] ?? 0) !== 0 && (direction[1] ?? 0) !== 0;
  }

  function isCenterScaleModifier(inputEvent: { altKey?: boolean } | null | undefined): boolean {
    return Boolean(inputEvent?.altKey);
  }

  function isPreciseRotationModifier(inputEvent: { altKey?: boolean } | null | undefined): boolean {
    return Boolean(inputEvent?.altKey);
  }

  function setMoveableRotationCenter(event: OnRotateStart) {
    event.setFixedDirection([...MOVEABLE_CENTER_DIRECTION]);
  }

  function getSnappedRotation(rotation: number, preciseRotation: boolean): number {
    if (preciseRotation) {
      return rotation;
    }
    const snapped = Math.round(rotation / ROTATION_SNAP_INTERVAL_DEGREES) * ROTATION_SNAP_INTERVAL_DEGREES;
    return Math.abs(rotation - snapped) <= ROTATION_SNAP_THRESHOLD_DEGREES ? snapped : rotation;
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const usesModifier = event.metaKey || event.ctrlKey;
      if (usesModifier && event.key.toLowerCase() === "z") {
        const handled = event.shiftKey ? onRedoSvgs() : onUndoSvgs();
        if (handled) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "y") {
        if (onRedoSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        onSelectAllSvgs();
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "c") {
        if (onCopySvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "v") {
        if (onPasteSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === "x") {
        if (onCutSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (onDeleteSvgs()) {
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCopySvgs, onCutSvgs, onDeleteSvgs, onPasteSvgs, onRedoSvgs, onSelectAllSvgs, onUndoSvgs]);

  return (
    <main className="app-shell design-shell">
      <div className="native-window-drag-zone app-drag" aria-hidden="true" />
      <header className="design-topbar">
        <div className="design-brand">
          <button
            className="workspace-home-button no-drag"
            type="button"
            onClick={onBackWelcome}
            aria-label={language === "nl" ? "Terug naar projectstart" : "Back to project start"}
            title={language === "nl" ? "Projectstart" : "Project start"}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5 10 3l7 6.5"/><path d="M5 8v8a1 1 0 0 0 1 1h3v-4h2v4h3a1 1 0 0 0 1-1V8"/></svg>
          </button>
          <div>
            <p className="eyebrow">{language === "nl" ? "Werkruimte" : "Workspace"}</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <WorkspaceToolbar
          language={language}
          canCopy={selectedSvgIds.length > 0}
          canCut={selectedSvgIds.length > 0}
          canPaste={canPaste}
          canDelete={selectedSvgIds.length > 0}
          canGroup={selectedSvgIds.length >= 2}
          canUngroup={selectedGroup !== null}
          canFlip={selectedSvgIds.length > 0}
          projectSaving={projectSaving}
          projectOpening={projectOpening}
          onOpen={onOpenProject}
          onSave={onSaveProject}
          onCopy={onCopySvgs}
          onCut={onCutSvgs}
          onPaste={onPasteSvgs}
          onDelete={onDeleteSvgs}
          onGroup={onGroupSvgs}
          onUngroup={onUngroupSvg}
          onFlipX={onFlipX}
          onFlipY={onFlipY}
        />

        <div className="design-topbar__controls no-drag">
          <button
            className="workspace-home-button no-drag"
            type="button"
            onClick={onOpenSettings}
            aria-label={language === "nl" ? "Instellingen" : "Settings"}
            title={language === "nl" ? "Instellingen" : "Settings"}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="2.5"/>
              <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.22 4.22l1.06 1.06M14.72 14.72l1.06 1.06M4.22 15.78l1.06-1.06M14.72 5.28l1.06-1.06"/>
            </svg>
          </button>
          <button className="cut-button" type="button" disabled={!canCut} onClick={onStartCut}>
            <span aria-hidden="true">▶</span>
            {cutBusy ? t("buttons.starting") : t("buttons.startCut")}
          </button>
        </div>
      </header>

      <section
        className={drawerOpen ? "design-frame design-frame--shape-drawer" : "design-frame"}
        aria-label={language === "nl" ? "Ontwerpwerkruimte" : "Design workspace"}
      >
        <aside className="tool-rail no-drag" aria-label={language === "nl" ? "Gereedschappen" : "Tools"}>
          <button
            className={imageDrawerOpen ? "tool-button tool-button--active" : "tool-button"}
            type="button"
            onClick={() => { imageDrawerOpen ? setImageDrawerOpen(false) : openImageDrawer(); }}
            aria-expanded={imageDrawerOpen}
          >
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="16" height="16" rx="2.5"/><path d="M3 14.5 7.5 10l3.5 3.5 2.5-2.5 5.5 5.5"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>
            {language === "nl" ? "Beeld" : "Image"}
          </button>
          <button className="tool-button" type="button" onClick={onAddText}>
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 5h10M11 5v12M8 17h6"/></svg>
            {language === "nl" ? "Tekst" : "Text"}
          </button>
          <button
            className={shapeDrawerOpen ? "tool-button tool-button--active" : "tool-button"}
            type="button"
            onClick={() => { shapeDrawerOpen ? setShapeDrawerOpen(false) : openShapeDrawer(); }}
            aria-expanded={shapeDrawerOpen}
            aria-controls="shape-library-panel"
          >
            <svg aria-hidden="true" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="11" width="9" height="9" rx="1.5"/><circle cx="15.5" cy="6.5" r="4.5"/></svg>
            {language === "nl" ? "Vormen" : "Shapes"}
          </button>
        </aside>

        {imageDrawerOpen ? (
          <ImageLibraryPanel
            language={language}
            hasActiveAiKey={hasActiveAiKey}
            images={imageLibrary}
            loading={imageLibraryLoading}
            onAskAi={() => { onOpenAiGenerate(); }}
            onFileImport={onSvgFileChange}
            onUseImage={(img) => { onAddLibraryImageToWorkspace(img); setImageDrawerOpen(false); }}
            onDeleteImage={onDeleteLibraryImage}
          />
        ) : null}

        {shapeDrawerOpen ? (
          <ShapeLibraryPanel
            language={language}
            onAddShape={(shapeKind) => {
              onAddShape(shapeKind);
              setShapeDrawerOpen(false);
            }}
          />
        ) : null}

        <section className="workspace-stage no-drag">
          <div className="stage-statusbar">
            <strong>{matName}</strong>
            <span>{materialName}</span>
            <span>{matDimensions.width} × {matDimensions.height} in</span>
          </div>
          <div className="ruler-corner">0</div>
          <Ruler axis="x" ticks={xTicks} unit={measurementUnit} />
          <Ruler axis="y" ticks={yTicks} unit={measurementUnit} />
          <div
            ref={viewportRef}
            className="viewport"
            onWheel={handleViewportWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onContextMenu={(e) => { if (recentScrollRef.current) { e.preventDefault(); return; } onWorkspaceContextMenu(); }}
          >
            <div className="infinite-grid" />
            <div
              ref={workpieceTransformRef}
              className="workpiece-transform"
              style={{ transform: getViewportTransform({ zoom, pan }) }}
            >
              <div
                className="workpiece-paper"
                style={{
                  width: workpieceWidth,
                  height: workpieceHeight,
                  backgroundImage: "linear-gradient(rgba(127,96,66,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(127,96,66,0.08) 1px,transparent 1px)",
                  ...(() => {
                    const gridPx = measurementUnit === "in"
                      ? WORKSPACE_PIXELS_PER_INCH * 0.25
                      : measurementUnit === "cm"
                        ? WORKSPACE_PIXELS_PER_INCH * 0.5 / 2.54
                        : WORKSPACE_PIXELS_PER_INCH * 5 / 25.4;
                    return { backgroundSize: `${gridPx}px ${gridPx}px`, backgroundPosition: "-1px -1px" };
                  })(),
                }}
              >
                {importedSvgs.length === 0 ? (
                  <div className="empty-workpiece">
                    <strong>{language === "nl" ? "Leeg project" : "Blank project"}</strong>
                    <span>{language === "nl" ? "Kies een vorm of voeg een eigen ontwerp toe." : "Choose a shape or add your own design."}</span>
                  </div>
                ) : null}
              </div>
              <div
                className="workspace-image-layer"
                style={{ width: workpieceWidth, height: workpieceHeight }}
                aria-label={language === "nl" ? "Afbeeldingslaag" : "Image layer"}
              >
                {importedSvgs.length > 0
                  ? (
                  importedSvgs.map((item) => (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      data-workspace-item-id={item.id}
                      className={`workspace-image-item${selectedSvgIdSet.has(item.id) ? " workspace-image-item--selected" : ""}${item.id === selectedSvgId ? " workspace-image-item--primary-selected" : ""}${editingTextId === item.id ? " workspace-image-item--text-editing" : ""}`}
                      style={{
                        width: getWorkspaceItemVisualSize(item.frame, item.transform).width,
                        height: getWorkspaceItemVisualSize(item.frame, item.transform).height,
                        transform: getWorkspaceItemTransform(item.transform),
                      }}
                      aria-label={
                        language === "nl"
                          ? `${item.fileName} kiezen en verplaatsen`
                          : `Select and move ${item.fileName}`
                      }
                      onPointerDown={(event) => handleItemPointerDown(event, item)}
                      onPointerMove={(event) => handleItemPointerMove(event, item)}
                      onPointerUp={(event) => stopDirectItemDrag(event, item)}
                      onPointerCancel={(event) => stopDirectItemDrag(event, item)}
                      onContextMenu={(event) => handleItemContextMenu(event, item)}
                    >
                      {editingTextId === item.id && item.textContent ? (
                        <TextEditOverlay
                          item={item}
                          onCommit={(text) => {
                            onTextContentChange(item.id, { text });
                            onExitTextEdit(item.id);
                          }}
                          onCancel={() => onExitTextEdit(item.id)}
                        />
                      ) : (
                        <WorkspaceObjectArtwork item={item} tools={tools} />
                      )}
                    </div>
                  ))
                    )
                  : null}
                {moveableTargets.length > 0 && !isDirectItemDragging ? (
                  <Moveable
                    ref={moveableRef}
                    target={moveableTargets.length === 1 ? moveableTargets[0] : moveableTargets}
                    draggable
                    scalable
                    rotatable
                    groupable={moveableTargets.length > 1}
                    origin={false}
                    keepRatio={false}
                    throttleDrag={0}
                    throttleScale={0}
                    throttleRotate={0}
                    zoom={1 / Math.max(0.01, zoom)}
                    renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
                    onDragStart={handleMoveableDragStart}
                    onDrag={handleMoveableDrag}
                    onDragEnd={commitMoveableTransforms}
                    onDragGroupStart={handleMoveableDragGroupStart}
                    onDragGroup={handleMoveableDragGroup}
                    onDragGroupEnd={commitMoveableTransforms}
                    onScaleStart={handleMoveableScaleStart}
                    onScale={handleMoveableScale}
                    onScaleEnd={commitMoveableTransforms}
                    onScaleGroupStart={handleMoveableScaleGroupStart}
                    onScaleGroup={handleMoveableScaleGroup}
                    onScaleGroupEnd={commitMoveableTransforms}
                    onRotateStart={handleMoveableRotateStart}
                    onRotate={handleMoveableRotate}
                    onRotateEnd={commitMoveableTransforms}
                    onRotateGroupStart={handleMoveableRotateGroupStart}
                    onRotateGroup={handleMoveableRotateGroup}
                    onRotateGroupEnd={commitMoveableTransforms}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div className="zoom-controls no-drag" aria-label={language === "nl" ? "Zoom" : "Zoom"}>
            <button type="button" onClick={() => setZoom((current) => clampZoom(current - 0.1))}>−</button>
            <button type="button" onClick={resetZoomToActualSize}>{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom((current) => clampZoom(current + 0.1))}>＋</button>
          </div>
        </section>

        <aside className="project-drawer no-drag">
          {projectMessage ? <p className="ok project-message">{projectMessage}</p> : null}
          {importMessage ? <p className="warn">{importMessage}</p> : null}

          <div className="drawer-section">
            {(() => {
              const nl = language === "nl";
              const sel = selectedSvgId ? importedSvgs.find((x) => x.id === selectedSvgId) ?? null : null;

              if (!sel) return (
                <>
                  <p className="drawer-section__title">{nl ? "Werkstuk" : "Workpiece"}</p>
                  <div className="object-settings">
                    <div className="object-settings__row object-settings__row--first">
                      <label className="object-settings__label" htmlFor="wp-material">{nl ? "Materiaal" : "Material"}</label>
                      <select id="wp-material" className="object-settings__select" value={selectedMaterialId} onChange={(e) => onMaterialChange(Number(e.target.value))}>
                        {MATERIAL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{getMaterialName(m.id, language) ?? m.name}</option>)}
                      </select>
                    </div>
                    <div className="object-settings__row">
                      <label className="object-settings__label" htmlFor="wp-mat">{nl ? "Mat" : "Mat"}</label>
                      <select id="wp-mat" className="object-settings__select" value={selectedMatPreset} onChange={(e) => onMatChange(e.target.value)}>
                        {MAT_PRESETS.map((m) => <option key={m.id} value={m.id}>{getMatName(m.id, language) ?? m.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <p className="drawer-section__title" style={{ marginTop: 16 }}>{nl ? "Gereedschappen" : "Tools"}</p>
                  <div className="tool-list">
                    {tools.map((tool, idx) => {
                      const dupColor = tools.some((t, i) => i !== idx && t.color.toLowerCase() === tool.color.toLowerCase());
                      return (
                        <div key={tool.id} className="tool-list__item">
                          <input
                            type="color"
                            className="tool-list__color"
                            value={tool.color}
                            onChange={(e) => {
                              const newColor = e.target.value;
                              onToolsChange(tools.map((t) => t.id === tool.id ? { ...t, color: newColor } : t));
                              onChangeObjectColor !== undefined && importedSvgs.forEach((obj) => {
                                if (obj.paths.some((p) => p.stroke.toLowerCase() === tool.color.toLowerCase())) {
                                  onChangeObjectColor(obj.id, newColor);
                                }
                              });
                            }}
                            title={nl ? "Verander kleur" : "Change color"}
                          />
                          <select
                            className="tool-list__type"
                            value={tool.type}
                            onChange={(e) => onToolsChange(tools.map((t) => t.id === tool.id ? { ...t, type: e.target.value as "pen" | "cut" } : t))}
                          >
                            <option value="pen">{nl ? "Pen" : "Pen"}</option>
                            <option value="cut">{nl ? "Snijden" : "Cut"}</option>
                          </select>
                          {dupColor && <span className="tool-list__warn" title={nl ? "Dubbele kleur" : "Duplicate color"}>⚠</span>}
                          <button
                            type="button"
                            className="tool-list__delete"
                            onClick={() => onToolsChange(tools.filter((t) => t.id !== tool.id))}
                            aria-label={nl ? "Verwijder" : "Delete"}
                          >
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 4h10M8 4V2.5h-2V4M3.5 4l.5 7.5h6l.5-7.5"/></svg>
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="tool-list__add"
                      onClick={() => {
                        const id = `tool-${Date.now()}`;
                        onToolsChange([...tools, { id, color: "#000000", type: "pen" }]);
                      }}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
                      {nl ? "Gereedschap toevoegen" : "Add tool"}
                    </button>
                  </div>
                </>
              );

              // Text object selected — show text controls + tool picker
              if (sel.textContent) {
                const tc = sel.textContent;
                const color = tc.color;
                const matchedTool = tools.find((t) => t.color.toLowerCase() === color.toLowerCase()) ?? null;
                return (
                  <>
                    <p className="drawer-section__title">{nl ? "Tekst" : "Text"}</p>
                    <div className="object-settings">
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-tool">{nl ? "Gereedschap" : "Tool"}</label>
                        <select id="txt-tool" className="object-settings__select"
                          value={matchedTool?.id ?? ""}
                          onChange={(e) => { const p = tools.find((t) => t.id === e.target.value); if (p) onTextContentChange(sel.id, { color: p.color }); }}
                        >
                          {tools.map((t) => (
                            <option key={t.id} value={t.id}>{t.color.toUpperCase()} — {t.type === "pen" ? "Pen" : (nl ? "Snijden" : "Cut")}</option>
                          ))}
                          {!matchedTool && <option value="">— {nl ? "Geen" : "None"} —</option>}
                        </select>
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-font">{nl ? "Lettertype" : "Font"}</label>
                        <select id="txt-font" className="object-settings__select"
                          value={tc.fontFamily}
                          onChange={(e) => onTextContentChange(sel.id, { fontFamily: e.target.value })}
                        >
                          <optgroup label={nl ? "Generiek" : "Generic"}>
                            {["sans-serif","serif","monospace","cursive","fantasy"].map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </optgroup>
                          {systemFonts.length > 0 ? (
                            <optgroup label={nl ? "Systeemlettertypen" : "System fonts"}>
                              {systemFonts.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </optgroup>
                          ) : (
                            <optgroup label={nl ? "Veelgebruikt" : "Common"}>
                              {["Arial","Arial Black","Helvetica","Helvetica Neue","Verdana","Tahoma","Trebuchet MS","Georgia","Times New Roman","Palatino","Garamond","Courier New","Lucida Console","Monaco","Menlo","Impact","Comic Sans MS","Gill Sans","Optima","Futura","Century Gothic","Calibri","Cambria","Segoe UI","Franklin Gothic Medium"].map((f) => (
                                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label">{nl ? "Stijl" : "Style"}</label>
                        <div className="text-style-btns">
                          <button type="button" className={`text-style-btn${tc.fontWeight === "bold" ? " text-style-btn--active" : ""}`}
                            onClick={() => onTextContentChange(sel.id, { fontWeight: tc.fontWeight === "bold" ? "normal" : "bold" })}
                          ><strong>B</strong></button>
                          <button type="button" className={`text-style-btn${tc.fontStyle === "italic" ? " text-style-btn--active" : ""}`}
                            onClick={() => onTextContentChange(sel.id, { fontStyle: tc.fontStyle === "italic" ? "normal" : "italic" })}
                          ><em>I</em></button>
                          <button type="button" className={`text-style-btn${tc.textDecoration === "underline" ? " text-style-btn--active" : ""}`}
                            onClick={() => onTextContentChange(sel.id, { textDecoration: tc.textDecoration === "underline" ? "none" : "underline" })}
                          ><span style={{ textDecoration: "underline" }}>U</span></button>
                          <span className="text-style-divider"/>
                          {(["left","center","right"] as const).map((align) => (
                            <button key={align} type="button" className={`text-style-btn${(tc.textAlign ?? "left") === align ? " text-style-btn--active" : ""}`}
                              onClick={() => onTextContentChange(sel.id, { textAlign: align })}
                              title={align}
                            >
                              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                {align === "left"   && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="6" x2="9" y2="6"/><line x1="2" y1="9" x2="11" y2="9"/><line x1="2" y1="12" x2="7" y2="12"/></>}
                                {align === "center" && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="4" y1="6" x2="10" y2="6"/><line x1="3" y1="9" x2="11" y2="9"/><line x1="5" y1="12" x2="9" y2="12"/></>}
                                {align === "right"  && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="5" y1="6" x2="12" y2="6"/><line x1="3" y1="9" x2="12" y2="9"/><line x1="7" y1="12" x2="12" y2="12"/></>}
                              </svg>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-size">{nl ? "Grootte" : "Size"} <em>{tc.fontSize}px</em></label>
                        <input id="txt-size" type="range" min={10} max={200} step={1} value={tc.fontSize}
                          onChange={(e) => onTextContentChange(sel.id, { fontSize: Number(e.target.value) })}
                          className="text-slider"
                        />
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-ls">{nl ? "Letterafstand" : "Letter spacing"} <em>{tc.letterSpacing}px</em></label>
                        <input id="txt-ls" type="range" min={-5} max={30} step={0.5} value={tc.letterSpacing}
                          onChange={(e) => onTextContentChange(sel.id, { letterSpacing: Number(e.target.value) })}
                          className="text-slider"
                        />
                      </div>
                      <div className="object-settings__row">
                        <label className="object-settings__label" htmlFor="txt-lh">{nl ? "Regelafstand" : "Line height"} <em>{tc.lineHeight.toFixed(2)}×</em></label>
                        <input id="txt-lh" type="range" min={0.8} max={3} step={0.05} value={tc.lineHeight}
                          onChange={(e) => onTextContentChange(sel.id, { lineHeight: Number(e.target.value) })}
                          className="text-slider"
                        />
                      </div>
                      <button type="button" className="object-settings__edit-btn"
                        onClick={() => onEnterTextEdit(sel.id)}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M11 2l3 3-8 8H3v-3z"/></svg>
                        {nl ? "Tekst bewerken" : "Edit text"}
                      </button>
                    </div>
                  </>
                );
              }

              // SVG/shape object selected — show name + tool picker
              const color = sel.paths[0]?.stroke ?? "#000000";
              const matchedTool = tools.find((t) => t.color.toLowerCase() === color.toLowerCase()) ?? null;
              const noToolWarning = !matchedTool;
              return (
                <>
                  <p className="drawer-section__title">{nl ? "Geselecteerd" : "Selection"}</p>
                  <div className="object-settings">
                    <p className="object-settings__name">{sel.fileName}</p>
                    <div className="object-settings__row">
                      <label className="object-settings__label" htmlFor="obj-tool">{nl ? "Gereedschap" : "Tool"}</label>
                      <select
                        id="obj-tool"
                        className="object-settings__select"
                        value={matchedTool?.id ?? ""}
                        onChange={(e) => {
                          const picked = tools.find((t) => t.id === e.target.value);
                          if (picked) onChangeObjectColor(sel.id, picked.color);
                        }}
                      >
                        {tools.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.color.toUpperCase()} — {t.type === "pen" ? (nl ? "Pen" : "Pen") : (nl ? "Snijden" : "Cut")}
                          </option>
                        ))}
                        {noToolWarning && <option value="">— {nl ? "Geen gereedschap" : "No tool"} —</option>}
                      </select>
                    </div>
                    {noToolWarning && (
                      <p className="object-settings__tool-warn">
                        ⚠ {nl ? "Geen gereedschap voor kleur " : "No tool for color "}<code>{color.toUpperCase()}</code>
                      </p>
                    )}
                  </div>
                </>
              );
            })()}
          </div>

          <div className="drawer-section">
            <p className="drawer-section__title">{language === "nl" ? "Lagen" : "Layers"}</p>
          {importedSvgs.length > 0 ? (
            <>
              <div className="workspace-item-list" aria-label={language === "nl" ? "Onderdelen in dit project" : "Items in this project"}>
                {importedSvgs.map((item) => {
                  const isSelected = selectedSvgIdSet.has(item.id);
                  const isExpanded = expandedGroups.has(item.id);
                  const isRenaming = renamingId === item.id;
                  return (
                    <div key={item.id} className="workspace-item-list__row">
                      <div
                        className={`workspace-item-list__item${isSelected ? " workspace-item-list__item--selected" : ""}`}
                      >
                        {item.type === "group" ? (
                          <button
                            type="button"
                            className="workspace-item-list__expand"
                            aria-label={isExpanded ? "Collapse group" : "Expand group"}
                            onClick={() => setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                              return next;
                            })}
                          >
                            {isExpanded ? "▾" : "▸"}
                          </button>
                        ) : (
                          <span className="workspace-item-list__icon">◈</span>
                        )}
                        <button
                          type="button"
                          className="workspace-item-list__select"
                          onClick={() => {
                            if (pendingRenameRef.current) {
                              clearTimeout(pendingRenameRef.current.timer);
                              pendingRenameRef.current = null;
                            }
                            if (isSelected && selectedSvgIds.length === 1 && renamingId !== item.id) {
                              const timer = setTimeout(() => {
                                setRenamingId(item.id);
                                pendingRenameRef.current = null;
                              }, 500);
                              pendingRenameRef.current = { id: item.id, timer };
                            } else {
                              onSelectSvg(item.id);
                            }
                          }}
                          aria-pressed={isSelected}
                        >
                          {isRenaming ? (
                            <input
                              className="workspace-item-list__rename-input"
                              defaultValue={item.fileName}
                              autoFocus
                              onBlur={(e) => { onRenameObject(item.id, e.currentTarget.value); setRenamingId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { onRenameObject(item.id, e.currentTarget.value); setRenamingId(null); }
                                if (e.key === "Escape") { setRenamingId(null); }
                                e.stopPropagation();
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span>
                              {item.fileName}
                              {(() => {
                                const stroke = item.paths[0]?.stroke ?? "";
                                const hasMatch = tools.some((t) => t.color.toLowerCase() === stroke.toLowerCase());
                                return !hasMatch && stroke ? <span className="workspace-item-list__warn" title={language === "nl" ? "Geen gereedschap voor deze kleur" : "No tool for this color"}>⚠</span> : null;
                              })()}
                            </span>
                          )}
                        </button>
                      </div>
                      {item.type === "group" && isExpanded ? (
                        <div className="workspace-item-list__children">
                          {item.paths.map((path, i) => (
                            <div key={path.id} className="workspace-item-list__child">
                              <span className="workspace-item-list__icon">◈</span>
                              <span>{path.sourceLabel ?? (language === "nl" ? `Pad ${i + 1}` : `Path ${i + 1}`)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyImportState language={language} />
          )}
          </div>
        </aside>
      </section>
    </main>
  );
}
