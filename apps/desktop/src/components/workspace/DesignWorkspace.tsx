import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent, PointerEvent, ReactNode, WheelEvent } from "react";
import Moveable from "react-moveable";
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
} from "react-moveable";
import { APP_NAME } from "../../onboarding-copy";
import {
  type WorkspaceTool,
  getBehindColor,
  getPens,
  nextPenColor,
  withBehindColor,
  withPens,
} from "../../project-file";
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
  getMatKind,
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
import { FONT_GROUPS } from "../../font-catalog";
import { Ruler } from "./Ruler";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { TextEditOverlay } from "./TextEditOverlay";
import { WorkspaceObjectArtwork } from "./WorkspaceObjectArtwork";
import { ImageLibraryPanel } from "../panels/ImageLibraryPanel";
import { ShapeLibraryPanel } from "../panels/ShapeLibraryPanel";
import { EmptyImportState } from "../screens/ImportPanel";

// ── Small presentational helpers for the Card-colors / Pens / picker UI ───────

function PaperIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/></svg>;
}
function BehindIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="9" height="9" rx="1.5"/><path d="M6 11v2.5A1.5 1.5 0 0 0 7.5 15H13a1.5 1.5 0 0 0 1.5-1.5V8A1.5 1.5 0 0 0 13 6.5h-2"/></svg>;
}
function ScissorsIcon() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="3.5" cy="4.5" r="1.8"/><circle cx="3.5" cy="11.5" r="1.8"/><path d="M5.2 5.6 14 11M5.2 10.4 14 5"/></svg>;
}

/**
 * A pointy-top (Stabilo-style) hexagon swatch drawn as SVG so it can have softly
 * rounded corners AND an inset 2px border with a 1px gap — matching the card-colour
 * pickers — without changing the overall footprint.
 */
function HexShape({ color, add, warn }: { color?: string; add?: boolean; warn?: boolean }) {
  const cx = 19;
  const cy = 22;
  const s = Math.sqrt(3) / 2;
  const hex = (r: number) => {
    const pts: Array<[number, number]> = [
      [cx, cy - r], [cx + r * s, cy - r / 2], [cx + r * s, cy + r / 2],
      [cx, cy + r], [cx - r * s, cy + r / 2], [cx - r * s, cy - r / 2],
    ];
    return pts.map(([x, y]) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`).join(" ");
  };
  const borderColor = warn ? "#d9a300" : add ? "rgba(121,82,51,0.45)" : "rgba(121,82,51,0.4)";
  return (
    <svg className="pen-hex__svg" viewBox="0 0 38 44" width="38" height="44" aria-hidden="true">
      {/* Outer border (2px), rounded joins; the transparent ring to the fill is the 1px gap */}
      <polygon points={hex(20)} fill={add ? "rgba(121,82,51,0.07)" : "none"} stroke={borderColor} strokeWidth="2" strokeLinejoin="round" />
      {!add && color && (
        <polygon points={hex(17)} fill={color} stroke={color} strokeWidth="2" strokeLinejoin="round" />
      )}
      {add && <path d="M19 14.5v15M11.5 22h15" stroke="rgba(121,82,51,0.7)" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

/** A labelled native colour picker styled as a swatch chip. */
function ColorRow({ icon, label, color, onChange, title }: {
  icon: ReactNode;
  label?: string;
  color: string;
  onChange: (color: string) => void;
  title?: string;
}) {
  return (
    <label className="color-row" title={title}>
      <span className="color-row__icon" aria-hidden="true">{icon}</span>
      {label ? <span className="color-row__label">{label}</span> : null}
      <span className="color-row__chip" style={{ backgroundColor: color }}>
        <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

/**
 * Per-object tool picker: a distinct Cut box (behind colour) on top, then the pens
 * shown as selectable hexagons below — mirroring the workpiece pen palette.
 * Picking sets the object's colour.
 */
function SwatchPicker({ tools, selectedColor, onPick, language }: {
  tools: WorkspaceTool[];
  selectedColor: string;
  onPick: (color: string) => void;
  language: Language;
}) {
  const nl = language === "nl";
  const pens = getPens(tools);
  const behind = getBehindColor(tools);
  const sel = (selectedColor ?? "").toLowerCase();
  const cutActive = behind.toLowerCase() === sel;
  return (
    <div className="tool-picker" role="group">
      <button
        type="button"
        className={`swatch-btn${cutActive ? " swatch-btn--active" : ""}`}
        onClick={() => onPick(behind)}
        aria-pressed={cutActive}
        title={nl ? "Snijden" : "Cut"}
      >
        <span className="swatch-btn__chip" style={{ backgroundColor: behind }} />
        <span className="swatch-btn__icon" aria-hidden="true"><ScissorsIcon /></span>
        <span className="swatch-btn__label">{nl ? "Snijden" : "Cut"}</span>
      </button>

      <p className="tool-picker__label">{nl ? "Pennen" : "Pens"}</p>
      <div className="tool-picker__pens">
        {pens.map((pen, i) => {
          const active = pen.color.toLowerCase() === sel;
          return (
            <button
              key={pen.id}
              type="button"
              className={`pen-hex-btn${active ? " pen-hex-btn--active" : ""}`}
              onClick={() => onPick(pen.color)}
              aria-pressed={active}
              title={`${nl ? "Pen" : "Pen"} ${i + 1}`}
            >
              <HexShape color={pen.color} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Card-size guide rectangles (physical card blanks), drawn as dotted outlines on
// the CardMat. Sizes in inches → workspace px via WORKSPACE_PIXELS_PER_INCH.
const CARD_GUIDES = [
  { w: 4.25 * WORKSPACE_PIXELS_PER_INCH, h: 5.5 * WORKSPACE_PIXELS_PER_INCH }, // 108 × 140 mm
  { w: 3.5 * WORKSPACE_PIXELS_PER_INCH, h: 4.9 * WORKSPACE_PIXELS_PER_INCH },  // 89 × 124 mm
];

/**
 * Decorative representation of the physical Cricut Joy mat, framing the paper.
 * Purely visual (pointer-events:none); sits behind the paper inside the zoom/pan
 * transform so it scales and moves with the workpiece. `width`/`height` are the
 * paper's pixel size; the mat extends beyond it by fixed bands.
 */
function WorkspaceMat({ kind, width, height }: { kind: "standard" | "card"; width: number; height: number }) {
  const SIDE = 33;
  const TOP = kind === "card" ? 90 : 80;
  const BOTTOM = kind === "card" ? 78 : 80;
  const style = {
    top: -TOP,
    left: -SIDE,
    width: width + SIDE * 2,
    height: height + TOP + BOTTOM,
  };
  if (kind === "card") {
    return (
      <div className="workpiece-mat workpiece-mat--card" style={style} aria-hidden="true">
        {/* Raised bands align with the paper column, not the full mat width */}
        <div className="workpiece-mat__band workpiece-mat__band--top" style={{ height: TOP, left: SIDE, width }}>
          <span className="workpiece-mat__arrow">▲</span>
          <span className="workpiece-mat__label workpiece-mat__label--right">CardMat</span>
        </div>
        <div className="workpiece-mat__band workpiece-mat__band--bottom" style={{ height: BOTTOM, left: SIDE, width }} />
      </div>
    );
  }
  return (
    <div className="workpiece-mat workpiece-mat--standard" style={style} aria-hidden="true">
      {/* Labels align to the paper edges on the x-axis (inset by SIDE). */}
      <span className="workpiece-mat__label workpiece-mat__label--right" style={{ top: (TOP - 20) / 2, right: SIDE }}>Standard</span>
      <span className="workpiece-mat__label workpiece-mat__label--bottom-left" style={{ bottom: (BOTTOM - 20) / 2, left: SIDE }}>Standard</span>
    </div>
  );
}

/**
 * CardMat card-size guides, drawn as dotted rectangles ON the paper (above it,
 * below the design items). Anchored at the paper's top-left (0,0) corner — cards
 * align to that corner — and nested from there.
 */
function WorkspaceCardGuides({ width, height }: { width: number; height: number }) {
  return (
    <div className="workpiece-card-guides" style={{ width, height }} aria-hidden="true">
      {CARD_GUIDES.map((g, i) => (
        <div
          key={i}
          className="workpiece-mat__card-guide"
          style={{ width: g.w, height: g.h, left: 0, top: 0 }}
        />
      ))}
    </div>
  );
}

/**
 * Tiny mat illustration for the mat picker buttons. Green long/short show a gridded
 * green middle; the blue card shows raised bands + a white middle. Both have a small
 * white line where the mat text sits.
 */
function MatIcon({ variant }: { variant: "long" | "short" | "card" }) {
  const height = variant === "long" ? 80 : variant === "short" ? 43 : 42;
  if (variant === "card") {
    return (
      <span className="mat-icon mat-icon--card" style={{ height }} aria-hidden="true">
        <span className="mat-icon__band mat-icon__band--top" />
        <span className="mat-icon__paper" />
        <span className="mat-icon__band mat-icon__band--bottom" />
        <span className="mat-icon__line" />
      </span>
    );
  }
  return (
    <span className={`mat-icon mat-icon--${variant}`} style={{ height }} aria-hidden="true">
      <span className="mat-icon__grid" />
      <span className="mat-icon__line" />
    </span>
  );
}

// Material categories → slicebug material IDs.
const PAPER_MATERIAL_IDS = [218, 19, 211]; // light, medium, heavy
const MATERIAL_INSERT_ID = 535;
const MATERIAL_VINYL_ID = 20;

function materialCategoryOf(id: number): "paper" | "insert" | "vinyl" {
  if (id === MATERIAL_INSERT_ID) return "insert";
  if (id === MATERIAL_VINYL_ID) return "vinyl";
  return "paper";
}

/** Colored glyph for a material category. */
function MaterialIcon({ kind }: { kind: "paper" | "insert" | "vinyl" }) {
  return (
    <span className={`material-icon material-icon--${kind}`} aria-hidden="true">
      {kind === "paper" && (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3"/></svg>
      )}
      {kind === "insert" && (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6 C8 4.8 5.5 4.8 3.5 5.5 L3.5 14.5 C5.5 13.8 8 13.8 10 15"/><path d="M10 6 C12 4.8 14.5 4.8 16.5 5.5 L16.5 14.5 C14.5 13.8 12 13.8 10 15"/></svg>
      )}
      {kind === "vinyl" && (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <g transform="rotate(-45 10 10)">
            <path d="M6 6 H12.5"/>
            <path d="M6 14 H12.5"/>
            <path d="M12.5 6 A2 4 0 0 1 12.5 14"/>
            <ellipse cx="6" cy="10" rx="2" ry="4"/>
            <ellipse cx="6" cy="10" rx="0.8" ry="1.7"/>
          </g>
        </svg>
      )}
    </span>
  );
}

/** Stacked-sheet thickness glyph for a paper weight. */
function WeightIcon({ level }: { level: "light" | "medium" | "heavy" }) {
  const layers = level === "light" ? 1 : level === "medium" ? 2 : 3;
  return (
    <span className="weight-icon" aria-hidden="true">
      {Array.from({ length: layers }).map((_, i) => <span key={i} className="weight-icon__layer" />)}
    </span>
  );
}

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
  paperColor,
  onPaperColorChange,
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
  paperColor: string;
  onPaperColorChange: (color: string) => void;
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
  onMoveLayer: (mode: "forward" | "backward" | "front" | "back") => boolean;
  onReorderLayerToTarget: (draggedId: string, targetId: string) => void;
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
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
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
  // Text renders with preserveAspectRatio="meet" (never stretches) and is cut from a
  // re-measured frame, so a non-uniform scale would make display, edit overlay, and cut
  // disagree. Force uniform scaling whenever the whole selection is text.
  const selectionIsAllText = selectedItems.length > 0 && selectedItems.every((item) => Boolean(item.textContent));

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

  // Zoom while keeping the world point under (cx, cy) — viewport-local pixels — fixed.
  function zoomAroundPoint(nextZoomRaw: number, cx: number, cy: number) {
    const nextZoom = clampZoom(nextZoomRaw);
    if (nextZoom === zoom) return;
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

  // Centre the mat when the workspace first opens (after layout is measured).
  useEffect(() => {
    const id = requestAnimationFrame(() => centerMatInViewport(zoom));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const sensitivity = event.deltaMode === 0 ? 0.01 : 0.005;
      const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
      zoomAroundPoint(zoom - event.deltaY * sensitivity, event.clientX - rect.left, event.clientY - rect.top);
      return;
    }
    recentScrollRef.current = true;
    if (recentScrollTimerRef.current) clearTimeout(recentScrollTimerRef.current);
    recentScrollTimerRef.current = setTimeout(() => { recentScrollRef.current = false; }, 300);
    setPan((current) => clampPan({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
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
    setPan(clampPan({ x: dragStart.current.pan.x + deltaX, y: dragStart.current.pan.y + deltaY }));
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current?.pointerId === event.pointerId) {
      dragStart.current = null;
    }
  }

  // Add the id if it isn't selected, remove it if it is.
  function toggleLayerSelection(id: string) {
    if (selectedSvgIdSet.has(id)) {
      onSelectSvgGroup(selectedSvgIds.filter((x) => x !== id));
    } else {
      onSelectSvgGroup([...selectedSvgIds, id]);
    }
  }

  // Modifier-clicking a *selected* item lands on the Moveable control box (which
  // overlays the selection), not the item — so toggle deselection from here too.
  function handleMoveableModifierClick(event: OnClick | OnClickGroup) {
    const native = event.inputEvent as MouseEvent | undefined;
    if (!native || !(native.metaKey || native.ctrlKey || native.shiftKey)) return;
    const el = (event.inputTarget as Element | null)?.closest?.("[data-workspace-item-id]") as HTMLElement | null;
    const id = el?.dataset.workspaceItemId;
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

  // When a pen / behind colour changes, recolour every object currently using the
  // old colour so the canvas stays WYSIWYG (a cut shape follows the behind colour, etc.).
  function recolorMatchingObjects(oldColor: string, newColor: string) {
    if (oldColor.toLowerCase() === newColor.toLowerCase()) return;
    importedSvgs.forEach((obj) => {
      if (obj.paths.some((p) => (p.stroke ?? "").toLowerCase() === oldColor.toLowerCase())) {
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
          canReorder={selectedSvgIds.length === 1 && importedSvgs.length > 1}
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
          onBringForward={() => onMoveLayer("forward")}
          onSendBackward={() => onMoveLayer("backward")}
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
              <WorkspaceMat kind={getMatKind(selectedMatPreset)} width={workpieceWidth} height={workpieceHeight} />
              <div
                className="workpiece-paper"
                style={{
                  width: workpieceWidth,
                  height: workpieceHeight,
                  // Card stock has square corners; the standard mat keeps the soft radius.
                  borderRadius: getMatKind(selectedMatPreset) === "card" ? 0 : undefined,
                  backgroundColor: paperColor,
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
              {getMatKind(selectedMatPreset) === "card" ? (
                <WorkspaceCardGuides width={workpieceWidth} height={workpieceHeight} />
              ) : null}
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
                          onChange={(text) => onTextContentChange(item.id, { text })}
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
                {moveableTargets.length > 0 && !isDirectItemDragging && !editingTextId ? (
                  <Moveable
                    ref={moveableRef}
                    target={moveableTargets.length === 1 ? moveableTargets[0] : moveableTargets}
                    draggable
                    scalable
                    rotatable
                    groupable={moveableTargets.length > 1}
                    origin={false}
                    keepRatio={selectionIsAllText}
                    throttleDrag={0}
                    throttleScale={0}
                    throttleRotate={0}
                    zoom={1 / Math.max(0.01, zoom)}
                    renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
                    onClick={handleMoveableModifierClick}
                    onClickGroup={handleMoveableModifierClick}
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
            <button type="button" onClick={() => zoomFromCenter(zoom - 0.1)}>−</button>
            <button type="button" onClick={resetZoomToActualSize}>{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => zoomFromCenter(zoom + 0.1)}>＋</button>
          </div>
        </section>

        <aside className="project-drawer no-drag">
          {projectMessage ? <p className="ok project-message">{projectMessage}</p> : null}
          {importMessage ? <p className="warn">{importMessage}</p> : null}

          <div className="drawer-section">
            {(() => {
              const nl = language === "nl";
              const sel = selectedSvgId ? importedSvgs.find((x) => x.id === selectedSvgId) ?? null : null;
              const pens = getPens(tools);
              const behindColor = getBehindColor(tools);

              if (!sel) return (
                <>
                  <p className="drawer-section__title">{nl ? "Werkstuk" : "Workpiece"}</p>
                  <div className="object-settings">
                    <div className="object-settings__row object-settings__row--mat object-settings__row--first">
                      <label className="object-settings__label">{nl ? "Materiaal" : "Material"}</label>
                      <div className="mat-picker" role="group">
                        {([
                          { key: "paper" as const, label: nl ? "Papier" : "Paper", defaultId: 218 },
                          { key: "insert" as const, label: nl ? "Inlegkaart" : "Insert card", defaultId: MATERIAL_INSERT_ID },
                          { key: "vinyl" as const, label: "Vinyl", defaultId: MATERIAL_VINYL_ID },
                        ]).map((c) => {
                          const active = materialCategoryOf(selectedMaterialId) === c.key;
                          return (
                            <button
                              key={c.key}
                              type="button"
                              className={`material-btn${active ? " material-btn--active" : ""}`}
                              onClick={() => onMaterialChange(c.key === "paper" && PAPER_MATERIAL_IDS.includes(selectedMaterialId) ? selectedMaterialId : c.defaultId)}
                              aria-pressed={active}
                              title={c.label}
                            >
                              <MaterialIcon kind={c.key} />
                              <span className="mat-btn__label">{c.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      {materialCategoryOf(selectedMaterialId) === "paper" ? (
                        <div className="weight-picker">
                          <span className="weight-picker__caption">{nl ? "Dikte" : "Weight"}</span>
                          <div className="weight-seg" role="group">
                            {([
                              { id: 218, label: nl ? "Licht" : "Light", level: "light" as const },
                              { id: 19, label: nl ? "Middel" : "Medium", level: "medium" as const },
                              { id: 211, label: nl ? "Zwaar" : "Heavy", level: "heavy" as const },
                            ]).map((w) => (
                              <button
                                key={w.id}
                                type="button"
                                className={`weight-seg__btn${selectedMaterialId === w.id ? " weight-seg__btn--active" : ""}`}
                                onClick={() => onMaterialChange(w.id)}
                                aria-pressed={selectedMaterialId === w.id}
                                title={w.label}
                              >
                                <WeightIcon level={w.level} />
                                <span>{w.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="object-settings__row object-settings__row--mat">
                      <label className="object-settings__label">{nl ? "Mat" : "Mat"}</label>
                      <div className="mat-picker" role="group">
                        {([
                          { id: "joy-standard", variant: "long" as const, label: nl ? "Lang" : "Long" },
                          { id: "joy-standard-short", variant: "short" as const, label: nl ? "Kort" : "Short" },
                          { id: "joy-card", variant: "card" as const, label: nl ? "Kaart" : "Card" },
                        ]).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`mat-btn${selectedMatPreset === m.id ? " mat-btn--active" : ""}`}
                            onClick={() => onMatChange(m.id)}
                            aria-pressed={selectedMatPreset === m.id}
                            title={getMatName(m.id, language) ?? m.id}
                          >
                            <span className="mat-btn__icon"><MatIcon variant={m.variant} /></span>
                            <span className="mat-btn__label">{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="drawer-section__title" style={{ marginTop: 16 }}>{t("colors.sectionTitle")}</p>
                  <div className="color-rows">
                    <ColorRow
                      icon={<PaperIcon />}
                      label={t("colors.paper")}
                      color={paperColor}
                      onChange={onPaperColorChange}
                    />
                    <ColorRow
                      icon={<BehindIcon />}
                      label={t("colors.behind")}
                      color={behindColor}
                      onChange={(c) => { recolorMatchingObjects(behindColor, c); onToolsChange(withBehindColor(tools, c)); }}
                    />
                  </div>

                  <p className="drawer-section__title" style={{ marginTop: 16 }}>{t("pens.sectionTitle")}</p>
                  {(() => {
                    const clashing = pens.some(
                      (p) => p.color.toLowerCase() === paperColor.toLowerCase() || p.color.toLowerCase() === behindColor.toLowerCase(),
                    );
                    // A pen is a duplicate if an EARLIER pen already uses its colour.
                    const isDuplicatePen = (index: number) =>
                      pens.some((p, j) => j < index && p.color.toLowerCase() === pens[index]!.color.toLowerCase());
                    const hasDuplicatePens = pens.some((_, i) => isDuplicatePen(i));
                    // Fix: drop later pens whose colour already appears earlier. Objects keep
                    // their colour (identical to the kept pen), so they auto-map to the first one.
                    const dedupePens = () => {
                      const seen = new Set<string>();
                      const deduped = pens.filter((p) => {
                        const key = p.color.toLowerCase();
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                      });
                      onToolsChange(withPens(tools, deduped));
                    };
                    return (
                      <>
                        <div className="pen-hexes">
                          {pens.map((pen, index) => {
                            const clash = pen.color.toLowerCase() === paperColor.toLowerCase() || pen.color.toLowerCase() === behindColor.toLowerCase() || isDuplicatePen(index);
                            return (
                              <span key={pen.id} className="pen-hex-wrap">
                                <label
                                  className="pen-hex"
                                  title={nl ? "Penkleur wijzigen" : "Change pen color"}
                                >
                                  <HexShape color={pen.color} warn={clash} />
                                  <input
                                    type="color"
                                    value={pen.color}
                                    onChange={(e) => {
                                      const c = e.target.value;
                                      recolorMatchingObjects(pen.color, c);
                                      onToolsChange(withPens(tools, pens.map((p) => (p.id === pen.id ? { ...p, color: c } : p))));
                                    }}
                                  />
                                </label>
                                {pens.length > 1 && (
                                  <button
                                    type="button"
                                    className="pen-hex__remove"
                                    aria-label={t("pens.remove")}
                                    title={t("pens.remove")}
                                    onClick={() => onToolsChange(withPens(tools, pens.filter((p) => p.id !== pen.id)))}
                                  >
                                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
                                  </button>
                                )}
                              </span>
                            );
                          })}
                          <button
                            type="button"
                            className="pen-hex pen-hex--add"
                            aria-label={t("pens.add")}
                            title={t("pens.add")}
                            onClick={() => {
                              // Next unused palette colour, also avoiding the paper/behind
                              // colours so a fresh pen never triggers a warning.
                              const color = nextPenColor([...pens.map((p) => p.color), paperColor, behindColor]);
                              onToolsChange(withPens(tools, [...pens, { id: `pen-${Date.now()}`, color, type: "pen" }]));
                            }}
                          >
                            <HexShape add />
                          </button>
                        </div>
                        {clashing && (
                          <p className="pen-hex-warn">⚠ {nl ? "Een pen heeft dezelfde kleur als het papier of de kleur erachter." : "A pen is the same color as the paper or behind color."}</p>
                        )}
                        {hasDuplicatePens && (
                          <p className="pen-hex-warn">
                            ⚠ {t("warn.penDuplicate")}
                            <button type="button" className="pen-hex-warn__fix" onClick={dedupePens}>
                              {t("pens.fix")}
                            </button>
                          </p>
                        )}
                      </>
                    );
                  })()}
                </>
              );

              // Text object selected — show text controls + cut/draw picker
              if (sel.textContent) {
                const tc = sel.textContent;
                return (
                  <>
                    <p className="drawer-section__title">{nl ? "Tekst" : "Text"}</p>
                    <div className="object-settings">
                      <div className="object-settings__row object-settings__row--swatches">
                        <label className="object-settings__label">{t("object.tool")}</label>
                        <SwatchPicker
                          tools={tools}
                          selectedColor={tc.color}
                          onPick={(c) => onTextContentChange(sel.id, { color: c })}
                          language={language}
                        />
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
                          {FONT_GROUPS.map((g) => (
                            <optgroup key={g.key} label={nl ? g.nl : g.en}>
                              {g.families.map((f) => (
                                <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>
                              ))}
                            </optgroup>
                          ))}
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
                          {(() => {
                            // Alignment only matters across multiple lines (a single line auto-hugs
                            // its box), so disable the buttons until the text has a line break.
                            const isMultiLine = tc.text.includes("\n");
                            const disabledTip = nl
                              ? "Alleen voor tekst met meerdere regels"
                              : "Only available for multi-line text";
                            return (["left","center","right"] as const).map((align) => (
                              <button key={align} type="button" disabled={!isMultiLine}
                                className={`text-style-btn${isMultiLine && (tc.textAlign ?? "left") === align ? " text-style-btn--active" : ""}`}
                                onClick={() => onTextContentChange(sel.id, { textAlign: align })}
                                title={isMultiLine ? align : disabledTip}
                              >
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                                  {align === "left"   && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="2" y1="6" x2="9" y2="6"/><line x1="2" y1="9" x2="11" y2="9"/><line x1="2" y1="12" x2="7" y2="12"/></>}
                                  {align === "center" && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="4" y1="6" x2="10" y2="6"/><line x1="3" y1="9" x2="11" y2="9"/><line x1="5" y1="12" x2="9" y2="12"/></>}
                                  {align === "right"  && <><line x1="2" y1="3" x2="12" y2="3"/><line x1="5" y1="6" x2="12" y2="6"/><line x1="3" y1="9" x2="12" y2="9"/><line x1="7" y1="12" x2="12" y2="12"/></>}
                                </svg>
                              </button>
                            ));
                          })()}
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
                      <div className="object-settings__row object-settings__row--toggle">
                        <label className="object-settings__label" htmlFor="txt-singleline">
                          {nl ? "Eén lijn (pen)" : "Single line (pen)"}
                        </label>
                        <button id="txt-singleline" type="button" role="switch"
                          aria-checked={Boolean(tc.singleLine)}
                          className={`toggle-switch${tc.singleLine ? " toggle-switch--on" : ""}`}
                          onClick={() => onTextContentChange(sel.id, { singleLine: !tc.singleLine })}
                          title={nl
                            ? "Tekst tekenen/snijden als één pennenlijn in plaats van gevulde letters"
                            : "Draw/cut text as a single pen line instead of filled letters"}
                        >
                          <span className="toggle-switch__knob" />
                        </button>
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

              // SVG/shape object selected — show name + cut/draw picker
              const color = sel.paths[0]?.stroke ?? "#000000";
              return (
                <>
                  <p className="drawer-section__title">{nl ? "Geselecteerd" : "Selection"}</p>
                  <div className="object-settings">
                    <p className="object-settings__name">{sel.fileName}</p>
                    <div className="object-settings__row object-settings__row--swatches">
                      <label className="object-settings__label">{t("object.tool")}</label>
                      <SwatchPicker
                        tools={tools}
                        selectedColor={color}
                        onPick={(c) => onChangeObjectColor(sel.id, c)}
                        language={language}
                      />
                    </div>
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
                {/* Shown front-to-back (top of list = front layer), reverse of the array. */}
                {[...importedSvgs].reverse().map((item) => {
                  const isSelected = selectedSvgIdSet.has(item.id);
                  const isExpanded = expandedGroups.has(item.id);
                  const isRenaming = renamingId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`workspace-item-list__row${dragOverLayerId === item.id ? " workspace-item-list__row--dragover" : ""}${dragLayerId === item.id ? " workspace-item-list__row--dragging" : ""}`}
                      draggable={!isRenaming}
                      onDragStart={(e) => { setDragLayerId(item.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.id); }}
                      onDragOver={(e) => { if (dragLayerId && dragLayerId !== item.id) { e.preventDefault(); setDragOverLayerId(item.id); } }}
                      onDragLeave={() => setDragOverLayerId((cur) => (cur === item.id ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragLayerId && dragLayerId !== item.id) onReorderLayerToTarget(dragLayerId, item.id);
                        setDragLayerId(null);
                        setDragOverLayerId(null);
                      }}
                      onDragEnd={() => { setDragLayerId(null); setDragOverLayerId(null); }}
                    >
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
                              {(() => {
                                // Text layers show their actual text; everything else its name.
                                const text = item.textContent?.text?.replace(/\s+/g, " ").trim();
                                if (text) return text.length > 28 ? `${text.slice(0, 28)}…` : text;
                                return item.fileName;
                              })()}
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
