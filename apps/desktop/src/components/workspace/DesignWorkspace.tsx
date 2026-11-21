import { CanvasViewport } from './CanvasViewport';
import { WorkspaceInspector } from './WorkspaceInspector';
import { ARROW_DIRECTIONS } from './workspace-render-helpers';
import { workspaceHasCutContent } from '../../workspace-materials';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, MutableRefObject, PointerEvent } from 'react';
import Moveable from 'react-moveable';
import type {
  OnClick,
  OnClickGroup,
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
} from 'react-moveable';
import { APP_NAME } from '../../onboarding-copy';
import { type WorkspaceTool } from '../../project-file';
import type { WorkspaceSvgItem, WorkspaceTextContent } from '../../workspace-objects';
import { type Language, createTranslator, getMaterialName, getMatName } from '../../i18n';
import { MAT_PRESETS, MATERIAL_OPTIONS } from '@cricut-companion/slicebug-bridge';
import {
  type DashSettings,
  type DotPrintSettings,
  type OutlineSettings,
  type PenFillSettings,
} from '@cricut-companion/craft-core';
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
  getMatKind,
  type CardSize,
  CARD_SIZES,
  type WorkspaceRect,
  type AlignMode,
  type SnapTargets,
  getSnapTargets,
  nudgeStepPx,
  snapDragDelta,
  fitMatToView,
  getMatBorder,
  getMeasurementTicks,
  getWorkspaceItemTransform,
  getWorkspaceItemVisualSize,
  getWorkspaceSelectionBounds,
  localOffsetToWorld,
  rotateWorkspaceItemTransformAroundPoint,
  scaleWorkspaceItemTransformFromAnchor,
  snapScaleFactorToAspect,
} from '../../workspace-utils';
import type { WorkspaceShapeKind } from '../../workspace-shapes';
import { buildShapePath } from '../../workspace-shapes';
import type { AiSvgInput } from '../../ai-svg-generate';
import type {
  CutSessionSnapshot,
  LibraryImage,
  SlicebugPlanResult,
  SpotifyCode,
} from '../../app-types';
import { cssEscape, isEditableKeyboardTarget } from '../../utils/dom-utils';
import { isUngroupablePath } from '../../utils/workspace-geometry';
import { materialCategoryOf } from './CraftIcons';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { ImageLibraryPanel } from '../panels/ImageLibraryPanel';
import { ShapeLibraryPanel } from '../panels/ShapeLibraryPanel';
import { SpotifyCodePanel } from '../panels/SpotifyCodePanel';

export function DesignWorkspace({
  language,
  measurementUnit,
  selectedMaterialId,
  nativeMaterials = [],
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
  canUndo,
  canRedo,
  onBackWelcome,
  onMaterialChange,
  cardSize,
  insertSlots,
  onCardSizeChange,
  onInsertSlotsChange,
  onMatChange,
  tools,
  onToolsChange,
  paperColor,
  onPaperColorChange,
  onSvgFileChange,
  onAddShape,
  onAddText,
  editingTextId,
  onEnterTextEdit,
  onExitTextEdit,
  onTextContentChange,
  onShapeCornerRadiusChange,
  onPenFillChange,
  onDashChange,
  onHollowChange,
  onOutlineChange,
  onOutlineDetach,
  onAlign,
  onDistribute,
  onNudge,
  onDotPrintChange,
  onDotPrintImport,
  visibleAreaRef,
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
  onMoveLayer,
  onReorderLayerToTarget,
  onRenameObject,
  onChangeObjectColor,
  onUndoSvgs,
  onRedoSvgs,
  onWorkspaceContextMenu,
  onSvgTransformsCommit,
  onPrepareImportedPlan: _onPrepareImportedPlan,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
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
  onRenameLibraryImage,
  onDeleteLibraryImage,
  onAddLibraryImageToWorkspace,
  onAddSpotifyCodeToWorkspace,
  onReplaceSpotifyCode,
}: {
  language: Language;
  measurementUnit: MeasurementUnit;
  selectedMaterialId: number;
  nativeMaterials?: Array<{ id: number; name: string }>;
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
  canUndo: boolean;
  canRedo: boolean;
  onBackWelcome: () => void;
  onMaterialChange: (materialId: number) => void;
  cardSize: CardSize | null;
  insertSlots: boolean;
  onCardSizeChange: (size: CardSize) => void;
  onInsertSlotsChange: (value: boolean) => void;
  onMatChange: (matPreset: string) => void;
  tools: WorkspaceTool[];
  onToolsChange: (tools: WorkspaceTool[]) => void;
  paperColor: string;
  onPaperColorChange: (color: string) => void;
  onSvgFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddShape: (shapeKind: WorkspaceShapeKind, options?: { fold?: boolean }) => void;
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
  onMoveLayer: (mode: 'forward' | 'backward' | 'front' | 'back') => boolean;
  onReorderLayerToTarget: (draggedId: string, targetId: string) => void;
  onRenameObject: (id: string, newName: string) => void;
  onChangeObjectColor: (ids: string | string[], color: string) => void;
  onUndoSvgs: () => boolean;
  onRedoSvgs: () => boolean;
  onWorkspaceContextMenu: (selectedObjectCount?: number) => void;
  onSvgTransformsCommit: (
    updates: Array<{ id: string; transform: WorkspaceItemTransform }>,
  ) => void;
  onPrepareImportedPlan: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onGenerateSamplePlan: () => void;
  onStartCut: () => void;
  onContinueCut: () => void;
  onStopCut: () => void;
  hasActiveAiKey: boolean;
  onOpenSettings: () => void;
  onOpenAiGenerate: () => void;
  onAiGenerateSvg: (input: Omit<AiSvgInput, 'settings'>) => Promise<string>;
  imageLibrary: LibraryImage[];
  imageLibraryLoading: boolean;
  onLoadImageLibrary: () => void;
  onRenameLibraryImage: (path: string, name: string) => Promise<void>;
  onDeleteLibraryImage: (path: string) => void;
  onAddLibraryImageToWorkspace: (img: LibraryImage) => void;
  onAddSpotifyCodeToWorkspace: (code: SpotifyCode) => void;
  onReplaceSpotifyCode: (itemId: string, code: SpotifyCode) => void;
  onAddText: () => void;
  editingTextId: string | null;
  onEnterTextEdit: (id: string) => void;
  onExitTextEdit: (id: string) => void;
  onTextContentChange: (ids: string | string[], patch: Partial<WorkspaceTextContent>) => void;
  onShapeCornerRadiusChange: (ids: string | string[], radius: number) => void;
  onPenFillChange: (ids: string[], patch: Partial<PenFillSettings>) => void;
  onDashChange: (ids: string[], patch: Partial<DashSettings>) => void;
  onHollowChange: (ids: string[], hollow: boolean) => void;
  onOutlineChange: (ids: string[], patch: Partial<OutlineSettings>) => void;
  onOutlineDetach: (ids: string[]) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  /** Moves the selection by an offset in workspace pixels. */
  onNudge: (dx: number, dy: number) => boolean;
  onDotPrintChange: (ids: string[], patch: Partial<DotPrintSettings>) => void;
  onDotPrintImport: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Filled with a function that returns the part of the workspace currently on screen. */
  visibleAreaRef?: MutableRefObject<(() => WorkspaceRect | null) | null>;
}) {
  const { t } = createTranslator(language);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState<Point>({ x: 260, y: 90 });
  const [activeDrawer, setActiveDrawer] = useState<'image' | 'shapes' | 'spotify' | null>(null);
  const drawerOpen = activeDrawer !== null;
  // When set, the Spotify drawer swaps this code's song instead of adding a new code.
  const [spotifyReplaceId, setSpotifyReplaceId] = useState<string | null>(null);
  const spotifyReplaceTarget = spotifyReplaceId
    ? (importedSvgs.find((item) => item.id === spotifyReplaceId) ?? null)
    : null;

  function openSpotifyReplace(itemId: string) {
    setSpotifyReplaceId(itemId);
    setActiveDrawer('spotify');
  }

  function toggleDrawer(drawer: 'image' | 'shapes' | 'spotify') {
    setSpotifyReplaceId(null);
    if (activeDrawer === drawer) {
      setActiveDrawer(null);
      return;
    }
    setActiveDrawer(drawer);
    if (drawer === 'image') {
      onLoadImageLibrary();
    }
  }
  const pendingRenameRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const selectionBarRef = useRef<HTMLDivElement | null>(null);
  const workpieceTransformRef = useRef<HTMLDivElement | null>(null);
  // Panning (right/middle/space-drag) and marquee (left-drag on empty) gestures.
  const panRef = useRef<null | {
    pointerId: number;
    start: Point;
    pan: Point;
    button: number;
    moved: boolean;
  }>(null);
  const marqueeRef = useRef<null | {
    pointerId: number;
    origin: Point;
    baseSelection: string[];
    mode: 'replace' | 'add' | 'toggle';
    moved: boolean;
  }>(null);
  const spaceHeldRef = useRef(false);
  const [spacePanReady, setSpacePanReady] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
  }>(null);
  const recentScrollRef = useRef(false);
  const recentScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directItemDragStart = useRef<null | {
    pointerId: number;
    id: string;
    pointer: Point;
    transform: WorkspaceItemTransform;
    moved: boolean;
    snapTargets: SnapTargets;
  }>(null);
  const snapGuideLayerRef = useRef<HTMLDivElement | null>(null);
  // Holding Cmd/Ctrl while dragging lets an object sit right next to a line without jumping onto it.
  const [snapSuspended, setSnapSuspended] = useState(false);
  const [snapElements, setSnapElements] = useState<HTMLElement[]>([]);
  const moveableTransformStart = useRef(new Map<string, WorkspaceItemTransform>());
  const moveableGroupCenterStart = useRef<Point | null>(null);
  const latestMoveableTransforms = useRef(new Map<string, WorkspaceItemTransform>());
  const moveableRef = useRef<Moveable | null>(null);
  const [moveableTargets, setMoveableTargets] = useState<HTMLElement[]>([]);
  const [isDirectItemDragging, setIsDirectItemDragging] = useState(false);
  const matDimensions = getMatDimensionsInches(selectedMatPreset);
  // The active card size (insert-card sub-option) shrinks the working area: rulers, the
  // white paper, and slot positions follow it. The cut/mat itself are unaffected.
  const isInsertCard = materialCategoryOf(selectedMaterialId) === 'insert';
  const activeCardSize = isInsertCard ? cardSize : null;
  const activeDims = activeCardSize ? CARD_SIZES[activeCardSize] : matDimensions;
  const materialName =
    nativeMaterials.find((m) => m.id === selectedMaterialId)?.name ??
    getMaterialName(selectedMaterialId, language) ??
    MATERIAL_OPTIONS.find((material) => material.id === selectedMaterialId)?.name ??
    'Material';
  const matName =
    getMatName(selectedMatPreset, language) ??
    MAT_PRESETS.find((mat) => mat.id === selectedMatPreset)?.name ??
    'Mat';
  // The mat + paper container stay the full mat size (the mat is always visible); the
  // white "card" area + rulers + slots follow the selected card size.
  const workpieceWidth = matDimensions.width * WORKSPACE_PIXELS_PER_INCH;
  const workpieceHeight = matDimensions.height * WORKSPACE_PIXELS_PER_INCH;
  const cardWidth = activeDims.width * WORKSPACE_PIXELS_PER_INCH;
  const cardHeight = activeDims.height * WORKSPACE_PIXELS_PER_INCH;
  const xTicks = getMeasurementTicks({
    axis: 'x',
    lengthInches: activeDims.width,
    unit: measurementUnit,
    zoom,
    pan,
    pixelsPerInch: WORKSPACE_PIXELS_PER_INCH,
  });
  const yTicks = getMeasurementTicks({
    axis: 'y',
    lengthInches: activeDims.height,
    unit: measurementUnit,
    zoom,
    pan,
    pixelsPerInch: WORKSPACE_PIXELS_PER_INCH,
  });
  const canCut =
    workspaceHasCutContent(importedSvgs.length, selectedMaterialId, insertSlots) &&
    !importedPlanLoading &&
    !cutBusy;
  const selectedSvgIdSet = useMemo(() => new Set(selectedSvgIds), [selectedSvgIds]);
  const lastPointerDownItemId = useRef<{ id: string; time: number } | null>(null);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  useEffect(() => {
    void window.cricutCompanion?.system?.getFonts().then((fonts) => {
      if (fonts && fonts.length > 0) setSystemFonts(fonts.sort());
    });
  }, []);
  const selectedItems = useMemo(
    () => importedSvgs.filter((item) => selectedSvgIdSet.has(item.id)),
    [importedSvgs, selectedSvgIdSet],
  );
  const selectedGroup =
    selectedItems.length === 1 && selectedItems[0]?.type === 'group' ? selectedItems[0] : null;
  // Ungroup also applies to a single traced/compound path with 2+ top-level shapes.
  // Memoized because the check measures path bboxes in the DOM.
  const canUngroupSelection = useMemo(() => {
    // A dot photo is one picture, not a group of parts.
    if (selectedItems.some((item) => item.dotPrint)) return false;
    if (selectedGroup !== null) return true;
    return selectedItems.length === 1 && !!selectedItems[0] && isUngroupablePath(selectedItems[0]);
  }, [selectedGroup, selectedItems]);

  // Where the action bar for the selection goes (viewport pixels): centred just below
  // the selection, or above it (clear of the rotate handle) when there is no room below.
  const selectionBarPosition = (() => {
    if (selectedItems.length === 0 || isDirectItemDragging || editingTextId) return null;
    const bounds = getWorkspaceSelectionBounds(selectedItems);
    if (!bounds) return null;
    const BAR_HEIGHT = 58;
    const toScreenY = (y: number) => WORKSPACE_STAGE_TOP_OFFSET + pan.y + y * zoom;
    const viewportHeight = viewportRef.current?.clientHeight ?? Infinity;
    const below = toScreenY(bounds.bottom) + 14;
    const above = toScreenY(bounds.top) - BAR_HEIGHT - 44;
    const minTop = WORKSPACE_STAGE_TOP_OFFSET + 8;
    const maxTop = viewportHeight - BAR_HEIGHT - 8;
    const top = below <= maxTop ? below : above >= minTop ? above : maxTop;
    // Keep the whole bar inside the canvas when the selection sits near an edge.
    const groupable =
      selectedItems.length >= 2 &&
      !selectedItems.some((item) => item.textContent || item.dotPrint || item.dashed?.enabled);
    const buttonCount =
      4 +
      (selectedItems.length === 1 && importedSvgs.length > 1 ? 2 : 0) +
      (groupable ? 1 : 0) +
      (canUngroupSelection ? 1 : 0);
    const halfWidth = buttonCount * 40 + 8;
    const viewportWidth = viewportRef.current?.clientWidth ?? Infinity;
    const center = WORKSPACE_STAGE_LEFT_OFFSET + pan.x + bounds.center.x * zoom;
    return {
      left: Math.max(
        WORKSPACE_STAGE_LEFT_OFFSET + 8 + halfWidth,
        Math.min(viewportWidth - 8 - halfWidth, center),
      ),
      top: Math.max(minTop, top),
    };
  })();
  // Text renders with preserveAspectRatio="meet" (never stretches) and is cut from a
  // re-measured frame, so a non-uniform scale would make display, edit overlay, and cut
  // disagree. Force uniform scaling whenever the whole selection is text.
  const selectionIsAllText =
    selectedItems.length > 0 && selectedItems.every((item) => Boolean(item.textContent));
  // A line only has a length, so it only gets the two end handles.
  const selectionIsAllLines =
    selectedItems.length > 0 && selectedItems.every((item) => item.shapeKind === 'line');

  useEffect(() => {
    const root = workpieceTransformRef.current;
    if (!root || selectedItems.length === 0) {
      setMoveableTargets([]);
      setSnapElements([]);
      return;
    }
    setMoveableTargets(
      selectedItems
        .map((item) =>
          root.querySelector<HTMLElement>(`[data-workspace-item-id="${cssEscape(item.id)}"]`),
        )
        .filter((target): target is HTMLElement => Boolean(target)),
    );
    // Everything that isn't selected is something to line the selection up with.
    setSnapElements(
      Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-item-id]')).filter(
        (element) => !selectedSvgIdSet.has(element.dataset.workspaceItemId ?? ''),
      ),
    );
  }, [selectedItems, selectedSvgIdSet, importedSvgs.length]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      setSnapSuspended(event.metaKey || event.ctrlKey);
    }
    const release = () => setSnapSuspended(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', release);
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      moveableRef.current?.updateRect();
    });
  }, [importedSvgs]);

  // Modifier (Ctrl/Cmd/Shift) + click toggles an item in/out of the selection. Handled
  // in the capture phase so it works even when the item is under the Moveable control
  // box (which would otherwise swallow the click), for both selected and unselected items.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onCapturePointerDown(event: globalThis.PointerEvent) {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey || event.shiftKey)) return;
      const id = itemIdAtPoint(event.clientX, event.clientY);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      toggleLayerSelection(id);
    }
    el.addEventListener('pointerdown', onCapturePointerDown, true);
    return () => el.removeEventListener('pointerdown', onCapturePointerDown, true);
  }, [selectedSvgIds]);

  // Hold Space to pan with a left drag (trackpad-friendly fallback for right/middle drag).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat) return;
      if (editingTextId || isEditableKeyboardTarget(event.target)) return;
      event.preventDefault(); // stop the page from scrolling
      spaceHeldRef.current = true;
      setSpacePanReady(true);
    }
    function onKeyUp(event: globalThis.KeyboardEvent) {
      if (event.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpacePanReady(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [editingTextId]);

  useEffect(() => {
    if (pendingRenameRef.current) {
      clearTimeout(pendingRenameRef.current.timer);
      pendingRenameRef.current = null;
    }
  }, [selectedSvgIds]);

  function clampZoom(nextZoom: number) {
    return Math.min(WORKSPACE_MAX_ZOOM, Math.max(WORKSPACE_MIN_ZOOM, nextZoom));
  }

  // Zoom while keeping the world point under (cx, cy) — viewport-local pixels — fixed.
  function zoomAroundPoint(nextZoomRaw: number, cx: number, cy: number) {
    const nextZoom = clampZoom(nextZoomRaw);
    if (nextZoom === zoom) return;
    viewIsAutoFit.current = false;
    const worldX = (cx - pan.x) / zoom;
    const worldY = (cy - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({ x: cx - worldX * nextZoom, y: cy - worldY * nextZoom });
  }

  // Zoom buttons: anchor on the centre of the viewport, not the paper's top-left origin.
  function zoomFromCenter(nextZoomRaw: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    zoomAroundPoint(nextZoomRaw, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2);
  }

  // Centre the mat in the viewport at a given zoom (pan accounts for the ruler offsets).
  function centerMatInViewport(z: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    const viewportWidth = rect?.width ?? workpieceWidth + WORKSPACE_STAGE_LEFT_OFFSET * 2;
    const viewportHeight = rect?.height ?? workpieceHeight + WORKSPACE_STAGE_TOP_OFFSET * 2;
    setPan({
      x: (viewportWidth - workpieceWidth * z) / 2 - WORKSPACE_STAGE_LEFT_OFFSET,
      y: (viewportHeight - workpieceHeight * z) / 2 - WORKSPACE_STAGE_TOP_OFFSET,
    });
  }

  function resetZoomToActualSize() {
    viewIsAutoFit.current = false;
    setZoom(1);
    centerMatInViewport(1);
  }

  // Keep the workpiece from being scrolled/dragged infinitely away: clamp the pan so a
  // chunk of the mat always stays inside the viewport.
  function clampPan(next: Point, z: number = zoom): Point {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return next;
    const contentW = workpieceWidth * z;
    const contentH = workpieceHeight * z;
    // How much of the workpiece must remain visible (never more than half of it/the view).
    const marginX = Math.min(140, contentW * 0.5, rect.width * 0.5);
    const marginY = Math.min(140, contentH * 0.5, rect.height * 0.5);
    return {
      x: Math.min(rect.width - marginX, Math.max(marginX - contentW, next.x)),
      y: Math.min(rect.height - marginY, Math.max(marginY - contentH, next.y)),
    };
  }

  // Show the whole mat when the workspace opens and whenever another mat is chosen
  // (after layout is measured), so the paper never starts half out of view.
  // While the user hasn't zoomed or panned themselves, the view also refits when the
  // canvas changes size (a drawer opening, the window resizing).
  const viewIsAutoFit = useRef(true);
  const fitMatRef = useRef<() => void>(() => {});
  fitMatRef.current = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fit = fitMatToView({
      paper: { width: workpieceWidth, height: workpieceHeight },
      border: getMatBorder(getMatKind(selectedMatPreset)),
      available: {
        width: rect.width - WORKSPACE_STAGE_LEFT_OFFSET,
        height: rect.height - WORKSPACE_STAGE_TOP_OFFSET,
      },
    });
    viewIsAutoFit.current = true;
    setZoom(fit.zoom);
    setPan(fit.pan);
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => fitMatRef.current());
    return () => cancelAnimationFrame(id);
  }, [selectedMatPreset]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (viewIsAutoFit.current) fitMatRef.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Lets the app place new objects where the user is looking.
  useEffect(() => {
    if (!visibleAreaRef) return;
    visibleAreaRef.current = () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: -pan.x / zoom,
        y: -pan.y / zoom,
        width: (rect.width - WORKSPACE_STAGE_LEFT_OFFSET) / zoom,
        height: (rect.height - WORKSPACE_STAGE_TOP_OFFSET) / zoom,
      };
    };
    return () => {
      visibleAreaRef.current = null;
    };
  }, [visibleAreaRef, zoom, pan]);

  // Wheel handling lives on a native, non-passive listener (attached below). React's own
  // onWheel is passive, so calling preventDefault() there (to stop ctrl/⌘-zoom from also
  // scrolling the page) is ignored and logs a console warning.
  const wheelHandlerRef = useRef<(event: globalThis.WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (event: globalThis.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const sensitivity = event.deltaMode === 0 ? 0.01 : 0.005;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAroundPoint(
        zoom - event.deltaY * sensitivity,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      return;
    }
    recentScrollRef.current = true;
    if (recentScrollTimerRef.current) clearTimeout(recentScrollTimerRef.current);
    recentScrollTimerRef.current = setTimeout(() => {
      recentScrollRef.current = false;
    }, 300);
    viewIsAutoFit.current = false;
    setPan((current) => clampPan({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  };
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const listener = (event: globalThis.WheelEvent) => wheelHandlerRef.current(event);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

  const DRAG_THRESHOLD = 4; // px before a press becomes a drag (vs a click)
  const SNAP_SCREEN_PX = 6; // how close (on screen) an edge must come to a line to snap onto it

  // Viewport pointer model:
  //  • Right / middle button, or Space+left → pan (anywhere, even over objects).
  //  • Left on empty canvas → marquee select (object/Moveable drags handled elsewhere).
  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeldRef.current)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        pan,
        button: event.button,
        moved: false,
      };
      return;
    }
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.moveable-control-box') || target.closest('.workspace-image-item')) return;
    // Left press on empty canvas → start a marquee (only becomes visible once it moves).
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    marqueeRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      baseSelection: selectedSvgIds.slice(),
      mode: event.shiftKey ? 'add' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace',
      moved: false,
    };
  }

  function updateMarquee(
    m: NonNullable<typeof marqueeRef.current>,
    clientX: number,
    clientY: number,
  ) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ox = m.origin.x - rect.left;
    const oy = m.origin.y - rect.top;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const left = Math.min(ox, cx),
      top = Math.min(oy, cy);
    const width = Math.abs(cx - ox),
      height = Math.abs(cy - oy);
    setMarqueeRect({ left, top, width, height });
    // Marquee rect in workpiece/world coordinates.
    const wl = (left - pan.x) / zoom,
      wt = (top - pan.y) / zoom;
    const wr = (left + width - pan.x) / zoom,
      wb = (top + height - pan.y) / zoom;
    const hits = importedSvgs
      .filter((item) => {
        const b = getWorkspaceSelectionBounds([item]);
        return b && !(b.right < wl || b.left > wr || b.bottom < wt || b.top > wb);
      })
      .map((item) => item.id);
    let next: string[];
    if (m.mode === 'add') {
      next = Array.from(new Set([...m.baseSelection, ...hits]));
    } else if (m.mode === 'toggle') {
      const hitSet = new Set(hits);
      const baseSet = new Set(m.baseSelection);
      next = [
        ...m.baseSelection.filter((id) => !hitSet.has(id)),
        ...hits.filter((id) => !baseSet.has(id)),
      ];
    } else {
      next = hits;
    }
    onSelectSvgGroup(next);
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>) {
    const panState = panRef.current;
    if (panState && panState.pointerId === event.pointerId) {
      const dx = event.clientX - panState.start.x;
      const dy = event.clientY - panState.start.y;
      if (!panState.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD))
        panState.moved = true;
      viewIsAutoFit.current = false;
      setPan(clampPan({ x: panState.pan.x + dx, y: panState.pan.y + dy }));
      return;
    }
    const m = marqueeRef.current;
    if (m && m.pointerId === event.pointerId) {
      const dx = event.clientX - m.origin.x;
      const dy = event.clientY - m.origin.y;
      if (!m.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD))
        m.moved = true;
      if (m.moved) updateMarquee(m, event.clientX, event.clientY);
    }
  }

  function handleViewportPointerUp(event: PointerEvent<HTMLDivElement>) {
    const panState = panRef.current;
    if (panState && panState.pointerId === event.pointerId) {
      panRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      // A right-click without movement opens the context menu (panning suppresses it).
      if (panState.button === 2 && !panState.moved) {
        requestContextMenu(itemIdAtPoint(event.clientX, event.clientY));
      }
      return;
    }
    const m = marqueeRef.current;
    if (m && m.pointerId === event.pointerId) {
      marqueeRef.current = null;
      setMarqueeRect(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      // A plain click on empty canvas (no drag) clears the selection.
      if (!m.moved && m.mode === 'replace') onSelectSvg(null);
    }
  }

  function handleViewportPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    if (marqueeRef.current?.pointerId === event.pointerId) {
      marqueeRef.current = null;
      setMarqueeRect(null);
    }
  }

  // Select the right-clicked object (if not already selected) then open the menu.
  function requestContextMenu(id?: string) {
    if (id && !selectedSvgIdSet.has(id)) {
      onSelectSvg(id);
      onWorkspaceContextMenu(1);
      return;
    }
    onWorkspaceContextMenu(id ? selectedSvgIds.length : 0);
  }

  // Add the id if it isn't selected, remove it if it is.
  function toggleLayerSelection(id: string) {
    if (selectedSvgIdSet.has(id)) {
      onSelectSvgGroup(selectedSvgIds.filter((x) => x !== id));
    } else {
      onSelectSvgGroup([...selectedSvgIds, id]);
    }
  }

  // Find the topmost workspace item under a screen point, seeing *through* the Moveable
  // control box (which sits on top of the selection and would otherwise be the target).
  function itemIdAtPoint(x: number, y: number): string | undefined {
    for (const el of document.elementsFromPoint(x, y)) {
      const itemEl = (el as Element).closest?.('[data-workspace-item-id]') as HTMLElement | null;
      if (itemEl?.dataset.workspaceItemId) return itemEl.dataset.workspaceItemId;
    }
    return undefined;
  }

  // Modifier-clicking a *selected* item lands on the Moveable control box, not the item,
  // so hit-test the item under the cursor and toggle it in/out of the selection.
  function handleMoveableModifierClick(event: OnClick | OnClickGroup) {
    const native = event.inputEvent as MouseEvent | undefined;
    if (!native || !(native.metaKey || native.ctrlKey || native.shiftKey)) return;
    const id = itemIdAtPoint(native.clientX, native.clientY);
    if (id) toggleLayerSelection(id);
  }

  function handleItemPointerDown(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    // While this text is being edited, let the textarea handle clicks/drags (cursor
    // placement, selection). Still stop propagation so the click doesn't reach the
    // viewport pan handler (which would drag the whole workspace), but don't preventDefault
    // or start an item drag — the textarea keeps native focus + text selection.
    if (editingTextId === item.id) {
      event.stopPropagation();
      return;
    }
    // Let right/middle drags pan the workspace even when starting on an object — don't
    // swallow them here. (Right-click selection + menu happen on the viewport's up.)
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();

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

    // Modifier-click toggles the item in/out of the selection (add if absent, remove if present).
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      toggleLayerSelection(item.id);
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
        snapTargets: getSnapTargets(
          { x: 0, y: 0, width: cardWidth, height: cardHeight },
          importedSvgs.filter((other) => other.id !== item.id),
        ),
      };
      setIsDirectItemDragging(true);
    }
  }

  function handleItemPointerMove(event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) {
    const drag = directItemDragStart.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.id !== item.id) {
      return;
    }
    const rawX = (event.clientX - drag.pointer.x) / zoom;
    const rawY = (event.clientY - drag.pointer.y) / zoom;
    if (Math.abs(rawX) > 0.5 || Math.abs(rawY) > 0.5) {
      drag.moved = true;
    }
    const { x: deltaX, y: deltaY } = snapDirectDrag(
      drag,
      item,
      { x: rawX, y: rawY },
      event.metaKey || event.ctrlKey,
    );
    const next = clampWorkspaceItemTransform({
      ...drag.transform,
      x: drag.transform.x + deltaX,
      y: drag.transform.y + deltaY,
    });
    event.currentTarget.style.transform = getWorkspaceItemTransform(next);
  }

  // Pulls a dragged object onto a nearby line (paper edge or middle, or another object's
  // edge or middle) and shows that line while it holds.
  function snapDirectDrag(
    drag: NonNullable<typeof directItemDragStart.current>,
    item: WorkspaceSvgItem,
    delta: Point,
    suspended: boolean,
  ): Point {
    const bounds =
      suspended || !drag.moved
        ? null
        : getWorkspaceSelectionBounds([{ frame: item.frame, transform: drag.transform }]);
    const snapped = bounds
      ? snapDragDelta({
          bounds,
          delta,
          targets: drag.snapTargets,
          threshold: SNAP_SCREEN_PX / zoom,
        })
      : { delta, guides: [] };
    showSnapGuides(snapped.guides);
    return snapped.delta;
  }

  function showSnapGuides(guides: Array<{ axis: 'x' | 'y'; position: number }>) {
    const layer = snapGuideLayerRef.current;
    if (!layer) return;
    layer.replaceChildren(
      ...guides.map((guide) => {
        const line = document.createElement('div');
        line.className = `snap-guide snap-guide--${guide.axis}`;
        line.style[guide.axis === 'x' ? 'left' : 'top'] = `${guide.position}px`;
        // Keep the line one screen pixel wide at any zoom.
        line.style[guide.axis === 'x' ? 'width' : 'height'] = `${1 / zoom}px`;
        return line;
      }),
    );
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
    const { x: deltaX, y: deltaY } = snapDirectDrag(
      drag,
      item,
      { x: (event.clientX - drag.pointer.x) / zoom, y: (event.clientY - drag.pointer.y) / zoom },
      event.metaKey || event.ctrlKey,
    );
    showSnapGuides([]);
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

  function beginMoveableTransform(targets: Array<HTMLElement | SVGElement>) {
    const startEntries = targets.flatMap((target) => {
      const item = getWorkspaceItemFromTarget(target);
      return item ? [[item.id, item.transform] as const] : [];
    });
    moveableTransformStart.current = new Map(startEntries);
    latestMoveableTransforms.current = new Map(moveableTransformStart.current);
    // The action bar would lag behind the moving object, so hide it until the gesture ends.
    if (selectionBarRef.current) selectionBarRef.current.style.visibility = 'hidden';
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
    updateMoveableTargetTransform(event.target, {
      x: event.beforeTranslate[0],
      y: event.beforeTranslate[1],
    });
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
      event.setFixedDirection(
        getScaleFixedDirection(event.direction, isCenterScaleModifier(event.inputEvent)),
      );
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
    event.setFixedDirection(
      getScaleFixedDirection(event.direction, isCenterScaleModifier(event.inputEvent)),
    );
    event.events.forEach((childEvent) => {
      const item = getWorkspaceItemFromTarget(childEvent.target);
      if (item) {
        childEvent.set([item.transform.scaleX, item.transform.scaleY]);
        childEvent.setTransform(getWorkspaceItemTransform(item.transform));
        if (isCornerScaleDirection(childEvent.direction)) {
          childEvent.setRatio(item.frame.width / item.frame.height);
        }
        childEvent.setFixedDirection(
          getScaleFixedDirection(
            childEvent.direction,
            isCenterScaleModifier(childEvent.inputEvent),
          ),
        );
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
    updateMoveableTargetRotation(
      event.target,
      event.rotation,
      isPreciseRotationModifier(event.inputEvent),
      null,
    );
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
    applyMoveableTargetTransform(
      target,
      item.id,
      clampWorkspaceItemTransform({ ...start, ...transformPart }),
    );
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
        axis: direction[1] === 0 ? 'x' : 'y',
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
    const next = scaleWorkspaceItemTransformFromAnchor(
      start,
      item.frame,
      anchor,
      scaleFactorX,
      scaleFactorY,
    );
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

  function applyMoveableTargetTransform(
    target: HTMLElement | SVGElement,
    id: string,
    transform: WorkspaceItemTransform,
  ) {
    latestMoveableTransforms.current.set(id, transform);
    if (target instanceof HTMLElement) {
      target.style.transform = getWorkspaceItemTransform(transform);
      const item = importedSvgs.find((entry) => entry.id === id);
      if (item) {
        const size = getWorkspaceItemVisualSize(item.frame, transform);
        target.style.width = `${size.width}px`;
        target.style.height = `${size.height}px`;
        // Regenerate shape geometry live so corners stay circular and the stroke stays an
        // even pen-width while resizing. Match the artwork's actual-size viewBox approach:
        // update the SVG viewBox to the actual size and the path to that same space.
        if (item.shapeKind) {
          const svgEl = target.querySelector('svg');
          // The outline and the pen-fill clip both carry the shape geometry.
          const pathEls = svgEl?.querySelectorAll('[data-shape-geometry]') ?? [];
          if (svgEl && pathEls.length > 0) {
            const sx = Math.abs(transform.scaleX) || 1;
            const sy = Math.abs(transform.scaleY) || 1;
            const aw = Math.max(1, item.frame.width * sx);
            const ah = Math.max(1, item.frame.height * sy);
            const worldRadius = Math.min(
              (item.cornerRadius ?? 0) * Math.min(sx, sy),
              Math.min(aw, ah) / 2,
            );
            const d = buildShapePath(item.shapeKind, aw, ah, worldRadius);
            svgEl.setAttribute('viewBox', `0 0 ${aw} ${ah}`);
            pathEls.forEach((pathEl) => pathEl.setAttribute('d', d));
          }
        }
      }
    }
  }

  function commitMoveableTransforms() {
    if (selectionBarRef.current) selectionBarRef.current.style.visibility = '';
    const updates = Array.from(latestMoveableTransforms.current, ([id, transform]) => ({
      id,
      transform,
    }));
    moveableTransformStart.current = new Map();
    moveableGroupCenterStart.current = null;
    latestMoveableTransforms.current = new Map();
    onSvgTransformsCommit(updates);
  }

  function getWorkspaceItemFromTarget(target: HTMLElement | SVGElement): WorkspaceSvgItem | null {
    const id = target instanceof HTMLElement ? target.dataset.workspaceItemId : undefined;
    return id ? (importedSvgs.find((item) => item.id === id) ?? null) : null;
  }

  function getWorkspaceItemCenterPoint(
    transform: WorkspaceItemTransform,
    frame: { width: number; height: number },
  ): Point {
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
    }).filter(
      (
        item,
      ): item is { frame: { width: number; height: number }; transform: WorkspaceItemTransform } =>
        Boolean(item),
    );
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

  // When a pen / behind colour changes, recolour every object currently using the
  // old colour so the canvas stays WYSIWYG (a cut shape follows the behind colour, etc.).
  function recolorMatchingObjects(oldColor: string, newColor: string) {
    if (oldColor.toLowerCase() === newColor.toLowerCase()) return;
    importedSvgs.forEach((obj) => {
      if (obj.paths.some((p) => (p.stroke ?? '').toLowerCase() === oldColor.toLowerCase())) {
        onChangeObjectColor(obj.id, newColor);
      }
    });
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
    const snapped =
      Math.round(rotation / ROTATION_SNAP_INTERVAL_DEGREES) * ROTATION_SNAP_INTERVAL_DEGREES;
    return Math.abs(rotation - snapped) <= ROTATION_SNAP_THRESHOLD_DEGREES ? snapped : rotation;
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const usesModifier = event.metaKey || event.ctrlKey;
      if (usesModifier && event.key.toLowerCase() === 'z') {
        const handled = event.shiftKey ? onRedoSvgs() : onUndoSvgs();
        if (handled) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === 'y') {
        if (onRedoSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectAllSvgs();
        return;
      }
      if (usesModifier && event.key.toLowerCase() === 'c') {
        if (onCopySvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === 'v') {
        if (onPasteSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (usesModifier && event.key.toLowerCase() === 'x') {
        if (onCutSvgs()) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (onDeleteSvgs()) {
          event.preventDefault();
        }
        return;
      }
      // Arrow keys move the selection: 1 mm, Shift for 1 cm, Alt for a tenth of a millimetre.
      const direction = ARROW_DIRECTIONS[event.key];
      if (direction && !usesModifier) {
        const step = nudgeStepPx(
          measurementUnit,
          event.shiftKey ? 'large' : event.altKey ? 'fine' : 'normal',
        );
        if (onNudge(direction.x * step, direction.y * step)) {
          event.preventDefault();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    onCopySvgs,
    onCutSvgs,
    onDeleteSvgs,
    onPasteSvgs,
    onRedoSvgs,
    onSelectAllSvgs,
    onUndoSvgs,
    onNudge,
    measurementUnit,
  ]);

  return (
    <main className="app-shell design-shell">
      <div className="native-window-drag-zone app-drag" aria-hidden="true" />
      <header className="design-topbar">
        <div className="design-brand">
          <button
            className="workspace-home-button no-drag"
            type="button"
            onClick={onBackWelcome}
            aria-label={language === 'nl' ? 'Terug naar projectstart' : 'Back to project start'}
            title={language === 'nl' ? 'Projectstart' : 'Project start'}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9.5 10 3l7 6.5" />
              <path d="M5 8v8a1 1 0 0 0 1 1h3v-4h2v4h3a1 1 0 0 0 1-1V8" />
            </svg>
          </button>
          <div>
            <p className="eyebrow">{language === 'nl' ? 'Werkruimte' : 'Workspace'}</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>

        <WorkspaceToolbar
          language={language}
          canUndo={canUndo}
          canRedo={canRedo}
          projectSaving={projectSaving}
          projectOpening={projectOpening}
          onOpen={onOpenProject}
          onSave={onSaveProject}
          onUndo={onUndoSvgs}
          onRedo={onRedoSvgs}
        />

        <div className="design-topbar__controls no-drag">
          <button
            className="workspace-home-button no-drag"
            type="button"
            onClick={onOpenSettings}
            aria-label={language === 'nl' ? 'Instellingen' : 'Settings'}
            title={language === 'nl' ? 'Instellingen' : 'Settings'}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="10" cy="10" r="2.5" />
              <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.22 4.22l1.06 1.06M14.72 14.72l1.06 1.06M4.22 15.78l1.06-1.06M14.72 5.28l1.06-1.06" />
            </svg>
          </button>
          <button
            className="cut-button"
            type="button"
            data-native-intent="connect"
            disabled={!canCut}
            onClick={onStartCut}
          >
            <span aria-hidden="true">▶</span>
            {cutBusy ? t('buttons.starting') : t('buttons.startCut')}
          </button>
        </div>
      </header>

      <section
        className={drawerOpen ? 'design-frame design-frame--shape-drawer' : 'design-frame'}
        aria-label={language === 'nl' ? 'Ontwerpwerkruimte' : 'Design workspace'}
      >
        <aside
          className="tool-rail no-drag"
          aria-label={language === 'nl' ? 'Gereedschappen' : 'Tools'}
        >
          <button
            className={activeDrawer === 'image' ? 'tool-button tool-button--active' : 'tool-button'}
            type="button"
            onClick={() => toggleDrawer('image')}
            aria-expanded={activeDrawer === 'image'}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="16" height="16" rx="2.5" />
              <path d="M3 14.5 7.5 10l3.5 3.5 2.5-2.5 5.5 5.5" />
              <circle cx="14.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            {language === 'nl' ? 'Beeld' : 'Image'}
          </button>
          <button className="tool-button" type="button" onClick={onAddText}>
            <svg
              aria-hidden="true"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 5h10M11 5v12M8 17h6" />
            </svg>
            {language === 'nl' ? 'Tekst' : 'Text'}
          </button>
          <button
            className={
              activeDrawer === 'shapes' ? 'tool-button tool-button--active' : 'tool-button'
            }
            type="button"
            onClick={() => toggleDrawer('shapes')}
            aria-expanded={activeDrawer === 'shapes'}
            aria-controls="shape-library-panel"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="11" width="9" height="9" rx="1.5" />
              <circle cx="15.5" cy="6.5" r="4.5" />
            </svg>
            {language === 'nl' ? 'Vormen' : 'Shapes'}
          </button>
          <button
            className={
              activeDrawer === 'spotify' ? 'tool-button tool-button--active' : 'tool-button'
            }
            type="button"
            onClick={() => toggleDrawer('spotify')}
            aria-expanded={activeDrawer === 'spotify'}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="5" cy="11" r="3.2" />
              <path d="M11 9.5v3M13.5 6.5v9M16 8.5v5M18.5 10v2" />
            </svg>
            Spotify
          </button>
        </aside>

        {activeDrawer === 'image' ? (
          <ImageLibraryPanel
            language={language}
            hasActiveAiKey={hasActiveAiKey}
            images={imageLibrary}
            loading={imageLibraryLoading}
            onAskAi={() => {
              onOpenAiGenerate();
            }}
            onFileImport={onSvgFileChange}
            onDotPrintImport={(event) => {
              onDotPrintImport(event);
              setActiveDrawer(null);
            }}
            onUseImage={(img) => {
              onAddLibraryImageToWorkspace(img);
              setActiveDrawer(null);
            }}
            onRenameImage={onRenameLibraryImage}
            onDeleteImage={onDeleteLibraryImage}
          />
        ) : null}

        {activeDrawer === 'shapes' ? (
          <ShapeLibraryPanel
            language={language}
            onAddShape={(shapeKind, options) => {
              onAddShape(shapeKind, options);
              setActiveDrawer(null);
            }}
          />
        ) : null}

        {activeDrawer === 'spotify' ? (
          <SpotifyCodePanel
            language={language}
            replacing={spotifyReplaceTarget?.fileName ?? null}
            onCancelReplace={() => setSpotifyReplaceId(null)}
            onUseCode={(code) => {
              if (spotifyReplaceTarget) onReplaceSpotifyCode(spotifyReplaceTarget.id, code);
              else onAddSpotifyCodeToWorkspace(code);
              setSpotifyReplaceId(null);
              setActiveDrawer(null);
            }}
          />
        ) : null}

        <CanvasViewport
          model={{
            matName,
            materialName,
            matDimensions,
            measurementUnit,
            language,
            xTicks,
            yTicks,
            spacePanReady,
            selectionBarPosition,
            selectedItems,
            canUngroupSelection,
            selectedSvgIds,
            importedSvgs,
            marqueeRect,
            zoom,
            pan,
            selectedMatPreset,
            workpieceWidth,
            workpieceHeight,
            activeCardSize,
            paperColor,
            cardWidth,
            cardHeight,
            isInsertCard,
            insertSlots,
            tools,
            selectedSvgIdSet,
            selectedSvgId,
            editingTextId,
            moveableTargets,
            isDirectItemDragging,
            selectionIsAllText,
            selectionIsAllLines,
            snapSuspended,
            SNAP_SCREEN_PX,
            snapElements,
          }}
          actions={{
            handleViewportPointerDown,
            handleViewportPointerMove,
            handleViewportPointerUp,
            handleViewportPointerCancel,
            onCopySvgs,
            onPasteSvgs,
            onDeleteSvgs,
            onGroupSvgs,
            onUngroupSvg,
            onFlipX,
            onFlipY,
            onMoveLayer,
            handleItemPointerDown,
            handleItemPointerMove,
            stopDirectItemDrag,
            onTextContentChange,
            onExitTextEdit,
            handleMoveableModifierClick,
            handleMoveableDragStart,
            handleMoveableDrag,
            commitMoveableTransforms,
            handleMoveableDragGroupStart,
            handleMoveableDragGroup,
            handleMoveableScaleStart,
            handleMoveableScale,
            handleMoveableScaleGroupStart,
            handleMoveableScaleGroup,
            handleMoveableRotateStart,
            handleMoveableRotate,
            handleMoveableRotateGroupStart,
            handleMoveableRotateGroup,
            zoomFromCenter,
            resetZoomToActualSize,
          }}
          refs={{
            viewportRef,
            selectionBarRef,
            workpieceTransformRef,
            snapGuideLayerRef,
            moveableRef,
          }}
        />

        <WorkspaceInspector
          model={{
            projectMessage,
            importMessage,
            language,
            selectedSvgIds,
            importedSvgs,
            tools,
            selectedMaterialId,
            cardSize,
            insertSlots,
            selectedMatPreset,
            paperColor,
            systemFonts,
            measurementUnit,
            editingTextId,
            selectedSvgIdSet,
          }}
          actions={{
            onMaterialChange,
            onCardSizeChange,
            onInsertSlotsChange,
            onMatChange,
            t,
            onPaperColorChange,
            recolorMatchingObjects,
            onToolsChange,
            onTextContentChange,
            onChangeObjectColor,
            onDotPrintChange,
            openSpotifyReplace,
            onEnterTextEdit,
            onAlign,
            onDistribute,
            onShapeCornerRadiusChange,
            onPenFillChange,
            onHollowChange,
            onDashChange,
            onOutlineChange,
            onOutlineDetach,
            onReorderLayerToTarget,
            onSelectSvg,
            onRenameObject,
          }}
          refs={{ pendingRenameRef }}
        />
      </section>
    </main>
  );
}
