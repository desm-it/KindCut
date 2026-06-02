import type { Language } from "./i18n";

export type AiProvider = "openai" | "recraft";

export type AiProviderSettings = {
  activeProvider: AiProvider;
  openaiKey: string;
  recraftKey: string;
};

const STORAGE_KEY = "kindcutAiSettings";

const DEFAULT_SETTINGS: AiProviderSettings = {
  activeProvider: "openai",
  openaiKey: "",
  recraftKey: "",
};

export function loadAiSettings(): AiProviderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migrate legacy key
      const legacyKey = window.localStorage.getItem("kindcutOpenAiKey") ?? "";
      return { ...DEFAULT_SETTINGS, openaiKey: legacyKey };
    }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AiProviderSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAiSettings(settings: AiProviderSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable
  }
}

export function hasActiveApiKey(settings: AiProviderSettings): boolean {
  return settings.activeProvider === "openai"
    ? Boolean(settings.openaiKey.trim())
    : Boolean(settings.recraftKey.trim());
}

export type AiSvgInput = {
  prompt: string;
  cutterProof: boolean;
  language: Language;
  settings: AiProviderSettings;
};

export async function generateAiSvg(input: AiSvgInput): Promise<string> {
  const { settings } = input;
  if (settings.activeProvider === "recraft") {
    return generateWithRecraft(input);
  }
  return generateWithOpenAi(input);
}

// ── OpenAI (o3) ─────────────────────────────────────────────────────────────

async function generateWithOpenAi(input: AiSvgInput): Promise<string> {
  const { prompt, cutterProof, language, settings } = input;
  const apiKey = settings.openaiKey.trim();

  if (!apiKey) {
    throw new Error(
      language === "nl"
        ? "Geen OpenAI API-sleutel ingesteld. Open de instellingen om er een toe te voegen."
        : "No OpenAI API key configured. Open settings to add one.",
    );
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "o3",
      messages: [
        { role: "system", content: buildOpenAiSystemPrompt(cutterProof, language) },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 8000,
    }),
  });

  if (!response.ok) {
    let message = `OpenAI API error ${response.status}`;
    try {
      const err = (await response.json()) as { error?: { message?: string } };
      if (err?.error?.message) message = err.error.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const svg = extractSvg(content);

  if (!svg) {
    throw new Error(
      language === "nl"
        ? "Het model heeft geen geldige SVG teruggegeven. Probeer een andere beschrijving."
        : "The model did not return a valid SVG. Try a different description.",
    );
  }

  return svg;
}

function buildOpenAiSystemPrompt(cutterProof: boolean, language: Language): string {
  const lines: string[] = [
    "You are a professional vinyl/paper cut file designer for Cricut and similar CNC cutting plotters.",
    "Return ONLY raw SVG markup — no explanation, no markdown, no code fences. Just the <svg>...</svg> element.",
    "",
    "UNDERSTAND THE MACHINE:",
    "  A cutting plotter physically drags a blade or pen along the PATH OUTLINES of every shape.",
    "  The fill color of a path is IRRELEVANT to the cut — only the path outline is traced.",
    "  'Weeding' means peeling away unwanted material after cutting. Designs with many tiny cut islands",
    "  inside weeding areas are extremely frustrating to weed and will tear.",
    "",
    "TECHNICAL SVG REQUIREMENTS:",
    '  viewBox="0 0 500 500"',
    "  Use ONLY <path> elements — no <circle>, <rect>, <ellipse>, <line>, <polyline>, <polygon>, <g>, <use>, <text>, <image>",
    '  Every path: stroke="#000000"  fill="none"  stroke-width="2"',
    '  stroke-linecap="round"  stroke-linejoin="round"',
    "  NO gradients, NO filters, NO masks, NO clipPath, NO background rectangle",
    "  NO style attributes, NO class attributes — SVG presentation attributes only",
    "  All closed shapes MUST end with Z",
    "  Absolute coordinates only (M, L, C, Q, A, Z — uppercase)",
    "  Minimum feature size: 20px — nothing that would tear or be impossible to weed",
    "  Maximum 12 paths total",
    "",
    "SHAPE HOLES — COMPOUND PATHS (critical):",
    "  A shape with a hole (like a donut, letter O, eye of a needle) MUST be a single <path>",
    "  using two subpaths and fill-rule=\"evenodd\":",
    '    <path fill-rule="evenodd" d="M [outer shape] Z M [inner hole] Z" fill="none" stroke="#000000" stroke-width="2"/>',
    "  NEVER represent a hole as a white-filled circle on top of a black-filled circle.",
    "  That stacking trick makes weeding impossible — the cutter would cut through both layers.",
    "",
    "DESIGN STYLE:",
    "  Bold, clean outlines — think paper-cut stencil, linocut print, or vinyl decal",
    "  Immediately recognizable silhouette at a glance",
    "  Smooth bezier curves, no jagged edges",
    "  Avoid hair-thin connectors, crosshatching, or detail smaller than a fingernail",
  ];

  if (cutterProof) {
    lines.push(
      "",
      "CUTTER-PROOF / WEED-FRIENDLY CONSTRAINT (strictly required):",
      "  The entire design must remain ONE physical piece when cut from cardstock",
      "  No isolated floating islands — every part must stay connected to the rest",
      "  Avoid interior cutouts unless they are large enough to peel cleanly (>15px on each side)",
      "  Use compound paths with evenodd fill-rule for holes instead of separate overlapping shapes",
      "  Ask yourself: if I cut this from cardstock, will it stay in one piece? Can I weed it easily?",
    );
  }

  if (language === "nl") {
    lines.push("", "The user prompt is written in Dutch. Interpret it correctly and generate the design.");
  }

  return lines.join("\n");
}

// ── Recraft (recraftv4_1_vector) ─────────────────────────────────────────────

async function generateWithRecraft(input: AiSvgInput): Promise<string> {
  const { prompt, cutterProof, language, settings } = input;
  const apiKey = settings.recraftKey.trim();

  if (!apiKey) {
    throw new Error(
      language === "nl"
        ? "Geen Recraft API-sleutel ingesteld. Open de instellingen om er een toe te voegen."
        : "No Recraft API key configured. Open settings to add one.",
    );
  }

  const fullPrompt = buildRecraftPrompt(prompt, cutterProof, language);

  const response = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      prompt: fullPrompt,
      model: "recraftv4_1_vector",
      n: 1,
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    let message = `Recraft API error ${response.status}`;
    try {
      const err = (await response.json()) as { error?: { message?: string } | string };
      if (typeof err.error === "string") message = err.error;
      else if (err?.error?.message) message = err.error.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const data = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = data.data?.[0];

  if (item?.b64_json) {
    const svgText = atob(item.b64_json);
    const svg = extractSvg(svgText);
    if (svg) return svg;
  }

  // Fallback: fetch the URL if b64_json wasn't returned
  if (item?.url) {
    const svgRes = await fetch(item.url);
    if (svgRes.ok) {
      const text = await svgRes.text();
      const svg = extractSvg(text);
      if (svg) return svg;
    }
  }

  throw new Error(
    language === "nl"
      ? "Recraft heeft geen geldige SVG teruggegeven. Probeer een andere beschrijving."
      : "Recraft did not return a valid SVG. Try a different description.",
  );
}

function buildRecraftPrompt(prompt: string, cutterProof: boolean, language: Language): string {
  const base = language === "nl"
    ? `${prompt} — vinyl snijbestand voor Cricut plotter, stencil stijl, vette zwarte contouren, geen kleurvlakken, geen achtergrond, geschikt voor snijden en wieden`
    : `${prompt} — vinyl cut file for Cricut plotter, stencil style, bold black outlines only, no color fills, no background, suitable for cutting and weeding`;

  if (cutterProof) {
    return language === "nl"
      ? `${base}, geheel verbonden als één stuk, geen losse eilanden, makkelijk te wieden`
      : `${base}, all parts stay connected as one piece, no floating islands, easy to weed`;
  }
  return base;
}

// ── Shared ───────────────────────────────────────────────────────────────────

function extractSvg(content: string): string | null {
  const stripped = content.replace(/```[a-z]*\n?/gi, "").trim();
  const match = stripped.match(/<svg[\s\S]*?<\/svg>/i);
  if (match) return match[0];
  return null;
}
