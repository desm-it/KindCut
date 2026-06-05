import { type Language, createTranslator } from "../../i18n";
import type { WorkspaceSvgItem } from "../../workspace-objects";
import { buildWorkspaceObjectSvg } from "../../workspace-objects";
import { preflightSvg } from "@cricut-companion/svg-preflight";
import { getFriendlySvgMessages } from "../../svg-import";
import { getSandboxedSvgPreview } from "../../utils/svg-normalize";
import { DEBUG } from "../../dev-flags";

export function EmptyImportState({ language }: { language: Language }) {
  const { t } = createTranslator(language);

  return (
    <div className="import-empty">
      <div className="paper-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{t("import.empty")}</p>
    </div>
  );
}

export function ImportedSvgPreview({ importedSvg, language }: { importedSvg: WorkspaceSvgItem; language: Language }) {
  const { t } = createTranslator(language);
  const svg = buildWorkspaceObjectSvg(importedSvg);
  const preflight = preflightSvg(svg);
  const friendlyMessages = getFriendlySvgMessages(preflight, language);
  const isReady = preflight.ok && preflight.warnings.length === 0;

  return (
    <div className="import-preview-grid">
      <div className="svg-preview-frame">
        <iframe title={t("import.previewTitle", { fileName: importedSvg.fileName })} sandbox="" srcDoc={getSandboxedSvgPreview(svg)} />
      </div>

      <div className="import-summary">
        <p className="panel-label">{t("import.chosenFile")}</p>
        <h3>{importedSvg.fileName}</h3>
        <dl className="friendly-list compact-list">
          <dt>{t("import.file")}</dt>
          <dd>{importedSvg.fileSize}</dd>
          <dt>{t("import.artwork")}</dt>
          <dd>{importedSvg.sizeCopy}</dd>
        </dl>

        <div className={`svg-check svg-check--${isReady ? "ready" : "warning"}`}>
          <h3>{isReady ? t("import.readyTitle") : t("import.warningTitle")}</h3>
          {friendlyMessages.length > 0 ? (
            <ul className="plain-list">
              {friendlyMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : (
            <p>{t("import.readyMessage")}</p>
          )}
        </div>

        {DEBUG && (
          <>
            <details>
              <summary>{t("details.svgCheck")}</summary>
              <pre>
                {[
                  preflight.issues.length > 0
                    ? `Issues:\n${preflight.issues.join("\n")}`
                    : "Issues: none",
                  preflight.warnings.length > 0
                    ? `Warnings:\n${preflight.warnings.join("\n")}`
                    : "Warnings: none",
                ].join("\n\n")}
              </pre>
            </details>

            <details>
              <summary>{t("details.rawSvg")}</summary>
              <pre>{svg}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
