import type { DotStyle } from '@cricut-companion/craft-core';

// Kept out of the panel component files so React Fast Refresh can update them in place.
export const DOT_STYLE_LABELS: Record<
  DotStyle,
  { nl: string; en: string; hintNl: string; hintEn: string }
> = {
  tap: {
    nl: 'Tikje',
    en: 'Tap',
    hintNl: 'Pen neer en meteen weer op',
    hintEn: 'Pen down and straight back up',
  },
  dash: {
    nl: 'Streepje',
    en: 'Dash',
    hintNl: 'Een streepje van 0,1 mm',
    hintEn: 'A 0.1 mm stroke',
  },
  circle: {
    nl: 'Rondje',
    en: 'Circle',
    hintNl: 'Het kleinste rondje',
    hintEn: 'The smallest circle',
  },
};
