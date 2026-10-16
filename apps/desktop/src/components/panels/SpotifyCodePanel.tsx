import { useEffect, useRef, useState } from "react";
import type { Language } from "../../i18n";
import type { SpotifyCode, SpotifyCodeErrorCode, SpotifySearchResult } from "../../app-types";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

function errorMessage(code: SpotifyCodeErrorCode, nl: boolean): string {
  switch (code) {
    case "busy":
      return nl ? "De zoekdienst is even druk. Probeer het zo opnieuw." : "The search service is busy. Try again in a moment.";
    case "not-found":
      return nl ? "Die Spotify-link bestaat niet (meer)." : "That Spotify link doesn't exist (anymore).";
    case "unsupported-link":
      return nl
        ? "Plak een link naar een nummer, album, playlist, artiest of podcast."
        : "Paste a link to a song, album, playlist, artist or podcast.";
    case "no-match":
      return nl
        ? "Dit nummer is niet op Spotify gevonden. Kopieer in Spotify de link (Delen → Link naar nummer kopiëren) en plak hem hier."
        : "Couldn't find this song on Spotify. In Spotify, choose Share → Copy song link and paste it here.";
    case "code-service":
      return nl ? "Spotify kon nu geen code maken. Probeer het later opnieuw." : "Spotify couldn't make a code right now. Try again later.";
    default:
      return nl
        ? "Geen verbinding met de muziekdiensten. Controleer je internet."
        : "Couldn't reach the music services. Check your internet connection.";
  }
}

function codePreviewSrc(svg: string): string {
  try {
    const styled = svg.replace(/\sfill="[^"]*"/gi, ' fill="#5a3a1a"');
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(styled)))}`;
  } catch {
    return "";
  }
}

export function SpotifyCodePanel({
  language,
  onUseCode,
}: {
  language: Language;
  onUseCode: (code: SpotifyCode) => void;
}) {
  const nl = language === "nl";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<SpotifyCodeErrorCode | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [codes, setCodes] = useState<SpotifyCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(true);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const searchRequestRef = useRef(0);
  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    let cancelled = false;
    const api = window.cricutCompanion?.spotify;
    if (!api) {
      setCodesLoading(false);
      return;
    }
    api.list()
      .then((items) => { if (!cancelled) setCodes(items); })
      .catch((err) => console.error("[Spotify] Failed to list saved codes:", err))
      .finally(() => { if (!cancelled) setCodesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Only the newest search may update the list; slower earlier replies are dropped.
    const requestId = ++searchRequestRef.current;
    setError(null);
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const api = window.cricutCompanion?.spotify;
      const response = api ? await api.search(trimmedQuery).catch(() => null) : null;
      if (requestId !== searchRequestRef.current) return;
      setSearching(false);
      if (response?.ok) {
        setResults(response.value);
      } else {
        setResults([]);
        setError(response ? response.code : "network");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);

  async function addResult(result: SpotifySearchResult) {
    const api = window.cricutCompanion?.spotify;
    if (!api || addingKey) return;
    setAddingKey(result.key);
    setError(null);
    try {
      const response = await api.create({
        title: result.title,
        titleShort: result.titleShort,
        artist: result.artist,
        album: result.album,
        spotifyUri: result.spotifyUri,
      });
      if (!response.ok) {
        setError(response.code);
        return;
      }
      const code = response.value;
      setCodes((current) =>
        [...current.filter((item) => item.path !== code.path), code].sort((a, b) => a.name.localeCompare(b.name)),
      );
      onUseCode(code);
    } catch {
      setError("network");
    } finally {
      setAddingKey(null);
    }
  }

  async function deleteCode(filePath: string) {
    setConfirmDeletePath(null);
    try {
      await window.cricutCompanion?.spotify?.delete(filePath);
      setCodes((current) => current.filter((code) => code.path !== filePath));
    } catch (err) {
      console.error("[Spotify] Failed to delete code:", err);
    }
  }

  return (
    <aside className="image-library spotify-library no-drag" aria-label={nl ? "Spotify-codes" : "Spotify codes"}>
      <input
        type="search"
        className="image-library__search"
        placeholder={nl ? "Zoek een nummer of plak een link" : "Search a song or paste a link"}
        aria-label={nl ? "Zoek een nummer of plak een Spotify-link" : "Search a song or paste a Spotify link"}
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />

      {error ? <p className="spotify-library__error" role="alert">{errorMessage(error, nl)}</p> : null}

      {showResults ? (
        <div className="spotify-library__list" aria-busy={searching}>
          {results.length === 0 ? (
            searching ? (
              <div className="image-library__empty">{nl ? "Zoeken…" : "Searching…"}</div>
            ) : error ? null : (
              <div className="image-library__empty">{nl ? "Geen nummers gevonden" : "No songs found"}</div>
            )
          ) : (
            results.map((result) => {
              const isAdding = addingKey === result.key;
              return (
                <button
                  key={result.key}
                  type="button"
                  className={`spotify-result${isAdding ? " spotify-result--adding" : ""}`}
                  disabled={addingKey !== null}
                  onClick={() => void addResult(result)}
                >
                  {result.coverUrl ? (
                    <img className="spotify-result__cover" src={result.coverUrl} alt="" draggable={false} />
                  ) : (
                    <span className="spotify-result__cover" aria-hidden="true" />
                  )}
                  <span className="spotify-result__text">
                    <strong>{result.title}</strong>
                    <span>{isAdding ? (nl ? "Code maken…" : "Making code…") : result.artist}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <>
          <h3 className="spotify-library__heading">{nl ? "Opgeslagen codes" : "Saved codes"}</h3>
          {codesLoading ? (
            <div className="image-library__empty">{nl ? "Laden…" : "Loading…"}</div>
          ) : codes.length === 0 ? (
            <div className="image-library__empty">
              {nl ? "Zoek een nummer om je eerste Spotify-code te maken." : "Search for a song to make your first Spotify code."}
            </div>
          ) : (
            <div className="spotify-library__list">
              {codes.map((code) => (
                <div
                  key={code.path}
                  className="image-tile"
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (confirmDeletePath !== code.path) onUseCode(code); }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && confirmDeletePath !== code.path) {
                      e.preventDefault();
                      onUseCode(code);
                    }
                  }}
                >
                  <img className="spotify-code-tile__preview" src={codePreviewSrc(code.svg)} alt="" draggable={false} />
                  <span className="spotify-code-tile__name" title={code.name}>{code.name}</span>
                  {confirmDeletePath === code.path ? (
                    <div className="image-tile__confirm spotify-code-tile__confirm" onClick={(e) => e.stopPropagation()}>
                      <span>{nl ? "Verwijderen?" : "Delete?"}</span>
                      <button type="button" className="image-tile__confirm-yes" onClick={() => void deleteCode(code.path)}>
                        {nl ? "Ja" : "Yes"}
                      </button>
                      <button type="button" className="image-tile__confirm-no" onClick={() => setConfirmDeletePath(null)}>
                        {nl ? "Nee" : "No"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="image-tile__tool image-tile__tool--delete"
                      title={nl ? "Verwijderen" : "Delete"}
                      aria-label={nl ? "Verwijderen" : "Delete"}
                      onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(code.path); }}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 3.5h10M5.5 3.5V2.5h3v1M4 3.5l.7 8h4.6l.7-8"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
