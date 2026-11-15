import type React from "react";
import type { Language } from "../../i18n";

function ActionBtn({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`selection-bar__btn${danger ? " selection-bar__btn--danger" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

const ICON = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * Labelled actions for the selected object(s), shown right next to the
 * selection. Only actions that apply to the current selection are listed.
 */
export function SelectionActionBar({
  language,
  canGroup,
  canUngroup,
  canReorder,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onFlipX,
  onFlipY,
  onBringForward,
  onSendBackward,
}: {
  language: Language;
  canGroup: boolean;
  canUngroup: boolean;
  canReorder: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onFlipX: () => void;
  onFlipY: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
}) {
  const nl = language === "nl";
  return (
    <div className="selection-bar__buttons" role="toolbar" aria-label={nl ? "Acties voor de selectie" : "Selection actions"}>
      <ActionBtn
        icon={<svg aria-hidden="true" {...ICON}><rect x="7" y="7" width="9" height="10" rx="1.5"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 5v7.5A1.5 1.5 0 0 0 4 14h3"/></svg>}
        label={nl ? "Dupliceren" : "Duplicate"}
        onClick={onDuplicate}
      />
      <ActionBtn
        icon={
          <svg aria-hidden="true" {...ICON} strokeWidth={1.4}>
            <line x1="10" y1="2" x2="10" y2="18" strokeDasharray="2 1.5" strokeWidth="1.2"/>
            <path d="M9 5 L9 15 L3 10 Z" fill="currentColor" stroke="none"/>
            <path d="M11 5 L11 15 L17 10 Z" fill="currentColor" stroke="none" fillOpacity="0.35"/>
          </svg>
        }
        label={nl ? "Spiegelen" : "Mirror"}
        onClick={onFlipX}
      />
      <ActionBtn
        icon={
          <svg aria-hidden="true" {...ICON} strokeWidth={1.4}>
            <line x1="2" y1="10" x2="18" y2="10" strokeDasharray="2 1.5" strokeWidth="1.2"/>
            <path d="M5 9 L15 9 L10 3 Z" fill="currentColor" stroke="none"/>
            <path d="M5 11 L15 11 L10 17 Z" fill="currentColor" stroke="none" fillOpacity="0.35"/>
          </svg>
        }
        label={nl ? "Omkeren" : "Flip"}
        onClick={onFlipY}
      />
      {canReorder ? (
        <>
          <ActionBtn
            icon={<svg aria-hidden="true" {...ICON} strokeWidth={1.4}><rect x="7" y="3" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/><path d="M3 8.5v6.5a1.5 1.5 0 0 0 1.5 1.5H11"/></svg>}
            label={nl ? "Naar voren" : "Forward"}
            onClick={onBringForward}
          />
          <ActionBtn
            icon={<svg aria-hidden="true" {...ICON} strokeWidth={1.4}><path d="M9 5h6.5A1.5 1.5 0 0 1 17 6.5V13"/><rect x="3" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></svg>}
            label={nl ? "Naar achteren" : "Backward"}
            onClick={onSendBackward}
          />
        </>
      ) : null}
      {canGroup ? (
        <ActionBtn
          icon={<svg aria-hidden="true" {...ICON} strokeWidth={1.4}><rect x="2" y="2" width="16" height="16" rx="2" strokeDasharray="3 2"/><rect x="4" y="4" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/></svg>}
          label={nl ? "Groeperen" : "Group"}
          onClick={onGroup}
        />
      ) : null}
      {canUngroup ? (
        <ActionBtn
          icon={<svg aria-hidden="true" {...ICON} strokeWidth={1.4}><rect x="2" y="5" width="7" height="7" rx="1.5"/><rect x="11" y="8" width="7" height="7" rx="1.5"/><path d="M9 8.5l2 1.5M9 10l2-1" strokeWidth="1" strokeDasharray="2 1.5"/></svg>}
          label={nl ? "Losmaken" : "Ungroup"}
          onClick={onUngroup}
        />
      ) : null}
      <ActionBtn
        icon={<svg aria-hidden="true" {...ICON}><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.5l.75 10a1.5 1.5 0 0 0 1.5 1.5h4.5a1.5 1.5 0 0 0 1.5-1.5l.75-10"/><path d="M8.5 9v4M11.5 9v4"/></svg>}
        label={nl ? "Verwijderen" : "Delete"}
        onClick={onDelete}
        danger
      />
    </div>
  );
}
