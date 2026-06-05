// Curated Google Fonts for card making, grouped by category. Kept to a small, hand-
// picked set (~30) so the picker stays approachable. Loaded at runtime from Google
// Fonts (see googleFontsHref); requires an internet connection the first time a font
// is used.

export type FontGroupKey =
  | "sans"
  | "serif"
  | "handwritten"
  | "scribe"
  | "stencil"
  | "artistic"
  | "halloween"
  | "valentine"
  | "christmas";

export type FontGroup = {
  key: FontGroupKey;
  en: string;
  nl: string;
  families: string[];
};

// Order here = order shown in the picker.
export const FONT_GROUPS: FontGroup[] = [
  { key: "sans", en: "Sans-serif", nl: "Schreefloos", families: ["Poppins", "Montserrat", "Quicksand", "Nunito", "Cause", "Elms Sans"] },
  { key: "serif", en: "Serif", nl: "Met schreef", families: ["Playfair Display", "Lora", "Merriweather", "Cormorant Garamond"] },
  { key: "handwritten", en: "Handwritten", nl: "Handgeschreven", families: ["Caveat", "Patrick Hand", "Shadows Into Light", "Indie Flower", "Gochi Hand", "Reenie Beanie", "Homemade Apple", "Nanum Pen Script", "Crafty Girls"] },
  { key: "scribe", en: "Scribe", nl: "Sierschrift", families: ["Great Vibes", "Allura", "Sacramento", "Pinyon Script", "Tangerine", "Felipa"] },
  { key: "stencil", en: "Stencil", nl: "Sjabloon", families: ["Stardos Stencil", "Saira Stencil One", "Sirin Stencil"] },
  { key: "artistic", en: "Artistic", nl: "Artistiek", families: ["Lobster", "Pacifico", "Abril Fatface", "Bungee", "Boogaloo", "Hachi Maru Pop", "Moirai One", "Atma", "DynaPuff", "Sour Gummy", "Cherry Bomb One", "Wavefont", "Bitcount Prop Single Ink", "Libre Barcode 39 Text"] },
  { key: "halloween", en: "Halloween", nl: "Halloween", families: ["Creepster", "Nosifer", "Jim Nightshade"] },
  { key: "valentine", en: "Valentine", nl: "Valentijn", families: ["Parisienne", "Cookie"] },
  { key: "christmas", en: "Christmas", nl: "Kerst", families: ["Mountains of Christmas", "Berkshire Swash"] },
];

// All curated families (deduped), in group order.
export const CATALOG_FAMILIES: string[] = FONT_GROUPS.flatMap((g) => g.families);

// <link> href that loads every curated family from Google Fonts.
export function googleFontsHref(): string {
  const families = CATALOG_FAMILIES.map((f) => `family=${f.replace(/ /g, "+")}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
