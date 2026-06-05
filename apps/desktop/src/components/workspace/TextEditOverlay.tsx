import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { WorkspaceObject } from "../../workspace-objects";

export function TextEditOverlay({
  item,
  onChange,
  onCommit,
  onCancel,
}: {
  item: WorkspaceObject;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const tc = item.textContent!;
  const [value, setValue] = useState(tc.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Font size in CSS pixels. The display SVG uses preserveAspectRatio="xMinYMin meet",
  // so its text scales uniformly by min(scaleX, scaleY) — never by scaleX alone. The
  // overlay must use the *same* factor or the text jumps size when you commit a box
  // that was resized on a single axis (scaleX !== scaleY).
  const displayScale = Math.min(item.transform.scaleX, item.transform.scaleY);
  const scaledFontSize = tc.fontSize * displayScale;

  // Click anywhere outside the overlay commits and exits edit mode
  useEffect(() => {
    function handleGlobalDown(e: globalThis.PointerEvent) {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        onCommit(value);
      }
    }
    document.addEventListener("pointerdown", handleGlobalDown, { capture: true });
    return () => document.removeEventListener("pointerdown", handleGlobalDown, { capture: true });
  }, [value, onCommit]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation();
    if (e.key === "Escape") { onCancel(); }
  }

  return (
    <textarea
      ref={textareaRef}
      autoFocus
      className="text-edit-overlay"
      value={value}
      wrap="off"
      onChange={(e) => {
        // Push live so the item frame re-measures and the box grows to fit the text.
        setValue(e.target.value);
        onChange(e.target.value);
      }}
      onKeyDown={handleKeyDown}
      style={{
        fontFamily: tc.fontFamily,
        fontSize: scaledFontSize,
        fontWeight: tc.fontWeight,
        fontStyle: tc.fontStyle,
        textDecoration: tc.textDecoration,
        textAlign: tc.textAlign ?? "left",
        letterSpacing: (tc.letterSpacing * displayScale) + "px",
        lineHeight: tc.lineHeight,
        color: tc.color,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        whiteSpace: "pre",
      }}
    />
  );
}
