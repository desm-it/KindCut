# KindCut — TODO

Working backlog of bugs and features. Checkboxes track status. File pointers are
hints for where to start, not exhaustive.

---

## 🐞 Bugs

- [x] **Text size & text-edit size mismatch.** The on-canvas text, the inline edit
  overlay, and the committed/cut size don't stay consistent. The edit overlay scales
  `fontSize * transform.scaleX`, so editing a scaled or resized text box shows the
  wrong size and can jump when you commit.
  → `components/workspace/TextEditOverlay.tsx`, `handleTextContentChange` / text frame
  measuring in `App.tsx`.

- [x] **Keyboard shortcuts hijack text editing.** When editing/selecting text you
  can't reliably copy, paste, cut, or select-all — the global workspace shortcut
  handler (and the Electron Edit-menu accelerators) grab Cmd/Ctrl+C/V/X/A instead of
  the focused field. There's an `isEditableKeyboardTarget` guard but it isn't fully
  covering the cases (inline text overlay, native inputs).
  → `handleKeyDown` in `components/workspace/DesignWorkspace.tsx`,
  `handleDesktopAction` + menu accelerators in `App.tsx` / `shell/main.ts`.

- [x] **Shapes don't get a snug bounding box.** Imported SVGs are tightened with
  `computeSnugFrame` (so the selection box hugs the artwork), but shapes skip it —
  `createWorkspaceShapeItem` → `createWorkspaceObjectItem` never calls it, while
  `createWorkspaceSvgItem` does. Shapes should get the same tight frame.
  → `utils/workspace-factory.ts`.

- [x] **Cut status doesn't reset after finishing — can't cut again.** Once a cut
  session reaches `finished` (or error/stopped), `cutSession` is never cleared, so the
  UI stays in "cutting" state and a second cut can't be started. The poll loop only
  runs for `running`/`waiting`, so nothing resets it.
  → `cutSession` handling + poll effect in `App.tsx` (~L1246), `CutPreviewModal`.

- [x] **Can't deselect from a multi-selection.** Ctrl/Cmd+Click or Shift+Click adds
  objects to the selection, but clicking an already-selected object with the modifier
  doesn't remove it from the selection (toggle-off). The toggle-off branch in the
  item pointer-down handler only triggers under specific conditions and misses cases.
  → `handleItemPointerDown` (modifier + `selectedSvgIdSet.has`) in
  `components/workspace/DesignWorkspace.tsx`.

- [x] **Shapes missing from the cut preview.** Built-in shapes don't appear in the
  Cut preview (and likely the exported cut SVG), so they wouldn't be sent to slicebug.
  Imported SVGs/text show up but shapes don't — probably a gap in how shape items are
  serialised by `buildWorkspaceCutSvg` / the resolve-for-cutting step (e.g. fill/stroke
  or path handling specific to shape objects).
  → `buildWorkspaceCutSvg` in `workspace-objects.ts`, `handleOpenCutPreview` /
  `resolveTextItemsForCutting` in `App.tsx`, `CutPreviewModal`.

- [x] **Bounding box clips the shape.** The snug bounding box hugs the path's
  geometry (DOM `getBBox`, which excludes stroke width), so the shape's stroke/edges
  can get cut off at the frame — the artwork SVG / item box clips at the tight bounds.
  Either let the shape overflow its frame (SVG `overflow: visible`, no clipping on the
  item) or pad the snug frame by the stroke width. (Surfaced after adding snug frames
  to shapes.)
  → `components/workspace/WorkspaceObjectArtwork.tsx` (svg viewBox/overflow),
  `computeSnugFrame` in `utils/workspace-geometry.ts`, `.workspace-image-item` CSS.

- [x] **Pen hexes have inconsistent / broken hover.** Hovering the "add pen" hexagon
  shows a white rectangle behind the hex shape (the button's box bleeds around the
  clipped hexagon). The workpiece Pens (color hexes + add-pen) should use the *same*
  hover treatment as the pen hexes in the object-settings "Tool" pane (`.pen-hex-btn`
  — a soft tinted rounded backdrop), instead of the current rectangular/white hover.
  → `.pen-hex`, `.pen-hex--add`, `.pen-hex-btn` in `styles.css`; Pens section in
  `components/workspace/DesignWorkspace.tsx`.

- [x] **Zoom buttons zoom from the paper's top-left, not the view center.** The
  bottom-right −/%/+ buttons just change `zoom`, so the workpiece scales from its
  top-left origin and drifts off-screen. They should zoom toward the center of the
  viewport (keep the visible center fixed), like the Ctrl/Cmd+wheel zoom already does
  around the cursor.
  → `zoom-controls` buttons + `handleViewportWheel` math in
  `components/workspace/DesignWorkspace.tsx`.

- [x] **No final "eject mat" step.** After the cut completes there's no step that
  unloads/ejects the mat from the machine — the flow just ends. Add it as the last
  step of the cut sequence.
  → slicebug cut flow (`shell/slicebug-service.ts`, cut session steps), cut UI.

---

## ✨ Features

- [x] **Reorder layers.** Let users change stacking order (which determines draw/cut
  order and visual overlap) via: right-click menu (move up/down, to front/back),
  top toolbar buttons, and drag-to-reorder in the Layers pane. Order = the
  `importedSvgs` array order.
  → Layers list in `components/workspace/DesignWorkspace.tsx`, context menu in
  `shell/main.ts`, `App.tsx` reorder handlers.

- [x] **Layer name reflects text content.** In the Layers pane, text boxes should
  show their actual text (e.g. truncated first line like "Happy Birthday") instead of a
  generic "Text" label, so layers are easy to tell apart. Fall back to the generic name
  when the text is empty.
  → layer list renders `item.fileName` in `components/workspace/DesignWorkspace.tsx`;
  text content is `item.textContent.text`.

- [ ] **Ungroup Potrace/AI traced SVGs.** Multi-path imports already ungroup, but a
  traced design that comes in as one compound path can't be split into its separate
  shapes. Allow breaking a traced/compound path into individual editable objects.
  → `workspace-grouping.ts`, `workspace-svg-import.ts`.

- [ ] **Border / boundary cut.** A cut that uses the exact same cut logic as a normal
  cut, but: (1) is **not filled** in the editor or cut preview (outline only), and
  (2) automatically sits on the **bottom layer**. Useful for a card's outer trim cut
  around the whole design. Likely a new object role/flag rather than a new tool.
  → `WorkspaceObjectArtwork` (skip fill), `buildWorkspaceCutSvg`, tool/color model.

- [ ] **Visual cutting progress.** Replace the text-y status with a clear visual
  sequence: each step (load tool, load mat, draw, cut pass, finish) shown with icons,
  tool changes called out, completed/active/upcoming states. Build on the existing
  step list in `PlanAndCutMonitor` / `CutPreviewModal`.

- [ ] **Cut-time estimate & pass count.** Count paths (have `getWorkspaceObjectPartCount`)
  and estimate real-world cutting time from measured timings. Factor paper weight into
  the number of cut passes (heavier stock → more/deeper passes) and reflect that in the
  estimate and the progress steps.

- [ ] **Insert-card corner cutaways.** Auto-generate the 4 small diagonal corner
  slots that hold a Cricut insert card — the colored insert slides behind the card
  front and its corners tuck into these diagonal slits. One-click "add insert slots"
  sized/positioned to the chosen card blank (tie in with the CardMat card-size guides:
  3.5×4.9" / 4.25×5.5"). These are cut paths placed at the four corners of the insert
  area, on the cut tool.
  → cut-path generation alongside `buildWorkspaceCutSvg`; card sizes in `workspace-utils`
  (`CARD_GUIDES`); behind/insert colour model.

- [x] **Start new projects with the mat centered.** When entering the workspace
  (new project / open), the mat should be centered and sensibly zoomed in the viewport
  instead of using the fixed default pan/zoom. Reuse the existing `resetZoomToActualSize`
  centering logic on workspace entry.
  → pan/zoom init + `resetZoomToActualSize` in `components/workspace/DesignWorkspace.tsx`;
  workspace-entry in `App.tsx`.

- [ ] **More appealing start screen.** Redesign `WelcomeScreen` — warmer, more visual,
  less utilitarian (project cards, imagery), keeping it grandma-friendly.
  → `components/screens/WelcomeScreen.tsx`.

- [ ] **Remove developer/debug text.** Hide technical output from end users:
  the "project opened" path message, `console.log`s (e.g. ImageLibrary save), and the
  raw slicebug `stdout`/`stderr`/transcript shown in the "advanced details" panes.
  Keep them behind a dev flag if useful for debugging.
  → `App.tsx` (`project.opened`, `console.log`), `onboarding-copy.ts` (details build),
  cut modal transcript.

- [x] **Single-line ("stroke") text — draw/cut text as centerline paths.** Add an
  option so text is rendered and cut as single-line paths (a single pen/blade stroke
  following the letter centerlines) instead of the current filled outline (a "rectangle"
  / closed-contour glyph). Good for pen drawing and quick line-cuts. Needs a single-line
  (Hershey/stroke) font or a centerline/skeleton conversion of the glyph outlines, plus a
  per-text toggle in the text settings, and the cut/preview pipeline must emit open
  stroke paths (no fill) for these.
  → text settings UI + `WorkspaceTextContent` model (`project-file.ts` / `workspace-objects.ts`),
  `renderTextToCanvas` / `resolveTextItemsForCutting` in `App.tsx`, `WorkspaceObjectArtwork`,
  `buildWorkspaceCutSvg`.

- [x] **Per-shape extra options (corner radius slider).** Some shapes need shape-specific
  controls. Shapes with corners (rectangle, square, triangle, polygons) get a corner-radius
  slider, and the "rounded rectangle" becomes just a rectangle with a preset non-zero
  radius. Store the radius on the shape and regenerate its path/snug frame when it changes.
  → shape factory `utils/workspace-factory.ts` (shape path generation), shape settings UI
  in `components/workspace/DesignWorkspace.tsx`, shape model in `workspace-objects.ts`.

- [x] **Fix rounded-rectangle radius under non-uniform scaling.** Rounded rectangles
  currently scale their corners wrong. Desired behavior: scaling a single axis (x *or* y
  alone) keeps the corner radius constant; scaling both axes together changes the radius
  proportionally to the box size (so the square doesn't morph into a circle). Guard against
  overlapping/cross-over corners and weird distortion when the radius is large and the box
  is then scaled smaller than the radius on one axis — clamp radius to `min(width,height)/2`.
  Likely folds into the per-shape corner-radius feature (store radius as a real value and
  rebuild the path on resize rather than CSS/transform-scaling the corners).
  → rounded-rect path generation in `utils/workspace-factory.ts`, scale-commit /
  `normalizeWorkspaceItemTransform` handling, `components/workspace/DesignWorkspace.tsx`.
