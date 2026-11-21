import { useState } from 'react';
import {
  type WorkspaceTool,
  getBehindColor,
  getPens,
  nextPenColor,
  withBehindColor,
  withPens,
} from '../../project-file';
import type { WorkspaceSvgItem, WorkspaceTextContent } from '../../workspace-objects';
import { type Language, createTranslator, getMatName } from '../../i18n';
import {
  DEFAULT_PEN_FILL,
  PEN_FILL_DENSITY_MAX,
  PEN_FILL_DENSITY_MIN,
  PEN_FILL_PATTERNS,
  DOT_STYLES,
  type DashSettings,
  type DotPrintSettings,
  type OutlineSettings,
  type PenFillSettings,
} from '@cricut-companion/craft-core';
import { canPenFill } from '../../pen-fill-render';
import { canDash } from '../../dash-render';
import { canOutline } from '../../outline-render';
import {
  type MeasurementUnit,
  type CardSize,
  type AlignMode,
  formatLengthPx,
} from '../../workspace-utils';
import { shapeHasCorners } from '../../workspace-shapes';
import { FONT_GROUPS } from '../../font-catalog';
import {
  WeightIcon,
  MatIcon,
  MaterialIcon,
  materialCategoryOf,
  MATERIAL_INSERT_ID,
  MATERIAL_VINYL_ID,
} from './CraftIcons';
import { DotPrintSettingsPanel } from '../panels/DotPrintSettingsPanel';
import { DOT_STYLE_LABELS } from '../panels/dot-style-labels';
import { MoreOptions } from '../panels/MoreOptions';
import { AlignPanel, FoldLinePanel, OutlinePanel } from '../panels/ArrangePanels';
import { EmptyImportState } from '../screens/ImportPanel';
import {
  PEN_FILL_LABELS,
  PenFillSwatch,
  PaperIcon,
  BehindIcon,
  HexShape,
  ColorRow,
  SwatchPicker,
} from './workspace-render-helpers';
export interface WorkspaceInspectorModel {
  projectMessage: string | null;
  importMessage: string | null;
  language: Language;
  selectedSvgIds: string[];
  importedSvgs: WorkspaceSvgItem[];
  tools: WorkspaceTool[];
  selectedMaterialId: number;
  cardSize: CardSize | null;
  insertSlots: boolean;
  selectedMatPreset: string;
  paperColor: string;
  systemFonts: string[];
  measurementUnit: MeasurementUnit;
  editingTextId: string | null;
  selectedSvgIdSet: Set<string>;
}
export interface WorkspaceInspectorActions {
  onMaterialChange: (materialId: number) => void;
  onCardSizeChange: (size: CardSize) => void;
  onInsertSlotsChange: (value: boolean) => void;
  onMatChange: (matPreset: string) => void;
  t: ReturnType<typeof createTranslator>['t'];
  onPaperColorChange: (color: string) => void;
  recolorMatchingObjects: (oldColor: string, newColor: string) => void;
  onToolsChange: (tools: WorkspaceTool[]) => void;
  onTextContentChange: (ids: string | string[], patch: Partial<WorkspaceTextContent>) => void;
  onChangeObjectColor: (ids: string | string[], color: string) => void;
  onDotPrintChange: (ids: string[], patch: Partial<DotPrintSettings>) => void;
  openSpotifyReplace: (itemId: string) => void;
  onEnterTextEdit: (id: string) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onShapeCornerRadiusChange: (ids: string | string[], radius: number) => void;
  onPenFillChange: (ids: string[], patch: Partial<PenFillSettings>) => void;
  onHollowChange: (ids: string[], hollow: boolean) => void;
  onDashChange: (ids: string[], patch: Partial<DashSettings>) => void;
  onOutlineChange: (ids: string[], patch: Partial<OutlineSettings>) => void;
  onOutlineDetach: (ids: string[]) => void;
  onReorderLayerToTarget: (draggedId: string, targetId: string) => void;
  onSelectSvg: (id: string | null) => void;
  onRenameObject: (id: string, newName: string) => void;
}
export interface WorkspaceInspectorRefs {
  pendingRenameRef: import('react').RefObject<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>;
}
export interface WorkspaceInspectorProps {
  model: WorkspaceInspectorModel;
  actions: WorkspaceInspectorActions;
  refs: WorkspaceInspectorRefs;
}
export function WorkspaceInspector({ model, actions, refs }: WorkspaceInspectorProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const {
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
  } = model;
  const {
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
  } = actions;
  const { pendingRenameRef } = refs;
  return (
    <aside className="project-drawer no-drag">
      {projectMessage ? <p className="ok project-message">{projectMessage}</p> : null}
      {importMessage ? <p className="warn">{importMessage}</p> : null}

      <div className="drawer-section">
        {(() => {
          const nl = language === 'nl';
          // Selected objects in SELECTION order — the first one drives the shown values.
          const selectedObjs = selectedSvgIds
            .map((id) => importedSvgs.find((x) => x.id === id))
            .filter((x): x is WorkspaceSvgItem => Boolean(x));
          const primary = selectedObjs[0] ?? null;
          const pens = getPens(tools);
          const behindColor = getBehindColor(tools);

          if (!primary)
            return (
              <>
                <p className="drawer-section__title">{nl ? 'Werkstuk' : 'Workpiece'}</p>
                <div className="object-settings">
                  <div className="object-settings__row object-settings__row--mat object-settings__row--first">
                    <label className="object-settings__label">
                      {nl ? 'Materiaal' : 'Material'}
                    </label>
                    <div className="mat-picker" role="group">
                      {[
                        { key: 'paper' as const, label: nl ? 'Papier' : 'Paper', defaultId: 218 },
                        {
                          key: 'insert' as const,
                          label: nl ? 'Inlegkaart' : 'Insert card',
                          defaultId: MATERIAL_INSERT_ID,
                        },
                        { key: 'vinyl' as const, label: 'Vinyl', defaultId: MATERIAL_VINYL_ID },
                      ].map((c) => {
                        const active = materialCategoryOf(selectedMaterialId) === c.key;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            className={`material-btn${active ? ' material-btn--active' : ''}`}
                            onClick={() =>
                              onMaterialChange(active ? selectedMaterialId : c.defaultId)
                            }
                            aria-pressed={active}
                            title={c.label}
                          >
                            <MaterialIcon kind={c.key} />
                            <span className="mat-btn__label">{c.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    {materialCategoryOf(selectedMaterialId) === 'paper' ? (
                      <div className="weight-picker">
                        <span className="weight-picker__caption">{nl ? 'Dikte' : 'Weight'}</span>
                        <div className="weight-seg" role="group">
                          {[
                            { id: 218, label: nl ? 'Licht' : 'Light', level: 'light' as const },
                            { id: 19, label: nl ? 'Middel' : 'Medium', level: 'medium' as const },
                            { id: 211, label: nl ? 'Zwaar' : 'Heavy', level: 'heavy' as const },
                          ].map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              className={`weight-seg__btn${selectedMaterialId === w.id ? ' weight-seg__btn--active' : ''}`}
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
                    {materialCategoryOf(selectedMaterialId) === 'insert' ? (
                      <>
                        <div className="weight-picker">
                          <span className="weight-picker__caption">
                            {nl ? 'Kaartformaat' : 'Card size'}
                          </span>
                          <div className="weight-seg" role="group">
                            {[
                              { size: 'small' as const, label: nl ? 'Klein' : 'Small' },
                              { size: 'medium' as const, label: nl ? 'Middel' : 'Medium' },
                              { size: 'large' as const, label: nl ? 'Groot' : 'Large' },
                            ].map((c) => (
                              <button
                                key={c.size}
                                type="button"
                                className={`weight-seg__btn${cardSize === c.size ? ' weight-seg__btn--active' : ''}`}
                                onClick={() => onCardSizeChange(c.size)}
                                aria-pressed={cardSize === c.size}
                                title={c.label}
                              >
                                <span>{c.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="weight-picker weight-picker--toggle">
                          <span className="weight-picker__caption">
                            {nl ? 'Insteeksleuven' : 'Insert slots'}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={insertSlots}
                            className={`toggle-switch${insertSlots ? ' toggle-switch--on' : ''}`}
                            onClick={() => onInsertSlotsChange(!insertSlots)}
                            title={
                              nl
                                ? 'Hoeksleuven voor de inlegkaart toevoegen'
                                : 'Add corner slots for the insert card'
                            }
                          >
                            <span className="toggle-switch__knob" />
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div className="object-settings__row object-settings__row--mat">
                    <label className="object-settings__label">{nl ? 'Mat' : 'Mat'}</label>
                    <div className="mat-picker" role="group">
                      {[
                        {
                          id: 'joy-standard',
                          variant: 'long' as const,
                          label: nl ? 'Lang' : 'Long',
                        },
                        {
                          id: 'joy-standard-short',
                          variant: 'short' as const,
                          label: nl ? 'Kort' : 'Short',
                        },
                        { id: 'joy-card', variant: 'card' as const, label: nl ? 'Kaart' : 'Card' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`mat-btn${selectedMatPreset === m.id ? ' mat-btn--active' : ''}`}
                          onClick={() => onMatChange(m.id)}
                          aria-pressed={selectedMatPreset === m.id}
                          title={getMatName(m.id, language) ?? m.id}
                        >
                          <span className="mat-btn__icon">
                            <MatIcon variant={m.variant} />
                          </span>
                          <span className="mat-btn__label">{m.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="drawer-section__title" style={{ marginTop: 16 }}>
                  {t('colors.sectionTitle')}
                </p>
                <div className="color-rows">
                  <ColorRow
                    icon={<PaperIcon />}
                    label={t('colors.paper')}
                    color={paperColor}
                    onChange={onPaperColorChange}
                  />
                  <ColorRow
                    icon={<BehindIcon />}
                    label={t('colors.behind')}
                    color={behindColor}
                    onChange={(c) => {
                      recolorMatchingObjects(behindColor, c);
                      onToolsChange(withBehindColor(tools, c));
                    }}
                  />
                </div>

                <p className="drawer-section__title" style={{ marginTop: 16 }}>
                  {t('pens.sectionTitle')}
                </p>
                {(() => {
                  const clashing = pens.some(
                    (p) =>
                      p.color.toLowerCase() === paperColor.toLowerCase() ||
                      p.color.toLowerCase() === behindColor.toLowerCase(),
                  );
                  // A pen is a duplicate if an EARLIER pen already uses its colour.
                  const isDuplicatePen = (index: number) =>
                    pens.some(
                      (p, j) =>
                        j < index && p.color.toLowerCase() === pens[index]!.color.toLowerCase(),
                    );
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
                          const clash =
                            pen.color.toLowerCase() === paperColor.toLowerCase() ||
                            pen.color.toLowerCase() === behindColor.toLowerCase() ||
                            isDuplicatePen(index);
                          return (
                            <span key={pen.id} className="pen-hex-wrap">
                              <label
                                className="pen-hex"
                                title={nl ? 'Penkleur wijzigen' : 'Change pen color'}
                              >
                                <HexShape color={pen.color} warn={clash} />
                                <input
                                  type="color"
                                  value={pen.color}
                                  onChange={(e) => {
                                    const c = e.target.value;
                                    recolorMatchingObjects(pen.color, c);
                                    onToolsChange(
                                      withPens(
                                        tools,
                                        pens.map((p) => (p.id === pen.id ? { ...p, color: c } : p)),
                                      ),
                                    );
                                  }}
                                />
                              </label>
                              {pens.length > 1 && (
                                <button
                                  type="button"
                                  className="pen-hex__remove"
                                  aria-label={t('pens.remove')}
                                  title={t('pens.remove')}
                                  onClick={() =>
                                    onToolsChange(
                                      withPens(
                                        tools,
                                        pens.filter((p) => p.id !== pen.id),
                                      ),
                                    )
                                  }
                                >
                                  <svg
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                  >
                                    <path d="M3 3l6 6M9 3l-6 6" />
                                  </svg>
                                </button>
                              )}
                            </span>
                          );
                        })}
                        <button
                          type="button"
                          className="pen-hex pen-hex--add"
                          aria-label={t('pens.add')}
                          title={t('pens.add')}
                          onClick={() => {
                            // Next unused palette colour, also avoiding the paper/behind
                            // colours so a fresh pen never triggers a warning.
                            const color = nextPenColor([
                              ...pens.map((p) => p.color),
                              paperColor,
                              behindColor,
                            ]);
                            onToolsChange(
                              withPens(tools, [
                                ...pens,
                                { id: `pen-${Date.now()}`, color, type: 'pen' },
                              ]),
                            );
                          }}
                        >
                          <HexShape add />
                        </button>
                      </div>
                      {clashing && (
                        <p className="pen-hex-warn">
                          ⚠{' '}
                          {nl
                            ? 'Een pen heeft dezelfde kleur als het papier of de kleur erachter.'
                            : 'A pen is the same color as the paper or behind color.'}
                        </p>
                      )}
                      {hasDuplicatePens && (
                        <p className="pen-hex-warn">
                          ⚠ {t('warn.penDuplicate')}
                          <button type="button" className="pen-hex-warn__fix" onClick={dedupePens}>
                            {t('pens.fix')}
                          </button>
                        </p>
                      )}
                    </>
                  );
                })()}
              </>
            );

          // One or more objects selected: show only controls common to ALL of them.
          // Values come from the first selected (primary); edits apply to every one.
          const ids = selectedObjs.map((o) => o.id);
          const multi = selectedObjs.length > 1;
          const allText = selectedObjs.every((o) => Boolean(o.textContent));
          const allCorners = selectedObjs.every((o) => o.shapeKind && shapeHasCorners(o.shapeKind));
          // Fill is a pen option: offered only when everything selected is drawn with a pen.
          const allPenFillable = selectedObjs.every((o) => canPenFill(o, tools));
          // Dot prints pick their pens per ink, so they have their own panel instead of a tool.
          const allDotPrint = selectedObjs.every((o) => o.dotPrint);
          const primaryColor = primary.textContent
            ? primary.textContent.color
            : (primary.paths[0]?.stroke ?? '#000000');

          // Apply a tool/pen colour to the whole selection (text stores it in its
          // content, shapes/SVGs on the path stroke).
          const applyColor = (c: string) => {
            const textIds = selectedObjs.filter((o) => o.textContent).map((o) => o.id);
            const otherIds = selectedObjs.filter((o) => !o.textContent).map((o) => o.id);
            if (textIds.length) onTextContentChange(textIds, { color: c });
            if (otherIds.length) onChangeObjectColor(otherIds, c);
          };

          const title = multi
            ? nl
              ? `${selectedObjs.length} geselecteerd`
              : `${selectedObjs.length} selected`
            : allText
              ? nl
                ? 'Tekst'
                : 'Text'
              : nl
                ? 'Geselecteerd'
                : 'Selection';

          return (
            <>
              <p className="drawer-section__title">{title}</p>
              <div className="object-settings">
                {!multi && !allText ? (
                  <p className="object-settings__name">{primary.fileName}</p>
                ) : null}

                {allDotPrint ? (
                  <DotPrintSettingsPanel
                    language={language}
                    items={selectedObjs}
                    tools={tools}
                    onChange={(patch) => onDotPrintChange(ids, patch)}
                  />
                ) : (
                  <div className="object-settings__row object-settings__row--swatches">
                    <label className="object-settings__label">{t('object.tool')}</label>
                    <SwatchPicker
                      tools={tools}
                      selectedColor={primaryColor}
                      onPick={applyColor}
                      language={language}
                    />
                  </div>
                )}

                {!multi && primary.spotify ? (
                  <div className="object-settings__row object-settings__row--swatches">
                    <span className="object-settings__label">
                      {nl ? 'Spotify-nummer' : 'Spotify song'}
                    </span>
                    <span className="object-settings__hint">{primary.spotify.name}</span>
                    <button
                      type="button"
                      className="object-settings__edit-btn"
                      onClick={() => openSpotifyReplace(primary.id)}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M2.5 5.5h9l-2.5-2.5M13.5 10.5h-9l2.5 2.5" />
                      </svg>
                      {nl ? 'Ander nummer kiezen' : 'Change song'}
                    </button>
                  </div>
                ) : null}

                {allText
                  ? (() => {
                      const tc = primary.textContent!;
                      return (
                        <>
                          <div className="object-settings__row">
                            <label className="object-settings__label" htmlFor="txt-font">
                              {nl ? 'Lettertype' : 'Font'}
                            </label>
                            <select
                              id="txt-font"
                              className="object-settings__select"
                              value={tc.fontFamily}
                              onChange={(e) =>
                                onTextContentChange(ids, { fontFamily: e.target.value })
                              }
                            >
                              <optgroup label={nl ? 'Generiek' : 'Generic'}>
                                {['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'].map(
                                  (f) => (
                                    <option key={f} value={f}>
                                      {f}
                                    </option>
                                  ),
                                )}
                              </optgroup>
                              {FONT_GROUPS.map((g) => (
                                <optgroup key={g.key} label={nl ? g.nl : g.en}>
                                  {g.families.map((f) => (
                                    <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>
                                      {f}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                              {systemFonts.length > 0 ? (
                                <optgroup label={nl ? 'Systeemlettertypen' : 'System fonts'}>
                                  {systemFonts.map((f) => (
                                    <option key={f} value={f}>
                                      {f}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : (
                                <optgroup label={nl ? 'Veelgebruikt' : 'Common'}>
                                  {[
                                    'Arial',
                                    'Arial Black',
                                    'Helvetica',
                                    'Helvetica Neue',
                                    'Verdana',
                                    'Tahoma',
                                    'Trebuchet MS',
                                    'Georgia',
                                    'Times New Roman',
                                    'Palatino',
                                    'Garamond',
                                    'Courier New',
                                    'Lucida Console',
                                    'Monaco',
                                    'Menlo',
                                    'Impact',
                                    'Comic Sans MS',
                                    'Gill Sans',
                                    'Optima',
                                    'Futura',
                                    'Century Gothic',
                                    'Calibri',
                                    'Cambria',
                                    'Segoe UI',
                                    'Franklin Gothic Medium',
                                  ].map((f) => (
                                    <option key={f} value={f} style={{ fontFamily: f }}>
                                      {f}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>
                          <div className="object-settings__row">
                            <label className="object-settings__label">
                              {nl ? 'Stijl' : 'Style'}
                            </label>
                            <div className="text-style-btns">
                              <button
                                type="button"
                                className={`text-style-btn${tc.fontWeight === 'bold' ? ' text-style-btn--active' : ''}`}
                                onClick={() =>
                                  onTextContentChange(ids, {
                                    fontWeight: tc.fontWeight === 'bold' ? 'normal' : 'bold',
                                  })
                                }
                              >
                                <strong>B</strong>
                              </button>
                              <button
                                type="button"
                                className={`text-style-btn${tc.fontStyle === 'italic' ? ' text-style-btn--active' : ''}`}
                                onClick={() =>
                                  onTextContentChange(ids, {
                                    fontStyle: tc.fontStyle === 'italic' ? 'normal' : 'italic',
                                  })
                                }
                              >
                                <em>I</em>
                              </button>
                              <button
                                type="button"
                                className={`text-style-btn${tc.textDecoration === 'underline' ? ' text-style-btn--active' : ''}`}
                                onClick={() =>
                                  onTextContentChange(ids, {
                                    textDecoration:
                                      tc.textDecoration === 'underline' ? 'none' : 'underline',
                                  })
                                }
                              >
                                <span style={{ textDecoration: 'underline' }}>U</span>
                              </button>
                              <span className="text-style-divider" />
                              {(() => {
                                // Alignment only matters across multiple lines (a single line auto-hugs
                                // its box), so disable until the (primary) text has a line break.
                                const isMultiLine = tc.text.includes('\n');
                                const disabledTip = nl
                                  ? 'Alleen voor tekst met meerdere regels'
                                  : 'Only available for multi-line text';
                                return (['left', 'center', 'right'] as const).map((align) => (
                                  <button
                                    key={align}
                                    type="button"
                                    disabled={!isMultiLine}
                                    className={`text-style-btn${isMultiLine && (tc.textAlign ?? 'left') === align ? ' text-style-btn--active' : ''}`}
                                    onClick={() => onTextContentChange(ids, { textAlign: align })}
                                    title={isMultiLine ? align : disabledTip}
                                  >
                                    <svg
                                      viewBox="0 0 14 14"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinecap="round"
                                    >
                                      {align === 'left' && (
                                        <>
                                          <line x1="2" y1="3" x2="12" y2="3" />
                                          <line x1="2" y1="6" x2="9" y2="6" />
                                          <line x1="2" y1="9" x2="11" y2="9" />
                                          <line x1="2" y1="12" x2="7" y2="12" />
                                        </>
                                      )}
                                      {align === 'center' && (
                                        <>
                                          <line x1="2" y1="3" x2="12" y2="3" />
                                          <line x1="4" y1="6" x2="10" y2="6" />
                                          <line x1="3" y1="9" x2="11" y2="9" />
                                          <line x1="5" y1="12" x2="9" y2="12" />
                                        </>
                                      )}
                                      {align === 'right' && (
                                        <>
                                          <line x1="2" y1="3" x2="12" y2="3" />
                                          <line x1="5" y1="6" x2="12" y2="6" />
                                          <line x1="3" y1="9" x2="12" y2="9" />
                                          <line x1="7" y1="12" x2="12" y2="12" />
                                        </>
                                      )}
                                    </svg>
                                  </button>
                                ));
                              })()}
                            </div>
                          </div>
                          <div className="object-settings__row">
                            <label className="object-settings__label" htmlFor="txt-size">
                              {nl ? 'Grootte' : 'Size'}{' '}
                              <em>{formatLengthPx(tc.fontSize, measurementUnit, language)}</em>
                            </label>
                            <input
                              id="txt-size"
                              type="range"
                              min={10}
                              max={200}
                              step={1}
                              value={tc.fontSize}
                              onChange={(e) =>
                                onTextContentChange(ids, { fontSize: Number(e.target.value) })
                              }
                              className="text-slider"
                            />
                          </div>
                          {/* Editing content is single-object only — you wouldn't retype two texts at once. */}
                          {!multi ? (
                            <button
                              type="button"
                              className="object-settings__edit-btn"
                              onClick={() => onEnterTextEdit(primary.id)}
                            >
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              >
                                <path d="M11 2l3 3-8 8H3v-3z" />
                              </svg>
                              {nl ? 'Tekst bewerken' : 'Edit text'}
                            </button>
                          ) : null}
                          <MoreOptions id="text" language={language}>
                            <div className="object-settings__row">
                              <label className="object-settings__label" htmlFor="txt-ls">
                                {nl ? 'Letterafstand' : 'Letter spacing'}{' '}
                                <em>
                                  {formatLengthPx(
                                    tc.letterSpacing,
                                    measurementUnit === 'in' ? 'in' : 'mm',
                                    language,
                                  )}
                                </em>
                              </label>
                              <input
                                id="txt-ls"
                                type="range"
                                min={-5}
                                max={30}
                                step={0.5}
                                value={tc.letterSpacing}
                                onChange={(e) =>
                                  onTextContentChange(ids, {
                                    letterSpacing: Number(e.target.value),
                                  })
                                }
                                className="text-slider"
                              />
                            </div>
                            <div className="object-settings__row">
                              <label className="object-settings__label" htmlFor="txt-lh">
                                {nl ? 'Regelafstand' : 'Line height'}{' '}
                                <em>{tc.lineHeight.toFixed(2)}×</em>
                              </label>
                              <input
                                id="txt-lh"
                                type="range"
                                min={0.8}
                                max={3}
                                step={0.05}
                                value={tc.lineHeight}
                                onChange={(e) =>
                                  onTextContentChange(ids, { lineHeight: Number(e.target.value) })
                                }
                                className="text-slider"
                              />
                            </div>
                            <div className="object-settings__row object-settings__row--toggle">
                              <label className="object-settings__label" htmlFor="txt-singleline">
                                {nl ? 'Eén lijn (pen)' : 'Single line (pen)'}
                              </label>
                              <button
                                id="txt-singleline"
                                type="button"
                                role="switch"
                                aria-checked={Boolean(tc.singleLine)}
                                className={`toggle-switch${tc.singleLine ? ' toggle-switch--on' : ''}`}
                                onClick={() =>
                                  onTextContentChange(ids, { singleLine: !tc.singleLine })
                                }
                                title={
                                  nl
                                    ? 'Tekst tekenen/snijden als één pennenlijn in plaats van gevulde letters'
                                    : 'Draw/cut text as a single pen line instead of filled letters'
                                }
                              >
                                <span className="toggle-switch__knob" />
                              </button>
                            </div>
                          </MoreOptions>
                        </>
                      );
                    })()
                  : null}

                {!editingTextId ? (
                  <AlignPanel
                    language={language}
                    count={selectedObjs.length}
                    onAlign={onAlign}
                    onDistribute={onDistribute}
                  />
                ) : null}

                {allCorners
                  ? (() => {
                      const maxRadius = Math.round(
                        Math.min(primary.frame.width, primary.frame.height) / 2,
                      );
                      const radius = Math.round(primary.cornerRadius ?? 0);
                      return (
                        <div className="object-settings__row">
                          <label className="object-settings__label" htmlFor="shape-radius">
                            {nl ? 'Hoekronding' : 'Corner radius'}{' '}
                            <em>
                              {formatLengthPx(
                                radius,
                                measurementUnit === 'in' ? 'in' : 'mm',
                                language,
                              )}
                            </em>
                          </label>
                          <input
                            id="shape-radius"
                            type="range"
                            min={0}
                            max={maxRadius}
                            step={1}
                            value={Math.min(radius, maxRadius)}
                            onChange={(e) => onShapeCornerRadiusChange(ids, Number(e.target.value))}
                            className="text-slider"
                          />
                        </div>
                      );
                    })()
                  : null}

                {allPenFillable
                  ? (() => {
                      const fill = primary.penFill ?? { ...DEFAULT_PEN_FILL, enabled: false };
                      return (
                        <>
                          <div className="object-settings__row object-settings__row--toggle">
                            <label className="object-settings__label" htmlFor="pen-fill-toggle">
                              {nl ? 'Opvullen (pen)' : 'Fill (pen)'}
                            </label>
                            <button
                              id="pen-fill-toggle"
                              type="button"
                              role="switch"
                              aria-checked={fill.enabled}
                              className={`toggle-switch${fill.enabled ? ' toggle-switch--on' : ''}`}
                              onClick={() => onPenFillChange(ids, { enabled: !fill.enabled })}
                              title={
                                nl
                                  ? 'Vul de vorm met een patroon van penlijnen'
                                  : 'Fill the shape with a pattern of pen lines'
                              }
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                          </div>
                          {fill.enabled ? (
                            <>
                              <div className="object-settings__row object-settings__row--swatches">
                                <span className="object-settings__label">
                                  {nl ? 'Patroon' : 'Pattern'}
                                </span>
                                <div
                                  className="pen-fill-patterns"
                                  role="radiogroup"
                                  aria-label={nl ? 'Vulpatroon' : 'Fill pattern'}
                                >
                                  {PEN_FILL_PATTERNS.map((pattern) => (
                                    <button
                                      key={pattern}
                                      type="button"
                                      role="radio"
                                      aria-checked={fill.pattern === pattern}
                                      className={`pen-fill-pattern${fill.pattern === pattern ? ' pen-fill-pattern--active' : ''}`}
                                      onClick={() => onPenFillChange(ids, { pattern })}
                                    >
                                      <PenFillSwatch pattern={pattern} />
                                      <span>{PEN_FILL_LABELS[pattern][nl ? 'nl' : 'en']}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="object-settings__row">
                                <label
                                  className="object-settings__label"
                                  htmlFor="pen-fill-density"
                                >
                                  {nl ? 'Dichtheid' : 'Density'} <em>{fill.density}%</em>
                                </label>
                                <input
                                  id="pen-fill-density"
                                  type="range"
                                  min={PEN_FILL_DENSITY_MIN}
                                  max={PEN_FILL_DENSITY_MAX}
                                  step={1}
                                  value={fill.density}
                                  onChange={(e) =>
                                    onPenFillChange(ids, { density: Number(e.target.value) })
                                  }
                                  className="text-slider"
                                />
                              </div>
                              <MoreOptions id="pen-fill" language={language}>
                                {fill.pattern === 'dots' ? (
                                  <div className="object-settings__row">
                                    <span className="object-settings__label">
                                      {nl ? 'Stip' : 'Dot'}
                                    </span>
                                    <div
                                      className="weight-seg"
                                      role="radiogroup"
                                      aria-label={nl ? 'Stipvorm' : 'Dot style'}
                                    >
                                      {DOT_STYLES.map((style) => (
                                        <button
                                          key={style}
                                          type="button"
                                          role="radio"
                                          aria-checked={fill.dotStyle === style}
                                          className={`weight-seg__btn${fill.dotStyle === style ? ' weight-seg__btn--active' : ''}`}
                                          title={
                                            nl
                                              ? DOT_STYLE_LABELS[style].hintNl
                                              : DOT_STYLE_LABELS[style].hintEn
                                          }
                                          onClick={() => onPenFillChange(ids, { dotStyle: style })}
                                        >
                                          {DOT_STYLE_LABELS[style][nl ? 'nl' : 'en']}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="object-settings__row">
                                  <label
                                    className="object-settings__label"
                                    htmlFor="pen-fill-angle"
                                  >
                                    {nl ? 'Hoek' : 'Angle'} <em>{fill.angle}°</em>
                                  </label>
                                  <input
                                    id="pen-fill-angle"
                                    type="range"
                                    min={0}
                                    max={175}
                                    step={5}
                                    value={fill.angle}
                                    onChange={(e) =>
                                      onPenFillChange(ids, { angle: Number(e.target.value) })
                                    }
                                    className="text-slider"
                                  />
                                </div>
                              </MoreOptions>
                            </>
                          ) : null}
                        </>
                      );
                    })()
                  : null}

                {/* A cut shape is normally a hole in the paper. One you keep (a card, a label) is just a cut line. */}
                {selectedObjs.every(
                  (o) =>
                    canDash(o) &&
                    o.shapeKind !== 'line' &&
                    !o.dashed?.enabled &&
                    o.paths.every(
                      (path) => (path.stroke ?? '').toLowerCase() === behindColor.toLowerCase(),
                    ),
                ) ? (
                  <div className="object-settings__row object-settings__row--toggle">
                    <label className="object-settings__label" htmlFor="hollow-toggle">
                      {nl ? 'Dit stuk bewaar ik' : 'I keep this piece'}
                    </label>
                    <button
                      id="hollow-toggle"
                      type="button"
                      role="switch"
                      aria-checked={Boolean(primary.hollow)}
                      className={`toggle-switch${primary.hollow ? ' toggle-switch--on' : ''}`}
                      onClick={() => onHollowChange(ids, !primary.hollow)}
                      title={
                        nl
                          ? 'Aan: je snijdt de vorm uit en bewaart hem (een kaart of label), dus hij wordt als snijlijn getoond. Uit: de vorm wordt een gat in het papier.'
                          : 'On: you cut the shape out and keep it (a card or label), so it shows as a cut line. Off: the shape becomes a hole in the paper.'
                      }
                    >
                      <span className="toggle-switch__knob" />
                    </button>
                  </div>
                ) : null}

                {selectedObjs.every((o) => canDash(o)) ? (
                  <FoldLinePanel
                    language={language}
                    measurementUnit={measurementUnit}
                    dashed={primary.dashed}
                    onChange={(patch) => onDashChange(ids, patch)}
                  />
                ) : null}

                {selectedObjs.every((o) => canOutline(o)) ? (
                  <OutlinePanel
                    language={language}
                    measurementUnit={measurementUnit}
                    outline={primary.outline}
                    tools={tools}
                    onChange={(patch) => onOutlineChange(ids, patch)}
                    onDetach={() => onOutlineDetach(ids)}
                  />
                ) : null}
              </div>
            </>
          );
        })()}
      </div>

      <div className="drawer-section">
        <p className="drawer-section__title">{language === 'nl' ? 'Lagen' : 'Layers'}</p>
        {importedSvgs.length > 0 ? (
          <>
            <div
              className="workspace-item-list"
              aria-label={language === 'nl' ? 'Onderdelen in dit project' : 'Items in this project'}
            >
              {/* Shown front-to-back (top of list = front layer), reverse of the array. */}
              {[...importedSvgs].reverse().map((item) => {
                const isSelected = selectedSvgIdSet.has(item.id);
                const isExpanded = expandedGroups.has(item.id);
                const isRenaming = renamingId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`workspace-item-list__row${dragOverLayerId === item.id ? ' workspace-item-list__row--dragover' : ''}${dragLayerId === item.id ? ' workspace-item-list__row--dragging' : ''}`}
                    draggable={!isRenaming}
                    onDragStart={(e) => {
                      setDragLayerId(item.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.id);
                    }}
                    onDragOver={(e) => {
                      if (dragLayerId && dragLayerId !== item.id) {
                        e.preventDefault();
                        setDragOverLayerId(item.id);
                      }
                    }}
                    onDragLeave={() => setDragOverLayerId((cur) => (cur === item.id ? null : cur))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragLayerId && dragLayerId !== item.id)
                        onReorderLayerToTarget(dragLayerId, item.id);
                      setDragLayerId(null);
                      setDragOverLayerId(null);
                    }}
                    onDragEnd={() => {
                      setDragLayerId(null);
                      setDragOverLayerId(null);
                    }}
                  >
                    <div
                      className={`workspace-item-list__item${isSelected ? ' workspace-item-list__item--selected' : ''}`}
                    >
                      {item.type === 'group' ? (
                        <button
                          type="button"
                          className="workspace-item-list__expand"
                          aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
                          onClick={() =>
                            setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        >
                          {isExpanded ? '▾' : '▸'}
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
                            onBlur={(e) => {
                              onRenameObject(item.id, e.currentTarget.value);
                              setRenamingId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onRenameObject(item.id, e.currentTarget.value);
                                setRenamingId(null);
                              }
                              if (e.key === 'Escape') {
                                setRenamingId(null);
                              }
                              e.stopPropagation();
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span>
                            {(() => {
                              // Text layers show their actual text; everything else its name.
                              const text = item.textContent?.text?.replace(/\s+/g, ' ').trim();
                              if (text) return text.length > 28 ? `${text.slice(0, 28)}…` : text;
                              return item.fileName;
                            })()}
                            {(() => {
                              const stroke = item.paths[0]?.stroke ?? '';
                              const hasMatch = tools.some(
                                (t) => t.color.toLowerCase() === stroke.toLowerCase(),
                              );
                              return !hasMatch && stroke ? (
                                <span
                                  className="workspace-item-list__warn"
                                  title={
                                    language === 'nl'
                                      ? 'Geen gereedschap voor deze kleur'
                                      : 'No tool for this color'
                                  }
                                >
                                  ⚠
                                </span>
                              ) : null;
                            })()}
                          </span>
                        )}
                      </button>
                    </div>
                    {item.type === 'group' && isExpanded ? (
                      <div className="workspace-item-list__children">
                        {item.paths.map((path, i) => (
                          <div key={path.id} className="workspace-item-list__child">
                            <span className="workspace-item-list__icon">◈</span>
                            <span>
                              {path.sourceLabel ??
                                (language === 'nl' ? `Pad ${i + 1}` : `Path ${i + 1}`)}
                            </span>
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
  );
}
