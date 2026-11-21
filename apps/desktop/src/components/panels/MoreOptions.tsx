import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Language } from '../../i18n';

const STORAGE_PREFIX = 'kindcutMoreOptions:';

function readOpen(id: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

/**
 * Tucks rarely needed settings behind "More options", so a panel shows only
 * the basics at first. Whether it is open is remembered per kind of panel.
 */
export function MoreOptions({
  id,
  language,
  children,
}: {
  id: string;
  language: Language;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id));
  const nl = language === 'nl';

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, next ? '1' : '0');
    } catch {
      // The choice just isn't remembered.
    }
  }

  return (
    <div className="more-options">
      <button type="button" className="more-options__toggle" aria-expanded={open} onClick={toggle}>
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
        >
          <path d="M4.5 2.5 8 6l-3.5 3.5" />
        </svg>
        {open ? (nl ? 'Minder opties' : 'Fewer options') : nl ? 'Meer opties' : 'More options'}
      </button>
      {open ? <div className="more-options__body">{children}</div> : null}
    </div>
  );
}
