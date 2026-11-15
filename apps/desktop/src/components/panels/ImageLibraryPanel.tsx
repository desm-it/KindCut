import { useState } from "react";
import type { ChangeEvent } from "react";
import type { Language } from "../../i18n";
import type { LibraryImage } from "../../app-types";

export function ImageLibraryPanel({
  language,
  hasActiveAiKey,
  images,
  loading,
  onAskAi,
  onFileImport,
  onDotPrintImport,
  onUseImage,
  onRenameImage,
  onDeleteImage,
}: {
  language: Language;
  hasActiveAiKey: boolean;
  images: LibraryImage[];
  loading: boolean;
  onAskAi: () => void;
  onFileImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onDotPrintImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onUseImage: (img: LibraryImage) => void;
  onRenameImage: (path: string, name: string) => Promise<void>;
  onDeleteImage: (path: string) => void;
}) {
  const nl = language === "nl";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "ai" | "uploaded">("all");
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const filtered = images.filter((img) => {
    if (filter === "ai" && !img.isAi) return false;
    if (filter === "uploaded" && img.isAi) return false;
    if (search.trim()) {
      return img.name.toLowerCase().includes(search.trim().toLowerCase());
    }
    return true;
  });

  function svgPreviewSrc(svg: string): string {
    try {
      const PREVIEW_COLOR = "#2f2a26";
      const styled = svg
        .replace(/\sfill="[^"]*"/gi, ` fill="${PREVIEW_COLOR}"`)
        .replace(/\sfill='[^']*'/gi, ` fill='${PREVIEW_COLOR}'`)
        .replace(/\sstroke="[^"]*"/gi, ' stroke="none"')
        .replace(/\sstroke='[^']*'/gi, " stroke='none'")
        .replace(/\sstroke-width="[^"]*"/gi, "")
        .replace(/\sstroke-width='[^']*'/gi, "");
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(styled)))}`;
    } catch {
      return "";
    }
  }

  function beginRename(img: LibraryImage) {
    setConfirmDeletePath(null);
    setRenameError(null);
    setRenamingPath(img.path);
    setRenameValue(img.name);
  }

  async function commitRename(img: LibraryImage) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === img.name) {
      setRenamingPath(null);
      setRenameError(null);
      return;
    }

    setRenameBusy(true);
    setRenameError(null);
    try {
      await onRenameImage(img.path, trimmed);
      setRenamingPath(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <aside className="image-library no-drag" aria-label={nl ? "Afbeeldingsbibliotheek" : "Image library"}>
      <div className="image-library__actions">
        <label className="image-library__action">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M2 10.5 5.5 7l2.5 2.5 2-2 4 4"/><circle cx="10.5" cy="5.5" r="1.2" fill="currentColor" stroke="none"/></svg>
          <span>
            <strong>{nl ? "Eigen afbeelding" : "Your own image"}</strong>
            <small>{nl ? "Kies een SVG, PNG of JPG van je computer" : "Pick an SVG, PNG or JPG from your computer"}</small>
          </span>
          <input type="file" accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg" multiple onChange={onFileImport} />
        </label>
        <button type="button" className="image-library__action" onClick={onAskAi}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 1L9.5 5.5H14L10.5 8.5L12 13L8 10.5L4 13L5.5 8.5L2 5.5H6.5Z"/></svg>
          <span>
            <strong>{nl ? "Laat AI tekenen" : "Let AI draw it"}</strong>
            <small>
              {hasActiveAiKey
                ? (nl ? "Beschrijf wat je wilt, AI maakt de vorm" : "Describe what you want, AI makes the shape")
                : (nl ? "Heeft eerst een AI-sleutel nodig (Instellingen)" : "Needs an AI key first (Settings)")}
            </small>
          </span>
        </button>
        <label className="image-library__action">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="4" r="1.3"/><circle cx="8" cy="4" r="1.3"/><circle cx="12" cy="4" r="1.3"/>
            <circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/>
            <circle cx="4" cy="12" r="1.3"/><circle cx="8" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/>
          </svg>
          <span>
            <strong>{nl ? "Foto als stippen" : "Photo as dots"}</strong>
            <small>{nl ? "Pennen tekenen een foto in stippen na" : "Pens redraw a photo in dots"}</small>
          </span>
          <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={onDotPrintImport} />
        </label>
      </div>

      {/* Search and filters only earn their space once there is something to find. */}
      {images.length > 0 ? (
        <>
          <p className="image-library__heading">{nl ? "Eerder gebruikt" : "Used before"}</p>
          <input
            type="search"
            className="image-library__search"
            placeholder={nl ? "Zoeken…" : "Search…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="image-library__filters">
            {(["all", "ai", "uploaded"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`image-library__filter${filter === f ? " image-library__filter--active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? (nl ? "Alles" : "All") : f === "ai" ? "AI" : (nl ? "Eigen" : "Own")}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {loading ? (
        <div className="image-library__empty">{nl ? "Laden…" : "Loading…"}</div>
      ) : filtered.length === 0 ? (
        <div className="image-library__empty">
          {search.trim() || images.length > 0
            ? (nl ? "Geen resultaten" : "No results")
            : (nl
              ? "Afbeeldingen die je toevoegt blijven hier staan, zodat je ze later opnieuw kunt gebruiken."
              : "Images you add stay here, so you can use them again later.")}
        </div>
      ) : (
        <div className="image-library__grid">
          {filtered.map((img) => {
            const isRenaming = renamingPath === img.path;
            return (
            <div key={img.path} className="image-tile" onClick={() => { if (confirmDeletePath !== img.path && !isRenaming) onUseImage(img); }}>
              <img
                className="image-tile__preview"
                src={svgPreviewSrc(img.svg)}
                alt={img.name}
                draggable={false}
              />
              <span className="image-tile__badge">
                {img.isAi
                  ? <svg viewBox="0 0 12 12" fill="currentColor" aria-label="AI"><path d="M6 0l1.2 3.8H11L7.9 6.2l1.2 3.8L6 7.8 2.9 10l1.2-3.8L1 3.8h3.8Z"/></svg>
                  : <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-label="Uploaded"><circle cx="6" cy="4" r="2.5"/><path d="M1.5 11c0-2.5 9-2.5 9 0"/></svg>
                }
              </span>
              {confirmDeletePath === img.path ? (
                <div className="image-tile__confirm" onClick={(e) => e.stopPropagation()}>
                  <span>{nl ? "Verwijderen?" : "Delete?"}</span>
                  <button type="button" className="image-tile__confirm-yes" onClick={(e) => { e.stopPropagation(); onDeleteImage(img.path); setConfirmDeletePath(null); }}>
                    {nl ? "Ja" : "Yes"}
                  </button>
                  <button type="button" className="image-tile__confirm-no" onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(null); }}>
                    {nl ? "Nee" : "No"}
                  </button>
                </div>
              ) : isRenaming ? (
                <form
                  className="image-tile__rename"
                  onClick={(e) => e.stopPropagation()}
                  onSubmit={(e) => { e.preventDefault(); void commitRename(img); }}
                >
                  <textarea
                    className="image-tile__rename-input"
                    value={renameValue}
                    disabled={renameBusy}
                    autoFocus
                    rows={2}
                    onChange={(e) => setRenameValue(e.target.value.replace(/\s+/g, " "))}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitRename(img);
                      }
                      if (e.key === "Escape") {
                        setRenamingPath(null);
                        setRenameError(null);
                      }
                    }}
                  />
                  {renameError ? <span className="image-tile__rename-error">{renameError}</span> : null}
                  <div className="image-tile__rename-actions">
                    <button
                      type="submit"
                      className="image-tile__rename-btn image-tile__rename-btn--save"
                      disabled={renameBusy}
                      title={nl ? "Opslaan" : "Save"}
                      aria-label={nl ? "Opslaan" : "Save"}
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4.5"/></svg>
                    </button>
                    <button
                      type="button"
                      className="image-tile__rename-btn image-tile__rename-btn--cancel"
                      disabled={renameBusy}
                      title={nl ? "Annuleren" : "Cancel"}
                      aria-label={nl ? "Annuleren" : "Cancel"}
                      onClick={() => { setRenamingPath(null); setRenameError(null); }}
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="image-tile__tool image-tile__tool--delete"
                  title={nl ? "Verwijderen" : "Delete"}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(img.path); }}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M2 3.5h10M5.5 3.5V2.5h3v1M4 3.5l.7 8h4.6l.7-8"/></svg>
                </button>
              )}
              <span
                className="image-tile__name"
                title={nl ? "Dubbelklik om te hernoemen" : "Double-click to rename"}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); beginRename(img); }}
              >
                {img.name}
              </span>
            </div>
          );})}
        </div>
      )}
    </aside>
  );
}
