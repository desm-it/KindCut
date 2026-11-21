import {
  DOT_PRINT_LIMITS,
  DOT_STYLES,
  type DotPrintSettings,
  type InkChannel,
  dotPrintInkBleed,
  dotPrintInkSpacing,
  dotPrintInkTip,
  dotPrintInks,
  dotPrintMaxCoverage,
  dotPrintModeInks,
  estimateDotPrintMinutes,
} from '@cricut-companion/craft-core';
import type { Language } from '../../i18n';
import type { WorkspaceTool } from '../../project-file';
import type { WorkspaceObject } from '../../workspace-objects';
import { dotPrintChannels, missingInkPens, useRasterImage } from '../../dot-print-render';
import { DOT_STYLE_LABELS } from './dot-style-labels';
import { MoreOptions } from './MoreOptions';

const INK_LABELS: Record<InkChannel, { nl: string; en: string }> = {
  y: { nl: 'Geel', en: 'Yellow' },
  c: { nl: 'Cyaan', en: 'Cyan' },
  m: { nl: 'Magenta', en: 'Magenta' },
  k: { nl: 'Zwart', en: 'Black' },
};

function formatMinutes(minutes: number, nl: boolean): string {
  if (minutes < 1) return nl ? '< 1 min' : '< 1 min';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return nl ? `~${hours} u ${rest} min` : `~${hours} h ${rest} min`;
}

function formatMm(value: number, nl: boolean): string {
  const text = value.toFixed(1);
  return `${nl ? text.replace('.', ',') : text} mm`;
}

/** Dot count and plotting estimate for one dot print (needs its picture loaded). */
function DotPrintStats({
  item,
  tools,
  nl,
}: {
  item: WorkspaceObject;
  tools: WorkspaceTool[];
  nl: boolean;
}) {
  const image = useRasterImage(item.dotPrint?.image);
  const settings = item.dotPrint?.settings;
  if (!settings) return null;
  const missing = missingInkPens(item, tools);
  // Black and the colours have their own resolution, so each group can be too coarse on its own.
  const enabledInks = dotPrintInks(settings);
  const tooLight = [
    { ink: 'c' as const, inks: ['y', 'c', 'm'], label: nl ? 'Kleur (CMY)' : 'Colour (CMY)' },
    { ink: 'k' as const, inks: ['k'], label: nl ? 'Zwart (K)' : 'Black (K)' },
  ]
    .filter((group) => enabledInks.some((ink) => group.inks.includes(ink)))
    .map((group) => ({ label: group.label, coverage: dotPrintMaxCoverage(settings, group.ink) }))
    .filter((group) => group.coverage < 0.5);
  const channels = image ? dotPrintChannels(item, image) : null;
  const dotCount = channels?.reduce((total, channel) => total + channel.dots.length, 0) ?? 0;

  return (
    <div className="dot-print-stats">
      {channels ? (
        <p>
          <strong>{dotCount.toLocaleString(nl ? 'nl-NL' : 'en-US')}</strong>{' '}
          {nl ? 'stippen' : 'dots'}
          {' · '}
          {formatMinutes(estimateDotPrintMinutes(dotCount, channels.length), nl)}
          {channels.length > 1 ? ` · ${channels.length} ${nl ? 'pennen' : 'pens'}` : ''}
        </p>
      ) : (
        <p>{nl ? 'Stippen berekenen…' : 'Working out the dots…'}</p>
      )}
      <p className="dot-print-stats__note">
        {nl
          ? 'Tijd is een schatting (elke stip is een keer pen op en neer).'
          : 'Time is an estimate (every dot is one pen lift).'}
      </p>
      {tooLight.map((group) => (
        <p key={group.label} className="dot-print-stats__warn">
          {nl
            ? `${group.label}: het donkerste wordt maar ${Math.round(group.coverage * 100)}% gevuld. Kies een fijnere resolutie of een dikkere penpunt.`
            : `${group.label}: the darkest tone only gets ${Math.round(group.coverage * 100)}% ink. Pick a finer resolution or a wider pen tip.`}
        </p>
      ))}
      {missing.length > 0 ? (
        <p className="dot-print-stats__warn">
          {nl
            ? `Voeg pennen toe in deze kleuren, anders worden die stippen overgeslagen: ${missing.join(', ')}`
            : `Add pens in these colours, or those dots are skipped: ${missing.join(', ')}`}
        </p>
      ) : null}
    </div>
  );
}

export function DotPrintSettingsPanel({
  language,
  items,
  tools,
  onChange,
}: {
  language: Language;
  /** The selected dot prints; values show the first one, changes go to all. */
  items: WorkspaceObject[];
  tools: WorkspaceTool[];
  onChange: (patch: Partial<DotPrintSettings>) => void;
}) {
  const nl = language === 'nl';
  const primary = items[0];
  const settings = primary?.dotPrint?.settings;
  if (!primary || !settings) return null;

  const slider = (
    id: string,
    label: string,
    value: number,
    shown: string,
    limits: { min: number; max: number },
    step: number,
    key:
      | 'spacingMm'
      | 'blackSpacingMm'
      | 'tipWidthMm'
      | 'blackTipWidthMm'
      | 'brightness'
      | 'contrast'
      | 'inkBleed'
      | 'blackInkBleed',
  ) => (
    <div className="object-settings__row">
      <label className="object-settings__label" htmlFor={id}>
        {label} <em>{shown}</em>
      </label>
      <input
        id={id}
        type="range"
        min={limits.min}
        max={limits.max}
        step={step}
        value={value}
        onChange={(e) => onChange({ [key]: Number(e.target.value) })}
        className="text-slider"
      />
    </div>
  );

  return (
    <>
      <div className="object-settings__row">
        <span className="object-settings__label">{nl ? 'Kleuren' : 'Colours'}</span>
        <div className="weight-seg" role="radiogroup" aria-label={nl ? 'Kleuren' : 'Colours'}>
          {(['cmyk', 'black'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.colorMode === mode}
              className={`weight-seg__btn${settings.colorMode === mode ? ' weight-seg__btn--active' : ''}`}
              onClick={() => onChange({ colorMode: mode })}
            >
              {mode === 'cmyk' ? 'CMYK' : nl ? 'Zwart' : 'Black'}
            </button>
          ))}
        </div>
      </div>

      {slider(
        'dot-print-brightness',
        nl ? 'Helderheid' : 'Brightness',
        settings.brightness,
        String(settings.brightness),
        DOT_PRINT_LIMITS.brightness,
        5,
        'brightness',
      )}
      {slider(
        'dot-print-contrast',
        'Contrast',
        settings.contrast,
        String(settings.contrast),
        DOT_PRINT_LIMITS.contrast,
        5,
        'contrast',
      )}

      <div className="object-settings__row object-settings__row--swatches">
        <span className="object-settings__label">{nl ? 'Pennen' : 'Pens'}</span>
        <div className="dot-print-inks">
          {dotPrintModeInks(settings).map((ink) => {
            const disabled = settings.disabledInks ?? [];
            const on = !disabled.includes(ink);
            return (
              <button
                key={ink}
                type="button"
                aria-pressed={on}
                className={`dot-print-inks__ink${on ? '' : ' dot-print-inks__ink--off'}`}
                title={
                  on
                    ? nl
                      ? 'Klik om deze kleur over te slaan'
                      : 'Click to leave this colour out'
                    : nl
                      ? 'Klik om deze kleur weer te tekenen'
                      : 'Click to draw this colour again'
                }
                onClick={() =>
                  onChange({
                    disabledInks: on
                      ? [...disabled, ink]
                      : disabled.filter((other) => other !== ink),
                  })
                }
              >
                <span
                  className="dot-print-inks__swatch"
                  style={{ background: settings.pens[ink] }}
                  aria-hidden="true"
                />
                {INK_LABELS[ink][nl ? 'nl' : 'en']}
              </button>
            );
          })}
        </div>
      </div>

      {items.length === 1 ? <DotPrintStats item={primary} tools={tools} nl={nl} /> : null}

      <MoreOptions id="dot-print" language={language}>
        <div className="object-settings__row">
          <span className="object-settings__label">{nl ? 'Stip' : 'Dot'}</span>
          <div className="weight-seg" role="radiogroup" aria-label={nl ? 'Stipvorm' : 'Dot style'}>
            {DOT_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={settings.dotStyle === style}
                className={`weight-seg__btn${settings.dotStyle === style ? ' weight-seg__btn--active' : ''}`}
                title={nl ? DOT_STYLE_LABELS[style].hintNl : DOT_STYLE_LABELS[style].hintEn}
                onClick={() => onChange({ dotStyle: style })}
              >
                {DOT_STYLE_LABELS[style][nl ? 'nl' : 'en']}
              </button>
            ))}
          </div>
        </div>

        {/* Black and the colours each get their own resolution and preview bleed. */}
        {settings.colorMode === 'cmyk' ? (
          <>
            <p className="dot-print-group__title">{nl ? 'Kleur (CMY)' : 'Colour (CMY)'}</p>
            {slider(
              'dot-print-tip',
              nl ? 'Penpunt' : 'Pen tip',
              settings.tipWidthMm,
              formatMm(settings.tipWidthMm, nl),
              DOT_PRINT_LIMITS.tipWidthMm,
              0.1,
              'tipWidthMm',
            )}
            {slider(
              'dot-print-spacing',
              nl ? 'Resolutie' : 'Resolution',
              settings.spacingMm,
              formatMm(settings.spacingMm, nl),
              DOT_PRINT_LIMITS.spacingMm,
              0.1,
              'spacingMm',
            )}
            {slider(
              'dot-print-bleed',
              nl ? 'Inkt vloeit (voorbeeld)' : 'Ink bleed (preview)',
              settings.inkBleed,
              String(settings.inkBleed),
              DOT_PRINT_LIMITS.inkBleed,
              5,
              'inkBleed',
            )}
          </>
        ) : null}
        <p className="dot-print-group__title">{nl ? 'Zwart (K)' : 'Black (K)'}</p>
        {slider(
          'dot-print-black-tip',
          nl ? 'Penpunt' : 'Pen tip',
          dotPrintInkTip(settings, 'k'),
          formatMm(dotPrintInkTip(settings, 'k'), nl),
          DOT_PRINT_LIMITS.tipWidthMm,
          0.1,
          'blackTipWidthMm',
        )}
        {slider(
          'dot-print-black-spacing',
          nl ? 'Resolutie' : 'Resolution',
          dotPrintInkSpacing(settings, 'k'),
          formatMm(dotPrintInkSpacing(settings, 'k'), nl),
          DOT_PRINT_LIMITS.spacingMm,
          0.1,
          'blackSpacingMm',
        )}
        {slider(
          'dot-print-black-bleed',
          nl ? 'Inkt vloeit (voorbeeld)' : 'Ink bleed (preview)',
          dotPrintInkBleed(settings, 'k'),
          String(dotPrintInkBleed(settings, 'k')),
          DOT_PRINT_LIMITS.inkBleed,
          5,
          'blackInkBleed',
        )}
      </MoreOptions>
    </>
  );
}
