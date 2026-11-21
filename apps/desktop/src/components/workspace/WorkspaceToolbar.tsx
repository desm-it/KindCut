import type React from 'react';
import type { Language } from '../../i18n';

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
  // data-label feeds the hover tooltip, which only shows when the window is too narrow for the text.
  return (
    <button
      type="button"
      className="toolbar-btn"
      data-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="toolbar-btn__label">{label}</span>
    </button>
  );
}

/**
 * The top bar's few always-needed actions, each with a text label. Actions on
 * the selected object live in the SelectionActionBar next to that object.
 */
export function WorkspaceToolbar({
  language,
  canUndo,
  canRedo,
  projectSaving,
  projectOpening,
  onOpen,
  onSave,
  onUndo,
  onRedo,
}: {
  language: Language;
  canUndo: boolean;
  canRedo: boolean;
  projectSaving: boolean;
  projectOpening: boolean;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => boolean;
  onRedo: () => boolean;
}) {
  const nl = language === 'nl';
  return (
    <nav
      className="workspace-toolbar no-drag"
      role="toolbar"
      aria-label={nl ? 'Werkbalk' : 'Toolbar'}
    >
      <div className="toolbar-group">
        {/* Open — folder */}
        <ToolbarBtn
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.586a1 1 0 0 1 .707.293L10.5 6.5H15.5A1.5 1.5 0 0 1 17 8v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14V6.5z" />
            </svg>
          }
          label={nl ? 'Openen' : 'Open'}
          onClick={onOpen}
          disabled={projectOpening || projectSaving}
        />
        {/* Save — floppy disk */}
        <ToolbarBtn
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <rect x="7" y="3" width="6" height="5" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="6" y="11" width="8" height="5" rx="1" />
            </svg>
          }
          label={nl ? 'Opslaan' : 'Save'}
          onClick={onSave}
          disabled={projectOpening || projectSaving}
        />
      </div>
      <div className="toolbar-sep" aria-hidden="true" />
      <div className="toolbar-group">
        {/* Undo — arrow curving back */}
        <ToolbarBtn
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 4 3.5 7.5 7 11" />
              <path d="M3.5 7.5h8a5 5 0 0 1 0 10H8" />
            </svg>
          }
          label={nl ? 'Ongedaan maken' : 'Undo'}
          onClick={onUndo}
          disabled={!canUndo}
        />
        {/* Redo — arrow curving forward */}
        <ToolbarBtn
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 4l3.5 3.5L13 11" />
              <path d="M16.5 7.5h-8a5 5 0 0 0 0 10H12" />
            </svg>
          }
          label={nl ? 'Opnieuw' : 'Redo'}
          onClick={onRedo}
          disabled={!canRedo}
        />
      </div>
    </nav>
  );
}
