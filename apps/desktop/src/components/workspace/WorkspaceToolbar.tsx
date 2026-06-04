import type React from "react";
import type { Language } from "../../i18n";

function ToolbarBtn({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toolbar-btn"
      aria-label={label}
      data-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

export function WorkspaceToolbar({
  language,
  canCopy,
  canCut,
  canPaste,
  canDelete,
  canGroup,
  canUngroup,
  canFlip,
  canReorder,
  projectSaving,
  projectOpening,
  onOpen,
  onSave,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onGroup,
  onUngroup,
  onFlipX,
  onFlipY,
  onBringForward,
  onSendBackward,
}: {
  language: Language;
  canCopy: boolean;
  canCut: boolean;
  canPaste: boolean;
  canDelete: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canFlip: boolean;
  canReorder: boolean;
  projectSaving: boolean;
  projectOpening: boolean;
  onOpen: () => void;
  onSave: () => void;
  onCopy: () => boolean;
  onCut: () => boolean;
  onPaste: () => boolean;
  onDelete: () => boolean;
  onGroup: () => boolean;
  onUngroup: () => boolean;
  onBringForward: () => boolean;
  onSendBackward: () => boolean;
  onFlipX: () => boolean;
  onFlipY: () => boolean;
}) {
  const nl = language === "nl";
  return (
    <nav className="workspace-toolbar no-drag" role="toolbar" aria-label={nl ? "Werkbalk" : "Toolbar"}>
      <div className="toolbar-group">
        {/* Open — folder */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.586a1 1 0 0 1 .707.293L10.5 6.5H15.5A1.5 1.5 0 0 1 17 8v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14V6.5z"/></svg>}
          label={nl ? "Open" : "Open"}
          onClick={onOpen}
          disabled={projectOpening || projectSaving}
        />
        {/* Save — floppy disk */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><rect x="7" y="3" width="6" height="5" rx="0.5" fill="currentColor" stroke="none"/><rect x="6" y="11" width="8" height="5" rx="1"/></svg>}
          label={nl ? "Opslaan" : "Save"}
          onClick={onSave}
          disabled={projectOpening || projectSaving}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Copy — two overlapping pages */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="7" width="9" height="10" rx="1.5"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 5v7.5A1.5 1.5 0 0 0 4 14h3"/></svg>}
          label={nl ? "Kopieer" : "Copy"}
          onClick={onCopy}
          disabled={!canCopy}
        />
        {/* Cut — scissors */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="4.5" cy="6" r="2"/><circle cx="4.5" cy="14" r="2"/><path d="M6.5 7.5 17 13"/><path d="M6.5 12.5 17 7"/></svg>}
          label={nl ? "Knippen" : "Cut"}
          onClick={onCut}
          disabled={!canCut}
        />
        {/* Paste — clipboard */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="11" height="12" rx="1.5"/><path d="M8 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/><path d="M8 10h5M8 13h3"/></svg>}
          label={nl ? "Plakken" : "Paste"}
          onClick={onPaste}
          disabled={!canPaste}
        />
        {/* Delete — trash */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.75 10a1.5 1.5 0 0 0 1.5 1.5h4.5a1.5 1.5 0 0 0 1.5-1.5l.75-10"/><path d="M8.5 9v4M11.5 9v4"/></svg>}
          label={nl ? "Verwijder" : "Delete"}
          onClick={onDelete}
          disabled={!canDelete}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Group */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="2" strokeDasharray="3 2"/><rect x="4" y="4" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/></svg>}
          label={nl ? "Groeperen" : "Group"}
          onClick={onGroup}
          disabled={!canGroup}
        />
        {/* Ungroup */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="7" height="7" rx="1.5"/><rect x="11" y="8" width="7" height="7" rx="1.5"/><path d="M9 8.5l2 1.5M9 10l2-1" strokeWidth="1" strokeDasharray="2 1.5"/></svg>}
          label={nl ? "Groep opheffen" : "Ungroup"}
          onClick={onUngroup}
          disabled={!canUngroup}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Flip horizontal */}
        <ToolbarBtn
          icon={
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="10" y1="2" x2="10" y2="18" strokeDasharray="2 1.5" strokeWidth="1.2"/>
              <path d="M9 5 L9 15 L3 10 Z" fill="currentColor" stroke="none"/>
              <path d="M11 5 L11 15 L17 10 Z" fill="currentColor" stroke="none" fillOpacity="0.35"/>
            </svg>
          }
          label={nl ? "Spiegelen horizontaal" : "Flip horizontal"}
          onClick={onFlipX}
          disabled={!canFlip}
        />
        {/* Flip vertical */}
        <ToolbarBtn
          icon={
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" y1="10" x2="18" y2="10" strokeDasharray="2 1.5" strokeWidth="1.2"/>
              <path d="M5 9 L15 9 L10 3 Z" fill="currentColor" stroke="none"/>
              <path d="M5 11 L15 11 L10 17 Z" fill="currentColor" stroke="none" fillOpacity="0.35"/>
            </svg>
          }
          label={nl ? "Spiegelen verticaal" : "Flip vertical"}
          onClick={onFlipY}
          disabled={!canFlip}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Bring forward — stacked squares, front one raised */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="3" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/><path d="M3 8.5v6.5a1.5 1.5 0 0 0 1.5 1.5H11"/></svg>}
          label={nl ? "Naar voren" : "Bring forward"}
          onClick={onBringForward}
          disabled={!canReorder}
        />
        {/* Send backward — stacked squares, back one lowered */}
        <ToolbarBtn
          icon={<svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5h6.5A1.5 1.5 0 0 1 17 6.5V13"/><rect x="3" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></svg>}
          label={nl ? "Naar achteren" : "Send backward"}
          onClick={onSendBackward}
          disabled={!canReorder}
        />
      </div>
    </nav>
  );
}
