import type { ReactNode } from "react";
import {
  DASH_LIMITS,
  DEFAULT_DASH,
  DEFAULT_OUTLINE,
  OUTLINE_LIMITS,
  type DashSettings,
  type OutlineSettings,
} from "@cricut-companion/craft-core";
import type { Language } from "../../i18n";
import { type WorkspaceTool, getPens } from "../../project-file";
import { type AlignMode, type MeasurementUnit, formatLength } from "../../workspace-utils";
import { MoreOptions } from "./MoreOptions";

const ICON = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ALIGN_ICONS: Record<AlignMode, ReactNode> = {
  left: <><path d="M3 2.5v15"/><rect x="6" y="5" width="10" height="3.5" rx="1"/><rect x="6" y="11.5" width="6" height="3.5" rx="1"/></>,
  center: <><path d="M10 2.5v15"/><rect x="4" y="5" width="12" height="3.5" rx="1"/><rect x="6.5" y="11.5" width="7" height="3.5" rx="1"/></>,
  right: <><path d="M17 2.5v15"/><rect x="4" y="5" width="10" height="3.5" rx="1"/><rect x="8" y="11.5" width="6" height="3.5" rx="1"/></>,
  top: <><path d="M2.5 3h15"/><rect x="5" y="6" width="3.5" height="10" rx="1"/><rect x="11.5" y="6" width="3.5" height="6" rx="1"/></>,
  middle: <><path d="M2.5 10h15"/><rect x="5" y="4" width="3.5" height="12" rx="1"/><rect x="11.5" y="6.5" width="3.5" height="7" rx="1"/></>,
  bottom: <><path d="M2.5 17h15"/><rect x="5" y="4" width="3.5" height="10" rx="1"/><rect x="11.5" y="8" width="3.5" height="6" rx="1"/></>,
};

const ALIGN_LABELS: Record<AlignMode, { nl: string; en: string }> = {
  left: { nl: "Links", en: "Left" },
  center: { nl: "Midden (links-rechts)", en: "Centre (left-right)" },
  right: { nl: "Rechts", en: "Right" },
  top: { nl: "Boven", en: "Top" },
  middle: { nl: "Midden (boven-onder)", en: "Middle (top-bottom)" },
  bottom: { nl: "Onder", en: "Bottom" },
};

/**
 * Lines the selection up: one object on the paper, several objects on each
 * other. With three or more, the gaps between them can be made equal.
 */
export function AlignPanel({ language, count, onAlign, onDistribute }: {
  language: Language;
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
}) {
  const nl = language === "nl";
  const target = count === 1 ? (nl ? "op het papier" : "on the paper") : (nl ? "op elkaar" : "to each other");
  return (
    <div className="object-settings__row object-settings__row--swatches">
      <span className="object-settings__label">{nl ? "Uitlijnen" : "Align"} <em>{target}</em></span>
      <div className="align-buttons" role="group" aria-label={nl ? `Uitlijnen ${target}` : `Align ${target}`}>
        {(Object.keys(ALIGN_ICONS) as AlignMode[]).map((mode) => {
          const label = `${ALIGN_LABELS[mode][nl ? "nl" : "en"]} ${target}`;
          return (
            <button key={mode} type="button" className="align-btn" title={label} aria-label={label} onClick={() => onAlign(mode)}>
              <svg aria-hidden="true" {...ICON}>{ALIGN_ICONS[mode]}</svg>
            </button>
          );
        })}
      </div>
      {count >= 3 ? (
        <div className="align-buttons align-buttons--wide" role="group">
          <button type="button" className="align-btn align-btn--text" onClick={() => onDistribute("x")}>
            <svg aria-hidden="true" {...ICON}><path d="M2.5 2.5v15M17.5 2.5v15"/><rect x="6" y="6" width="3" height="8" rx="1"/><rect x="11" y="6" width="3" height="8" rx="1"/></svg>
            {nl ? "Gelijk verdelen ↔" : "Space evenly ↔"}
          </button>
          <button type="button" className="align-btn align-btn--text" onClick={() => onDistribute("y")}>
            <svg aria-hidden="true" {...ICON}><path d="M2.5 2.5h15M2.5 17.5h15"/><rect x="6" y="6" width="8" height="3" rx="1"/><rect x="6" y="11" width="8" height="3" rx="1"/></svg>
            {nl ? "Gelijk verdelen ↕" : "Space evenly ↕"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function millimetres(mm: number, unit: MeasurementUnit, language: Language): string {
  return formatLength(mm / 25.4, unit === "in" ? "in" : "mm", language);
}

/** Cut (or draw) the line as dashes, so cardstock folds along it. */
export function FoldLinePanel({ language, measurementUnit, dashed, onChange }: {
  language: Language;
  measurementUnit: MeasurementUnit;
  dashed: DashSettings | undefined;
  onChange: (patch: Partial<DashSettings>) => void;
}) {
  const nl = language === "nl";
  const dash = dashed ?? { ...DEFAULT_DASH, enabled: false };
  return (
    <>
      <div className="object-settings__row object-settings__row--toggle">
        <label className="object-settings__label" htmlFor="fold-line-toggle">{nl ? "Vouwlijn (stippellijn)" : "Fold line (dashed)"}</label>
        <button id="fold-line-toggle" type="button" role="switch" aria-checked={dash.enabled}
          className={`toggle-switch${dash.enabled ? " toggle-switch--on" : ""}`}
          onClick={() => onChange({ enabled: !dash.enabled })}
          title={nl
            ? "Snijdt de lijn in streepjes, zodat het papier erlangs vouwt maar heel blijft"
            : "Cuts the line as dashes, so the paper folds along it but stays in one piece"}
        >
          <span className="toggle-switch__knob" />
        </button>
      </div>
      {dash.enabled ? (
        <MoreOptions id="fold-line" language={language}>
          <div className="object-settings__row">
            <label className="object-settings__label" htmlFor="fold-dash">{nl ? "Streepje" : "Dash"} <em>{millimetres(dash.dashMm, measurementUnit, language)}</em></label>
            <input id="fold-dash" type="range" className="text-slider" min={DASH_LIMITS.dashMm.min} max={DASH_LIMITS.dashMm.max} step={0.5}
              value={dash.dashMm} onChange={(event) => onChange({ dashMm: Number(event.target.value) })} />
          </div>
          <div className="object-settings__row">
            <label className="object-settings__label" htmlFor="fold-gap">{nl ? "Tussenruimte" : "Gap"} <em>{millimetres(dash.gapMm, measurementUnit, language)}</em></label>
            <input id="fold-gap" type="range" className="text-slider" min={DASH_LIMITS.gapMm.min} max={DASH_LIMITS.gapMm.max} step={0.5}
              value={dash.gapMm} onChange={(event) => onChange({ gapMm: Number(event.target.value) })} />
          </div>
        </MoreOptions>
      ) : null}
    </>
  );
}

/** A border at a distance around the object: cut it for a sticker or label, or use it as a shadow layer. */
export function OutlinePanel({ language, measurementUnit, outline, tools, onChange, onDetach }: {
  language: Language;
  measurementUnit: MeasurementUnit;
  outline: OutlineSettings | undefined;
  tools: WorkspaceTool[];
  onChange: (patch: Partial<OutlineSettings>) => void;
  onDetach: () => void;
}) {
  const nl = language === "nl";
  const settings = outline ?? { ...DEFAULT_OUTLINE, enabled: false };
  const pens = getPens(tools);
  const activePen = settings.penId ? pens.find((pen) => pen.id === settings.penId) ?? null : null;
  return (
    <>
      <div className="object-settings__row object-settings__row--toggle">
        <label className="object-settings__label" htmlFor="outline-toggle">{nl ? "Rand eromheen" : "Outline around it"}</label>
        <button id="outline-toggle" type="button" role="switch" aria-checked={settings.enabled}
          className={`toggle-switch${settings.enabled ? " toggle-switch--on" : ""}`}
          onClick={() => onChange({ enabled: !settings.enabled })}
          title={nl
            ? "Een lijn op afstand rond de vorm, bijvoorbeeld om een sticker of label uit te snijden"
            : "A line at a distance around the shape, for example to cut out a sticker or label"}
        >
          <span className="toggle-switch__knob" />
        </button>
      </div>
      {settings.enabled ? (
        <>
          <div className="object-settings__row">
            <label className="object-settings__label" htmlFor="outline-distance">{nl ? "Afstand" : "Distance"} <em>{millimetres(settings.distanceMm, measurementUnit, language)}</em></label>
            <input id="outline-distance" type="range" className="text-slider" min={OUTLINE_LIMITS.distanceMm.min} max={OUTLINE_LIMITS.distanceMm.max} step={0.5}
              value={settings.distanceMm} onChange={(event) => onChange({ distanceMm: Number(event.target.value) })} />
          </div>
          <div className="object-settings__row">
            <span className="object-settings__label">{nl ? "De rand wordt" : "The outline is"}</span>
            <div className="weight-seg" role="radiogroup" aria-label={nl ? "Gereedschap voor de rand" : "Tool for the outline"}>
              <button type="button" role="radio" aria-checked={!activePen}
                className={`weight-seg__btn${activePen ? "" : " weight-seg__btn--active"}`}
                onClick={() => onChange({ penId: null })}
              >{nl ? "Gesneden" : "Cut"}</button>
              <button type="button" role="radio" aria-checked={Boolean(activePen)} disabled={pens.length === 0}
                className={`weight-seg__btn${activePen ? " weight-seg__btn--active" : ""}`}
                onClick={() => { if (!activePen && pens[0]) onChange({ penId: pens[0].id }); }}
              >{nl ? "Getekend" : "Drawn"}</button>
            </div>
          </div>
          {activePen && pens.length > 1 ? (
            <div className="tool-picker__pens-row">
              <span className="object-settings__label">{nl ? "Penkleur" : "Pen colour"}</span>
              <div className="tool-picker__pens">
                {pens.map((pen, index) => (
                  <button key={pen.id} type="button" className={`pen-dot${pen === activePen ? " pen-dot--active" : ""}`}
                    aria-pressed={pen === activePen} aria-label={`Pen ${index + 1}`} title={`Pen ${index + 1}`}
                    style={{ backgroundColor: pen.color }} onClick={() => onChange({ penId: pen.id })} />
                ))}
              </div>
            </div>
          ) : null}
          <MoreOptions id="outline" language={language}>
            <div className="object-settings__row object-settings__row--toggle">
              <label className="object-settings__label" htmlFor="outline-holes">{nl ? "Openingen behouden" : "Keep openings"}</label>
              <button id="outline-holes" type="button" role="switch" aria-checked={settings.holes}
                className={`toggle-switch${settings.holes ? " toggle-switch--on" : ""}`}
                onClick={() => onChange({ holes: !settings.holes })}
                title={nl ? "Volgt ook de binnenkant, zoals het gat in een O" : "Also follows the inside, like the hole in an O"}
              >
                <span className="toggle-switch__knob" />
              </button>
            </div>
            <button type="button" className="object-settings__edit-btn" onClick={onDetach}
              title={nl ? "Maakt van de rand een eigen vorm die je los kunt verplaatsen" : "Turns the outline into a shape of its own that you can move separately"}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5"/><path d="M6 12.5V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5"/></svg>
              {nl ? "Losse vorm van maken" : "Make it a separate shape"}
            </button>
          </MoreOptions>
        </>
      ) : null}
    </>
  );
}
