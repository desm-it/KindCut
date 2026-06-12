import type { UpdateState } from "../../shell/preload";
import { formatFileSize } from "../../svg-import";

type UpdateModalProps = {
  state: UpdateState;
  busy: boolean;
  onDownloadNow: () => void;
  onDownloadBackground: () => void;
  onRestart: () => void;
  onLater: () => void;
};

function formatSpeed(bytesPerSecond?: number): string | null {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return null;
  }
  return `${formatFileSize(bytesPerSecond)}/s`;
}

function progressCopy(state: UpdateState): string | null {
  const progress = state.progress;
  if (!progress) {
    return null;
  }
  const transferred = progress.transferred ? formatFileSize(progress.transferred) : null;
  const total = progress.total ? formatFileSize(progress.total) : null;
  const speed = formatSpeed(progress.bytesPerSecond);
  return [transferred && total ? `${transferred} of ${total}` : null, speed].filter(Boolean).join(" · ") || null;
}

export function UpdateModal({
  state,
  busy,
  onDownloadNow,
  onDownloadBackground,
  onRestart,
  onLater,
}: UpdateModalProps) {
  if (!state.visible) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, state.progress?.percent ?? (state.status === "ready" ? 100 : 0)));
  const canDownload = state.status === "available";
  const canRestart = state.status === "ready";
  const canClose = !busy && state.status !== "installing";
  const showProgress = state.status === "downloading" || state.status === "ready";
  const detail = state.detail ?? progressCopy(state);

  return (
    <div className="cut-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && canClose) onLater(); }}>
      <div className="cut-modal cut-modal--narrow update-modal" role="dialog" aria-modal="true" onKeyDown={(event) => event.stopPropagation()}>
        <div className="cut-modal__header">
          <h2 className="cut-modal__title">KindCut Update</h2>
          {canClose ? (
            <button type="button" className="cut-modal__close" onClick={onLater} aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          ) : null}
        </div>
        <div className="cut-modal__body cut-modal__body--col">
          <div className={`update-modal__status update-modal__status--${state.status}`}>
            <span className="update-modal__dot" aria-hidden="true" />
            <div>
              <p className="update-modal__title">{state.message ?? "Checking for updates..."}</p>
              {detail ? <p className="update-modal__detail">{detail}</p> : null}
            </div>
          </div>

          {showProgress ? (
            <div className="update-modal__progress" aria-label="Update download progress">
              <div className="update-modal__progress-track">
                <div className="update-modal__progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="update-modal__progress-meta">
                <span>{Math.round(percent)}%</span>
                <span>{progressCopy(state)}</span>
              </div>
            </div>
          ) : null}

          {state.status === "installing" ? (
            <p className="update-modal__hint">KindCut may close for a moment while the installer takes over.</p>
          ) : null}
        </div>
        <div className="cut-modal__footer update-modal__footer">
          {canDownload ? (
            <>
              <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={busy} onClick={onDownloadBackground}>
                Download in background
              </button>
              <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={busy} onClick={onDownloadNow}>
                Download now
              </button>
            </>
          ) : null}
          {canRestart ? (
            <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={busy} onClick={onRestart}>
              Restart and update
            </button>
          ) : null}
          {state.status === "not-available" || state.status === "failed" ? (
            <button type="button" className="cut-modal__btn cut-modal__btn--primary" disabled={busy} onClick={onLater}>
              OK
            </button>
          ) : null}
          {canClose && state.status !== "not-available" && state.status !== "failed" ? (
            <button type="button" className="cut-modal__btn cut-modal__btn--secondary" disabled={busy} onClick={onLater}>
              Later
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
