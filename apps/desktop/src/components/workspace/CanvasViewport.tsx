import type { PointerEvent } from 'react';
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
import { type WorkspaceTool, getBehindColor } from '../../project-file';
import type { WorkspaceSvgItem, WorkspaceTextContent } from '../../workspace-objects';
import { type Language } from '../../i18n';
import {
  WORKSPACE_PIXELS_PER_INCH,
  type MeasurementUnit,
  type Point,
  getMatKind,
  type CardSize,
  formatLength,
  getViewportTransform,
  getWorkspaceItemTransform,
  getWorkspaceItemVisualSize,
} from '../../workspace-utils';
import { Ruler } from './Ruler';
import { SelectionActionBar } from './SelectionActionBar';
import { TextEditOverlay } from './TextEditOverlay';
import { WorkspaceObjectArtwork } from './WorkspaceObjectArtwork';
import {
  SNAP_ALL_DIRECTIONS,
  WorkspaceMat,
  WorkspaceCardGuides,
  InsertSlotsOverlay,
} from './workspace-render-helpers';
export interface CanvasViewportModel {
  matName: string;
  materialName: string;
  matDimensions: import('../../workspace-utils').MatDimensions;
  measurementUnit: MeasurementUnit;
  language: Language;
  xTicks: import('../../workspace-utils').MeasurementTick[];
  yTicks: import('../../workspace-utils').MeasurementTick[];
  spacePanReady: boolean;
  selectionBarPosition: { left: number; top: number } | null;
  selectedItems: import('../../workspace-objects').WorkspaceObject[];
  canUngroupSelection: boolean;
  selectedSvgIds: string[];
  importedSvgs: WorkspaceSvgItem[];
  marqueeRect: { left: number; top: number; width: number; height: number } | null;
  zoom: number;
  pan: Point;
  selectedMatPreset: string;
  workpieceWidth: number;
  workpieceHeight: number;
  activeCardSize: CardSize | null;
  paperColor: string;
  cardWidth: number;
  cardHeight: number;
  isInsertCard: boolean;
  insertSlots: boolean;
  tools: WorkspaceTool[];
  selectedSvgIdSet: Set<string>;
  selectedSvgId: string | null;
  editingTextId: string | null;
  moveableTargets: HTMLElement[];
  isDirectItemDragging: boolean;
  selectionIsAllText: boolean;
  selectionIsAllLines: boolean;
  snapSuspended: boolean;
  SNAP_SCREEN_PX: 6;
  snapElements: HTMLElement[];
}
export interface CanvasViewportActions {
  handleViewportPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handleViewportPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handleViewportPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  handleViewportPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onCopySvgs: () => boolean;
  onPasteSvgs: () => boolean;
  onDeleteSvgs: () => boolean;
  onGroupSvgs: () => boolean;
  onUngroupSvg: () => boolean;
  onFlipX: () => boolean;
  onFlipY: () => boolean;
  onMoveLayer: (mode: 'forward' | 'backward' | 'front' | 'back') => boolean;
  handleItemPointerDown: (event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) => void;
  handleItemPointerMove: (event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) => void;
  stopDirectItemDrag: (event: PointerEvent<HTMLDivElement>, item: WorkspaceSvgItem) => void;
  onTextContentChange: (ids: string | string[], patch: Partial<WorkspaceTextContent>) => void;
  onExitTextEdit: (id: string) => void;
  handleMoveableModifierClick: (event: OnClick | OnClickGroup) => void;
  handleMoveableDragStart: (event: OnDragStart) => void;
  handleMoveableDrag: (event: OnDrag) => void;
  commitMoveableTransforms: () => void;
  handleMoveableDragGroupStart: (event: OnDragGroupStart) => void;
  handleMoveableDragGroup: (event: OnDragGroup) => void;
  handleMoveableScaleStart: (event: OnScaleStart) => void;
  handleMoveableScale: (event: OnScale) => void;
  handleMoveableScaleGroupStart: (event: OnScaleGroupStart) => void;
  handleMoveableScaleGroup: (event: OnScaleGroup) => void;
  handleMoveableRotateStart: (event: OnRotateStart) => void;
  handleMoveableRotate: (event: OnRotate) => void;
  handleMoveableRotateGroupStart: (event: OnRotateGroupStart) => void;
  handleMoveableRotateGroup: (event: OnRotateGroup) => void;
  zoomFromCenter: (nextZoomRaw: number) => void;
  resetZoomToActualSize: () => void;
}
export interface CanvasViewportRefs {
  viewportRef: import('react').RefObject<HTMLDivElement | null>;
  selectionBarRef: import('react').RefObject<HTMLDivElement | null>;
  workpieceTransformRef: import('react').RefObject<HTMLDivElement | null>;
  snapGuideLayerRef: import('react').RefObject<HTMLDivElement | null>;
  moveableRef: import('react').RefObject<Moveable<{}> | null>;
}
export interface CanvasViewportProps {
  model: CanvasViewportModel;
  actions: CanvasViewportActions;
  refs: CanvasViewportRefs;
}
export function CanvasViewport({ model, actions, refs }: CanvasViewportProps) {
  const {
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
  } = model;
  const {
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
  } = actions;
  const { viewportRef, selectionBarRef, workpieceTransformRef, snapGuideLayerRef, moveableRef } =
    refs;
  return (
    <section className="workspace-stage no-drag">
      <div className="stage-statusbar">
        <strong>{matName}</strong>
        <span>{materialName}</span>
        <span>
          {formatLength(matDimensions.width, measurementUnit, language).replace(/ \S+$/, '')} ×{' '}
          {formatLength(matDimensions.height, measurementUnit, language)}
        </span>
      </div>
      <div className="ruler-corner">0</div>
      <Ruler axis="x" ticks={xTicks} unit={measurementUnit} />
      <Ruler axis="y" ticks={yTicks} unit={measurementUnit} />
      <div
        ref={viewportRef}
        className="viewport"
        style={spacePanReady ? { cursor: 'grab' } : undefined}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="infinite-grid" />
        {selectionBarPosition ? (
          <div
            ref={selectionBarRef}
            className="selection-bar"
            style={{ left: selectionBarPosition.left, top: selectionBarPosition.top }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <SelectionActionBar
              language={language}
              canGroup={
                selectedItems.length >= 2 &&
                !selectedItems.some(
                  (item) => item.textContent || item.dotPrint || item.dashed?.enabled,
                )
              }
              canUngroup={canUngroupSelection}
              canReorder={selectedSvgIds.length === 1 && importedSvgs.length > 1}
              onDuplicate={() => {
                if (onCopySvgs()) onPasteSvgs();
              }}
              onDelete={onDeleteSvgs}
              onGroup={onGroupSvgs}
              onUngroup={onUngroupSvg}
              onFlipX={onFlipX}
              onFlipY={onFlipY}
              onBringForward={() => onMoveLayer('forward')}
              onSendBackward={() => onMoveLayer('backward')}
            />
          </div>
        ) : null}
        {marqueeRect ? (
          <div
            className="marquee-box"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        ) : null}
        <div
          ref={workpieceTransformRef}
          className="workpiece-transform"
          style={{ transform: getViewportTransform({ zoom, pan }) }}
        >
          <WorkspaceMat
            kind={getMatKind(selectedMatPreset)}
            width={workpieceWidth}
            height={workpieceHeight}
          />
          {(() => {
            const gridPx =
              measurementUnit === 'in'
                ? WORKSPACE_PIXELS_PER_INCH * 0.25
                : measurementUnit === 'cm'
                  ? (WORKSPACE_PIXELS_PER_INCH * 0.5) / 2.54
                  : (WORKSPACE_PIXELS_PER_INCH * 5) / 25.4;
            const gridStyle = {
              backgroundImage:
                'linear-gradient(rgba(41,37,33,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(41,37,33,0.06) 1px,transparent 1px)',
              backgroundSize: `${gridPx}px ${gridPx}px`,
              backgroundPosition: '-1px -1px',
            };
            const squareCorners = getMatKind(selectedMatPreset) === 'card';
            const emptyState =
              importedSvgs.length === 0 ? (
                <div className="empty-workpiece">
                  <strong>{language === 'nl' ? 'Leeg project' : 'Blank project'}</strong>
                  <span>
                    {language === 'nl'
                      ? 'Kies een vorm of voeg een eigen ontwerp toe.'
                      : 'Choose a shape or add your own design.'}
                  </span>
                </div>
              ) : null;
            return (
              <div
                className="workpiece-paper"
                style={{
                  width: workpieceWidth,
                  height: workpieceHeight,
                  borderRadius: squareCorners ? 0 : undefined,
                  // With a card size chosen, only that area is paper; the rest of the
                  // sheet shows the plain workspace background — but the grid spans both.
                  backgroundColor: activeCardSize ? 'rgb(243,242,239)' : paperColor,
                  ...gridStyle,
                }}
              >
                {activeCardSize ? (
                  // The card area: paper colour on top, and it hosts the empty-state
                  // text so the message is centred in the selected card size.
                  <div
                    className="workpiece-card-paper"
                    style={{
                      width: cardWidth,
                      height: cardHeight,
                      backgroundColor: paperColor,
                      borderRadius: squareCorners ? 0 : undefined,
                      ...gridStyle,
                    }}
                  >
                    {emptyState}
                  </div>
                ) : (
                  emptyState
                )}
              </div>
            );
          })()}
          {getMatKind(selectedMatPreset) === 'card' ? (
            <WorkspaceCardGuides
              width={workpieceWidth}
              height={workpieceHeight}
              activeCardSize={activeCardSize}
            />
          ) : null}
          {isInsertCard && insertSlots ? (
            <InsertSlotsOverlay
              width={cardWidth}
              height={cardHeight}
              color={getBehindColor(tools)}
            />
          ) : null}
          <div
            className="workspace-image-layer"
            style={{ width: workpieceWidth, height: workpieceHeight }}
            aria-label={language === 'nl' ? 'Afbeeldingslaag' : 'Image layer'}
          >
            {importedSvgs.length > 0
              ? importedSvgs.map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    data-workspace-item-id={item.id}
                    className={`workspace-image-item${selectedSvgIdSet.has(item.id) ? ' workspace-image-item--selected' : ''}${item.id === selectedSvgId ? ' workspace-image-item--primary-selected' : ''}${editingTextId === item.id ? ' workspace-image-item--text-editing' : ''}`}
                    style={{
                      width: getWorkspaceItemVisualSize(item.frame, item.transform).width,
                      height: getWorkspaceItemVisualSize(item.frame, item.transform).height,
                      transform: getWorkspaceItemTransform(item.transform),
                    }}
                    aria-label={
                      language === 'nl'
                        ? `${item.fileName} kiezen en verplaatsen`
                        : `Select and move ${item.fileName}`
                    }
                    onPointerDown={(event) => handleItemPointerDown(event, item)}
                    onPointerMove={(event) => handleItemPointerMove(event, item)}
                    onPointerUp={(event) => stopDirectItemDrag(event, item)}
                    onPointerCancel={(event) => stopDirectItemDrag(event, item)}
                    onContextMenu={(event) => event.preventDefault()}
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
              : null}
            <div ref={snapGuideLayerRef} className="snap-guides" aria-hidden="true" />
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
                renderDirections={
                  selectionIsAllLines ? ['w', 'e'] : ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']
                }
                snappable={!snapSuspended}
                snapThreshold={SNAP_SCREEN_PX / Math.max(0.01, zoom)}
                snapDirections={SNAP_ALL_DIRECTIONS}
                elementSnapDirections={SNAP_ALL_DIRECTIONS}
                elementGuidelines={snapElements}
                verticalGuidelines={[0, cardWidth / 2, cardWidth]}
                horizontalGuidelines={[0, cardHeight / 2, cardHeight]}
                snapGap={false}
                isDisplaySnapDigit={false}
                isDisplayInnerSnapDigit={false}
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
      <div className="zoom-controls no-drag" aria-label={language === 'nl' ? 'Zoom' : 'Zoom'}>
        <button type="button" onClick={() => zoomFromCenter(zoom - 0.1)}>
          −
        </button>
        <button type="button" onClick={resetZoomToActualSize}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomFromCenter(zoom + 0.1)}>
          ＋
        </button>
      </div>
    </section>
  );
}
