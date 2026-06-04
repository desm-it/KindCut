import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { WorkspaceObject } from "../../workspace-objects";

export function TextEditOverlay({
  item,
  onCommit,
  onCancel,
}: {
  item: WorkspaceObject;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const tc = item.textContent!;
  const [value, setValue] = useState(tc.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Font size in CSS pixels: item div is sized to frame*scaleX, so fontSize*scaleX matches SVG.
  const scaledFontSize = tc.fontSize * item.transform.scaleX;

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
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      style={{
        fontFamily: tc.fontFamily,
        fontSize: scaledFontSize,
        fontWeight: tc.fontWeight,
        fontStyle: tc.fontStyle,
        textDecoration: tc.textDecoration,
        textAlign: tc.textAlign ?? "left",
        letterSpacing: (tc.letterSpacing * item.transform.scaleX) + "px",
        lineHeight: tc.lineHeight,
        color: tc.color,
        width: "100%",
        height: "100%",
      }}
    />
  );
}
