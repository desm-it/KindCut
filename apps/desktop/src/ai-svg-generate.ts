import type { Language } from "./i18n";

export type AiProvider = "openai" | "recraft";
export type OpenAiImageModel = "gpt-image-1" | "gpt-image-1.5" | "gpt-image-2";

export type AiProviderSettings = {
  activeProvider: AiProvider;
  openaiKey: string;
  recraftKey: string;
  openaiImageModel: OpenAiImageModel;
};

const STORAGE_KEY = "kindcutAiSettings";

const DEFAULT_SETTINGS: AiProviderSettings = {
  activeProvider: "openai",
  openaiKey: "",
  recraftKey: "",
  openaiImageModel: "gpt-image-2" as OpenAiImageModel,
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

/**
 * complexity: 1 = pure silhouette, 2 = stencil (one connected shape + edge detail), 3 = multi-shape
 */
export type AiProgressStep = {
  step: number;   // 1-based current step
  total: number;  // total steps for this flow
  label: string;  // human-readable description
};

export type AiSvgInput = {
  prompt: string;
  cutterProof: boolean;
  complexity: number; // 1–5
  language: Language;
  settings: AiProviderSettings;
  onProgress?: (progress: AiProgressStep) => void;
  onPreview?: (pngBase64: string) => void; // called after image gen, before tracing
};

export async function generateAiSvg(input: AiSvgInput): Promise<string> {
  const { settings, complexity } = input;

  if (settings.activeProvider === "recraft") {
    return generateWithRecraft(input);
  }

  // Always use image generation → Potrace for OpenAI.
  // DALL-E 3 / GPT Image 1 produce recognisable shapes at every complexity level.
  // Direct SVG generation (o3) consistently produces stroke drawings instead of solid shapes.
  return generateWithDalleAndPotrace(input);
}

// ── DALL-E 3 → Potrace (complexity 1-2) ──────────────────────────────────────

async function generateWithDalleAndPotrace(input: AiSvgInput): Promise<string> {
  const { prompt, complexity, language, settings, onProgress, onPreview } = input;
  const apiKey = settings.openaiKey.trim();
  const nl = language === "nl";

  if (!apiKey) {
    throw new Error(
      nl
        ? "Geen OpenAI API-sleutel ingesteld. Open de instellingen om er een toe te voegen."
        : "No OpenAI API key configured. Open settings to add one.",
    );
  }

  const imageModel = settings.openaiImageModel ?? "gpt-image-2";
  const modelLabel: Record<string, string> = {
    "gpt-image-2": "GPT Image 2",
    "gpt-image-1.5": "GPT Image 1.5",
    "gpt-image-1": "GPT Image 1",
  };
  const label = modelLabel[imageModel] ?? imageModel;
  // Step 1: Generate PNG
  onProgress?.({ step: 1, total: 3, label: nl ? `Afbeelding genereren met ${label}…` : `Generating image with ${label}…` });
  const pngBase64 = await window.cricutCompanion?.ai?.dalleGeneratePng({ prompt, complexity, language, apiKey, imageModel });
  if (!pngBase64) throw new Error(nl ? "Geen afbeelding ontvangen." : "No image received.");

  // Show PNG preview while tracing runs
  onPreview?.(pngBase64);

  // Step 2: Trace PNG → SVG with Potrace
  onProgress?.({ step: 2, total: 3, label: nl ? "Vectorpaden traceren…" : "Tracing vector paths…" });
  const svg = await window.cricutCompanion?.ai?.tracePngToSvg(pngBase64);
  if (!svg) throw new Error(nl ? "Vectorisatie mislukt." : "Vectorisation failed.");

  return svg;
}

// ── OpenAI (o3) ─────────────────────────────────────────────────────────────

async function generateWithOpenAi(input: AiSvgInput): Promise<string> {
  const { prompt, cutterProof, complexity, language, settings, onProgress } = input;
  const nl = language === "nl";
  onProgress?.({ step: 1, total: 2, label: nl ? "SVG genereren met OpenAI o3… (kan even duren)" : "Generating SVG with OpenAI o3… (may take a moment)" });
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
        { role: "system", content: buildOpenAiSystemPrompt(complexity, cutterProof, language) },
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

function buildOpenAiSystemPrompt(complexity: number, cutterProof: boolean, language: Language): string {
  // Map 1-5 to concrete path count limits and instructions
  const maxPaths = complexity <= 1 ? 1 : complexity <= 2 ? 2 : complexity <= 3 ? 4 : complexity <= 4 ? 8 : 12;
  const minFeature = complexity <= 2 ? 35 : complexity <= 3 ? 25 : 18;

  const lines: string[] = [
    "You are designing a PHYSICAL CUT SHAPE for a Cricut vinyl/paper cutting plotter.",
    "Return ONLY raw SVG markup — no explanation, no markdown, no code fences. Just the <svg>...</svg> element.",
    "",
    "HOW THE MACHINE WORKS (read carefully):",
    "  The plotter moves a blade along every path you draw, physically cutting through the material.",
    "  It works EXACTLY like scissors following a drawn line.",
    "  Think of it as designing a COOKIE CUTTER: the machine cuts along your path boundary.",
    "  The fill color does not matter — ONLY the path outlines are physically cut.",
    "  Every separate <path> element = one closed cut line the blade will follow.",
    "",
    "TECHNICAL SVG REQUIREMENTS:",
    '  viewBox="0 0 500 500"',
    "  Use ONLY <path> elements — absolutely no other SVG elements",
    '  Every path: fill="#000000"  stroke="none"',
    "  NO stroke, NO gradients, NO filters, NO masks, NO clipPath, NO background rectangles",
    "  NO style attributes, NO class attributes",
    "  Every path MUST be closed — end with Z",
    "  Absolute coordinates only: M L C Q A Z (uppercase)",
    `  Minimum feature size: ${minFeature}px`,
    `  Maximum ${maxPaths} path element${maxPaths === 1 ? "" : "s"} total`,
    "",
    "FILL-BASED DESIGN — CRITICAL:",
    "  Every path is a SOLID BLACK FILLED SHAPE. There is no stroke — only fill.",
    "  This means: the path boundary must enclose a solid region.",
    "  A path that traces a thin band/ring will look like a thin ring. That is wrong.",
    "  A path that encloses the full body of the subject will look like a solid silhouette. That is correct.",
    "",
    "HOLES IN SHAPES (evenodd):",
    "  Use fill-rule=\"evenodd\" for shapes with holes (eye, ring):",
    '  <path fill-rule="evenodd" d="M...outer...Z M...inner cutout...Z" fill="#000000" stroke="none"/>',
  ];

  // Complexity-specific instructions
  if (complexity <= 1) {
    lines.push(
      "",
      "━━━ COMPLEXITY: PURE SOLID SILHOUETTE ━━━",
      "Generate EXACTLY ONE closed path — the outer boundary of a SOLID filled shape.",
      "",
      "CRITICAL CONCEPT — solid shape vs stroke drawing:",
      "  SOLID SHAPE (CORRECT): the path encloses a filled region — like a fish-shaped cookie cutter.",
      "    When you fill this path with red, the ENTIRE fish body is solid red. No holes.",
      "  STROKE DRAWING (WRONG): the path traces along the body like a thick pen, creating a hollow ring.",
      "    This is like drawing a fish outline with a marker — it has a hollow middle.",
      "",
      "You must generate a SOLID SHAPE, not a stroke drawing.",
      "",
      "How to do it — trace the outer boundary of the SILHOUETTE:",
      "  • Imagine the subject as a flat paper cut-out lying on a table",
      "  • The path is the scissors line — trace around the OUTER EDGE of the whole object",
      "  • Start at one point → trace the complete outer perimeter → close with Z",
      "  • NEVER double back along the same edge to create a band/ring",
      "",
      "STRICTLY FORBIDDEN:",
      "  • Drawing both the outer AND inner edge of a shape (creates a hollow ring)",
      "  • Any interior lines, decorations, or details",
      "  • Multiple separate paths",
      "",
      "EXAMPLE — 'simple fish silhouette':",
      "  ✓ CORRECT: M (mouth tip) C (curve up along top of body) ... (around tail fin notch) ... C (curve back along bottom) Z",
      "     → fills as a solid fish shape. The entire interior is filled.",
      "  ✗ WRONG: a figure-8 / ring path that outlines the fish body like a thick stroke",
      "     → creates a doughnut/hollow fish — the middle is empty",
    );
  } else if (complexity <= 2) {
    lines.push(
      "",
      "━━━ COMPLEXITY: SOLID SILHOUETTE + 1 ACCENT ━━━",
      "Generate two paths:",
      "  1. The outer boundary — a SOLID filled silhouette of the subject (not a stroke drawing)",
      "  2. ONE simple accent shape (e.g. a small eye circle, a badge, a simple emblem)",
      "The accent must be a small simple closed shape, completely separate from the outer boundary.",
      "Both paths must be solid closed shapes — no hollow rings, no stroke drawings.",
      "Total: maximum 2 paths.",
    );
  } else if (complexity <= 3) {
    lines.push(
      "",
      "━━━ COMPLEXITY: SOLID SILHOUETTE WITH ACCENTS ━━━",
      "Generate the outer boundary (solid filled silhouette) plus up to 3 simple accent shapes.",
      "Each path = a clean SOLID closed shape. No hollow rings. No stroke drawings.",
      "Accents must be clearly separated from each other and from the outer boundary.",
      "Total: maximum 4 paths.",
    );
  } else if (complexity <= 4) {
    lines.push(
      "",
      "━━━ COMPLEXITY: MEDIUM DETAIL ━━━",
      "Generate the outer boundary plus recognizable interior features.",
      "Keep shapes bold and simple — each path must be clearly visible at thumbnail size.",
      "Total: maximum 8 paths.",
    );
  } else {
    lines.push(
      "",
      "━━━ COMPLEXITY: DETAILED ━━━",
      "Generate a detailed design with outer boundary and interior features.",
      "All paths must still be bold closed shapes — no decorative lines, hatching, or crosshatching.",
      "Total: maximum 12 paths.",
    );
  }

  if (cutterProof) {
    lines.push(
      "",
      "ONE-PIECE CONSTRAINT (strictly required):",
      "  The design must stay as ONE connected physical piece after cutting.",
      "  No isolated floating islands — every part must connect to the outer boundary.",
      "  If adding interior holes, use compound paths (fill-rule=evenodd).",
    );
  }

  if (language === "nl") {
    lines.push("", "The user prompt is written in Dutch. Interpret it correctly.");
  }

  return lines.join("\n");
}

// ── Recraft (recraftv4_1_vector) ─────────────────────────────────────────────

async function generateWithRecraft(input: AiSvgInput): Promise<string> {
  const { prompt, cutterProof, complexity, language, settings, onProgress } = input;
  const nl = language === "nl";
  onProgress?.({ step: 1, total: 2, label: nl ? "Vector genereren met Recraft…" : "Generating vector with Recraft…" });
  const apiKey = settings.recraftKey.trim();

  if (!apiKey) {
    throw new Error(
      language === "nl"
        ? "Geen Recraft API-sleutel ingesteld. Open de instellingen om er een toe te voegen."
        : "No Recraft API key configured. Open settings to add one.",
    );
  }

  const fullPrompt = buildRecraftPrompt(prompt, complexity, cutterProof, language);

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

function buildRecraftPrompt(prompt: string, complexity: number, cutterProof: boolean, language: Language): string {
  // Recraft is a visual model — describe the visual style, not the machine process
  let styleEn: string;
  let styleNl: string;

  if (complexity <= 1) {
    styleEn = "solid filled silhouette shape, flat monochrome icon, single closed outline with solid interior — NOT a stroke drawing or hollow ring, like a paper cut-out sticker, no interior lines or details";
    styleNl = "gevuld silhouet, plat eénkleurig icoon, gesloten buitenlijn met gevuld binnengebied — GEEN streektekening of holle ring, zoals een uitgesneden sticker";
  } else if (complexity <= 2) {
    styleEn = "simple bold vector shape with outer silhouette and one simple interior accent, flat icon style, no complex detail";
    styleNl = "eenvoudige vector vorm met buitencontour en één eenvoudig accent, plat icoon stijl";
  } else if (complexity <= 3) {
    styleEn = "bold flat vector icon, clear outer silhouette with 2-3 simple interior shapes, no hatching or decorative lines";
    styleNl = "vette platte vector icoon, duidelijke buitencontour met 2-3 eenvoudige binnenvormen";
  } else if (complexity <= 4) {
    styleEn = "bold flat vector illustration, clear shapes, moderate detail, no crosshatching, clean bold outlines";
    styleNl = "vette platte vector illustratie, duidelijke vormen, matige details, geen arcering";
  } else {
    styleEn = "detailed flat vector illustration, multiple bold clean shapes, rich but cuttable design";
    styleNl = "gedetailleerde platte vector illustratie, meerdere vette schone vormen";
  }

  const nl = language === "nl";
  const base = nl
    ? `${prompt}, ${styleNl}, zwarte contouren, transparante achtergrond, geen kleurblokken`
    : `${prompt}, ${styleEn}, black outlines, transparent background, no color fills`;

  if (cutterProof) {
    return nl
      ? `${base}, alle onderdelen verbonden als één stuk, geen losse eilanden`
      : `${base}, all parts connected as one piece, no floating islands`;
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
