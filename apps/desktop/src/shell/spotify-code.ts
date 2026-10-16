// Spotify code lookups for the editor's Spotify drawer.
//
// Spotify has no keyless search API, so a typed song is found in three hops,
// none of which need an API key or a Spotify account:
//   1. Deezer's public search API finds songs by free text (title, artist,
//      album, cover art).
//   2. ListenBrainz Labs maps that title/artist/album to Spotify track IDs.
//   3. Spotify's embed page confirms the ID is a real, playable track and
//      gives its official title and artists.
// Spotify's code service (scannables.scdn.co) then draws the scannable
// "soundwave" code for the URI. A pasted Spotify link skips hops 1 and 2.
//
// None of these are official integrations for this purpose, so every step
// degrades to a SpotifyCodeError code the UI can explain, instead of throwing.

export type SpotifySearchResult = {
  key: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  /** Known up front for pasted Spotify links; otherwise resolved when added. */
  spotifyUri: string | null;
  /** Deezer's title without its version suffix, used as a lookup fallback. */
  titleShort?: string;
};

export type SpotifyCodeRequest = Pick<SpotifySearchResult, "title" | "artist" | "album" | "spotifyUri" | "titleShort">;

export type SpotifyEntity = {
  uri: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  isPlayable: boolean;
};

export type SpotifyCodeErrorCode =
  | "network"
  | "busy"
  | "not-found"
  | "unsupported-link"
  | "no-match"
  | "code-service";

export type SpotifyLookupResult<T> = { ok: true; value: T } | { ok: false; code: SpotifyCodeErrorCode };

export class SpotifyCodeError extends Error {
  constructor(readonly code: SpotifyCodeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SpotifyCodeError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SpotifyLookupOptions = {
  userAgent: string;
  fetchImpl?: FetchLike;
};

const SPOTIFY_ENTITY_TYPES = ["track", "album", "playlist", "artist", "episode", "show"] as const;
const SPOTIFY_ID_PATTERN = /^[0-9A-Za-z]{22}$/;
const SPOTIFY_URI_PATTERN = /^spotify:(track|album|playlist|artist|episode|show):([0-9A-Za-z]{22})$/;
const SPOTIFY_SHORT_LINK_HOSTS = new Set(["spotify.link", "spotify.app.link"]);
const REQUEST_TIMEOUT_MS = 15_000;
const SEARCH_LIMIT = 12;
// Each candidate costs one embed-page fetch, so stop after a handful.
const MAX_TRACK_CANDIDATES = 5;

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Returns a canonical `spotify:<type>:<id>` URI for a Spotify URI or open.spotify.com link. */
export function parseSpotifyUri(input: string): string | null {
  const text = input.trim();
  const uriMatch = SPOTIFY_URI_PATTERN.exec(text);
  if (uriMatch) {
    return `spotify:${uriMatch[1]}:${uriMatch[2]}`;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.hostname !== "open.spotify.com" && url.hostname !== "play.spotify.com") {
    return null;
  }
  // Handles /track/<id>, /intl-nl/track/<id> and /embed/track/<id>.
  const parts = url.pathname.split("/").filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    const type = parts[index] as (typeof SPOTIFY_ENTITY_TYPES)[number];
    const id = parts[index + 1] ?? "";
    if (SPOTIFY_ENTITY_TYPES.includes(type) && SPOTIFY_ID_PATTERN.test(id)) {
      return `spotify:${type}:${id}`;
    }
  }
  return null;
}

export function isSpotifyShortLink(input: string): boolean {
  try {
    return SPOTIFY_SHORT_LINK_HOSTS.has(new URL(input.trim()).hostname);
  } catch {
    return false;
  }
}

/** True for anything that was clearly meant as a Spotify link, even an unsupported one. */
export function looksLikeSpotifyLink(input: string): boolean {
  const text = input.trim().toLowerCase();
  return text.startsWith("spotify:") || /^(https?:\/\/)?([a-z0-9-]+\.)*spotify\.(com|link|app\.link)\b/.test(text);
}

export function buildSpotifyCodeImageUrl(uri: string): string {
  return `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/640/${uri}`;
}

export function spotifyEmbedUrl(uri: string): string {
  const [, type, id] = uri.split(":");
  return `https://open.spotify.com/embed/${type}/${id}`;
}

export function spotifyCodeDisplayName(title: string, artist: string): string {
  return artist ? `${title} - ${artist}` : title;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickCoverUrl(entity: Record<string, unknown>): string | null {
  const images = asRecord(entity.visualIdentity)?.image;
  if (!Array.isArray(images)) {
    return null;
  }
  const sized = images
    .map((image) => ({ url: asString(asRecord(image)?.url), width: Number(asRecord(image)?.maxWidth) || 0 }))
    .filter((image) => image.url)
    .sort((a, b) => a.width - b.width);
  // The smallest image that still looks sharp as a 40px thumbnail on a retina screen.
  return (sized.find((image) => image.width >= 120) ?? sized[sized.length - 1])?.url ?? null;
}

/** Reads the entity JSON that Spotify's embed page ships in its __NEXT_DATA__ script. */
export function parseSpotifyEmbedEntity(html: string): SpotifyEntity | null {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
  const pageProps = asRecord(asRecord(asRecord(data)?.props)?.pageProps);
  const entity = asRecord(asRecord(asRecord(pageProps?.state)?.data)?.entity);
  const uri = parseSpotifyUri(asString(entity?.uri));
  if (!entity || !uri) {
    return null;
  }

  const type = uri.split(":")[1];
  const artists = Array.isArray(entity.artists)
    ? entity.artists.map((artist) => asString(asRecord(artist)?.name)).filter(Boolean)
    : [];
  // Albums, playlists and podcasts carry their artist/owner in `subtitle`;
  // an artist page's subtitle is just "Top tracks".
  const artist = artists.length > 0 ? artists.join(", ") : type === "artist" ? "" : asString(entity.subtitle);

  return {
    uri,
    title: asString(entity.name) || asString(entity.title),
    artist,
    coverUrl: pickCoverUrl(entity),
    isPlayable: entity.isPlayable !== false,
  };
}

/** Lower-cases and strips accents, bracketed versions and " - Remastered" style suffixes. */
export function normalizeSongTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s[-–—]\s.*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function songTitlesMatch(a: string, b: string): boolean {
  const left = normalizeSongTitle(a);
  const right = normalizeSongTitle(b);
  return Boolean(left && right) && (left === right || left.startsWith(right) || right.startsWith(left));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Turns the code service's SVG into a cut-ready library file: drops the
 * full-size background so only the logo and bars are cut, and records the
 * song and URI so the drawer can show the real title and skip duplicates.
 */
export function prepareSpotifyCodeSvg(svg: string, entity: Pick<SpotifyEntity, "uri" | "title" | "artist">): string {
  if (!/<svg\b[^>]*viewBox="0 0 400 100"/i.test(svg) || (svg.match(/<rect\b/gi)?.length ?? 0) < 20) {
    throw new SpotifyCodeError("code-service", "The Spotify code service returned an unexpected image.");
  }
  const withoutBackground = svg.replace(/<rect x="0" y="0" width="400" height="100"[^>]*\/>\s*/i, "");
  const label = escapeXml(spotifyCodeDisplayName(entity.title, entity.artist));
  return withoutBackground.replace(
    /<svg\b([^>]*)>/i,
    (_match, attributes: string) => `<svg${attributes} data-spotify-uri="${escapeXml(entity.uri)}">\n<title>${label}</title>`,
  );
}

export function readSpotifyCodeSvgInfo(svg: string): { uri: string | null; label: string | null } {
  const uri = /<svg\b[^>]*\bdata-spotify-uri="([^"]+)"/i.exec(svg)?.[1] ?? null;
  const label = /<title>([^<]*)<\/title>/i.exec(svg)?.[1] ?? null;
  return { uri: uri ? unescapeXml(uri) : null, label: label ? unescapeXml(label).trim() || null : null };
}

// ── Network ──────────────────────────────────────────────────────────────────

type RequestOptions = Omit<RequestInit, "headers" | "signal"> & { headers?: Record<string, string> };

async function request(url: string, options: SpotifyLookupOptions, init: RequestOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    return await fetchImpl(url, {
      ...init,
      headers: { "User-Agent": options.userAgent, ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpotifyCodeError("network", error instanceof Error ? error.message : String(error));
  }
}

async function requestJson(url: string, options: SpotifyLookupOptions, init?: RequestOptions): Promise<unknown> {
  const response = await request(url, options, init);
  if (response.status === 429 || response.status === 503) {
    throw new SpotifyCodeError("busy", `${url} answered ${response.status}`);
  }
  if (!response.ok) {
    throw new SpotifyCodeError("network", `${url} answered ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new SpotifyCodeError("network", `${url} returned invalid JSON`);
  }
}

/** Follows a spotify.link short link to the open.spotify.com URL it points at. */
async function expandSpotifyShortLink(link: string, options: SpotifyLookupOptions): Promise<string | null> {
  const response = await request(link.trim(), options, { redirect: "follow" });
  return parseSpotifyUri(response.url);
}

export async function fetchSpotifyEntity(uri: string, options: SpotifyLookupOptions): Promise<SpotifyEntity | null> {
  const response = await request(spotifyEmbedUrl(uri), options);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new SpotifyCodeError(response.status === 429 ? "busy" : "network", `Spotify embed answered ${response.status}`);
  }
  return parseSpotifyEmbedEntity(await response.text());
}

function deezerTrackToResult(track: unknown): SpotifySearchResult | null {
  const record = asRecord(track);
  const title = asString(record?.title);
  const artist = asString(asRecord(record?.artist)?.name);
  if (!record || !title || !artist) {
    return null;
  }
  const album = asRecord(record.album);
  return {
    key: `deezer:${String(record.id)}`,
    title,
    titleShort: asString(record.title_short) || undefined,
    artist,
    album: asString(album?.title),
    coverUrl: asString(album?.cover_medium) || asString(album?.cover_small) || null,
    spotifyUri: null,
  };
}

/** Free-text song search, or a direct lookup when the query is a Spotify link. */
export async function searchSpotifySongs(query: string, options: SpotifyLookupOptions): Promise<SpotifySearchResult[]> {
  const text = query.trim();
  if (!text) {
    return [];
  }

  const linkedUri = parseSpotifyUri(text) ?? (isSpotifyShortLink(text) ? await expandSpotifyShortLink(text, options) : null);
  if (linkedUri) {
    const entity = await fetchSpotifyEntity(linkedUri, options);
    if (!entity) {
      throw new SpotifyCodeError("not-found");
    }
    return [{ key: entity.uri, title: entity.title, artist: entity.artist, album: "", coverUrl: entity.coverUrl, spotifyUri: entity.uri }];
  }
  if (looksLikeSpotifyLink(text)) {
    throw new SpotifyCodeError("unsupported-link");
  }

  const data = asRecord(
    await requestJson(`https://api.deezer.com/search?q=${encodeURIComponent(text)}&limit=${SEARCH_LIMIT}`, options),
  );
  // Deezer reports errors (including its rate limit, code 4) as HTTP 200.
  const deezerError = asRecord(data?.error);
  if (deezerError) {
    throw new SpotifyCodeError(Number(deezerError.code) === 4 ? "busy" : "network", asString(deezerError.message));
  }
  const tracks = Array.isArray(data?.data) ? data.data : [];
  return tracks.map(deezerTrackToResult).filter((result): result is SpotifySearchResult => result !== null);
}

/** Asks ListenBrainz Labs for Spotify track IDs, trying looser title/album variants in one batch. */
export async function lookupSpotifyTrackIds(request: SpotifyCodeRequest, options: SpotifyLookupOptions): Promise<string[]> {
  const titles = [...new Set([request.title, request.titleShort].map((title) => title?.trim()).filter(Boolean))] as string[];
  const variants = titles.flatMap((title) =>
    [request.album.trim(), ""].map((album) => ({ artist_name: request.artist, release_name: album, track_name: title })),
  );
  const uniqueVariants = variants.filter(
    (variant, index) => variants.findIndex((other) => JSON.stringify(other) === JSON.stringify(variant)) === index,
  );

  const data = await requestJson("https://labs.api.listenbrainz.org/spotify-id-from-metadata/json", options, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(uniqueVariants),
  });
  const ids = (Array.isArray(data) ? data : []).flatMap((row) => {
    const trackIds = asRecord(row)?.spotify_track_ids;
    return Array.isArray(trackIds) ? trackIds.filter((id): id is string => typeof id === "string" && SPOTIFY_ID_PATTERN.test(id)) : [];
  });
  return [...new Set(ids)];
}

/** Resolves a search result to a confirmed Spotify entity. */
export async function resolveSpotifyEntity(request: SpotifyCodeRequest, options: SpotifyLookupOptions): Promise<SpotifyEntity> {
  if (request.spotifyUri) {
    const entity = await fetchSpotifyEntity(request.spotifyUri, options);
    if (!entity) {
      throw new SpotifyCodeError("not-found");
    }
    return entity;
  }

  const candidates = (await lookupSpotifyTrackIds(request, options)).slice(0, MAX_TRACK_CANDIDATES);
  let fallback: SpotifyEntity | null = null;
  for (const id of candidates) {
    const entity = await fetchSpotifyEntity(`spotify:track:${id}`, options);
    const titleMatches =
      entity && (songTitlesMatch(entity.title, request.title) || songTitlesMatch(entity.title, request.titleShort ?? ""));
    if (!entity || !titleMatches) {
      continue;
    }
    if (entity.isPlayable) {
      return entity;
    }
    // Region-locked releases still scan to the right song; prefer a playable one if there is one.
    fallback ??= entity;
  }
  if (fallback) {
    return fallback;
  }
  throw new SpotifyCodeError("no-match");
}

export async function fetchSpotifyCodeSvg(entity: SpotifyEntity, options: SpotifyLookupOptions): Promise<string> {
  const response = await request(buildSpotifyCodeImageUrl(entity.uri), options);
  if (!response.ok) {
    throw new SpotifyCodeError("code-service", `Spotify code service answered ${response.status}`);
  }
  return prepareSpotifyCodeSvg(await response.text(), entity);
}

export async function runSpotifyLookup<T>(
  task: () => Promise<T>,
  onError?: (error: unknown) => void,
): Promise<SpotifyLookupResult<T>> {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    onError?.(error);
    return { ok: false, code: error instanceof SpotifyCodeError ? error.code : "network" };
  }
}
