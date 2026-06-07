# KindCut — 1.1 TODO

Active backlog for the next release. Keep this file focused on unfinished work:
when an item ships, remove it instead of leaving a checked-off history trail.
File pointers are starting points, not exhaustive.

---

## Bugs

- [ ] **White text disappears while editing.** Inline text editing uses the saved
  text colour directly (`TextEditOverlay` sets `color: tc.color`), so white or very
  pale text is invisible on the white textarea surface. Editing mode should always
  use a readable dark ink colour, without changing the actual project/tool colour.
  Also set caret/selection styles if needed so editing stays readable at every zoom.
  → `apps/desktop/src/components/workspace/TextEditOverlay.tsx`,
  `.text-edit-overlay` in `apps/desktop/src/styles.css`.
  Tests: add a component/unit-level guard if practical, or at least cover the helper
  that chooses the edit colour.

- [ ] **Release audit: replace or isolate Potrace/Jimp dependency.** `npm audit
  --omit=dev` reports the known moderate `potrace` → Jimp → `phin` advisory. npm's
  suggested downgrade pulls older high/critical dependencies, so 1.0 intentionally did
  not downgrade. For 1.1, either move raster tracing to a safer dependency, vendor a
  tiny Potrace subprocess, or isolate the existing tracer so user-provided images do
  not pass through a stale dependency path without size/type limits.
  → `apps/desktop/src/shell/main.ts` (`ai:trace-png-to-svg`), `package.json`,
  `apps/desktop/package.json`, `docs/release-checklist.md`.
  Tests: add file-size/type rejection cases before enabling general PNG import.

---

## Features

- [ ] **PNG/JPEG import with Potrace tracing.** The app can already trace AI-rendered
  PNGs through `window.cricutCompanion.ai.tracePngToSvg`, but normal file import only
  accepts SVG files. Extend import to accept `.png`, `.jpg`, and `.jpeg`, trace raster
  files into SVG paths, normalize/preflight the result, and add the traced artwork to
  the workspace and local image library. Start with a simple black silhouette workflow:
  threshold, optional invert, preview before commit, and clear messaging when the image
  is too detailed for a clean cut.
  → `handleSvgFileChange` in `apps/desktop/src/App.tsx`,
  file input in `apps/desktop/src/components/panels/ImageLibraryPanel.tsx`,
  `ai:trace-png-to-svg` IPC in `apps/desktop/src/shell/main.ts` / `preload.ts`,
  `extractWorkspacePathsFromSvg` in `apps/desktop/src/workspace-svg-import.ts`.
  Tests: add mixed SVG/raster import helpers, size/type limits, and traced SVG path
  extraction cases.

- [ ] **Text transforms: arc, circle, wave, and bend.** Add text effects that keep
  the object editable as text while rendering and cutting the transformed geometry.
  Start with arc text because it is the common craft use case, then add wave/bend only
  after the model is solid. Do not make this a visual-only CSS transform; the cut SVG
  must match the canvas preview. Likely add a `textTransform` field to
  `WorkspaceTextContent` with `{ type, amount, radius/angle }`, then share one geometry
  path between preview, export, project save/load, undo, and cut preview.
  → `WorkspaceTextContent` in `apps/desktop/src/workspace-objects.ts`,
  text settings in `apps/desktop/src/components/workspace/DesignWorkspace.tsx`,
  `WorkspaceObjectArtwork.tsx`, `measureTextFrame` / `resolveTextItemsForCutting` in
  `apps/desktop/src/App.tsx`, `project-file.ts`.
  Tests: project-file round trip, transformed text frame measurement, cut SVG geometry
  parity, and single-line text interaction.

- [ ] **Pen "Color in" / infill mode.** When a selected object is assigned to a pen
  tool, show a toggle in Object Settings for "Color in". This should generate pen
  hatch lines inside the shape/text, similar to 3D-print infill: pattern, angle, and
  density/spacing controls. The Cricut pen is a fine liner, so the goal is a pleasant
  shaded fill, not a solid marker flood. Keep it pen-only and never turn it into a cut
  fill. The generated infill must appear in preview and in the cut SVG as draw paths.
  A conservative first version can support closed shape/SVG paths only; text and open
  paths can show a disabled reason until clipping is reliable.
  → object settings tool section in `DesignWorkspace.tsx`,
  tool matching/render logic in `WorkspaceObjectArtwork.tsx`,
  cut export in `buildItemInnerSvg` / `buildWorkspaceCutSvg` in
  `apps/desktop/src/workspace-objects.ts`, project persistence in `project-file.ts`.
  Suggested model: add `penInfill?: { enabled: boolean; pattern: "lines" | "crosshatch";
  spacing: number; angle: number }` on objects or paths, then implement geometry in a
  pure `workspace-infill.ts` helper.
  Tests: hatch generation bounds, density/angle snapshots, project round trip, and
  cut SVG output with `fill="none"` draw lines.

- [ ] **Border / boundary cut.** A cut that uses the same cut pipeline as a normal
  cut, but is not filled in the editor or cut preview and automatically sits on the
  bottom layer. Useful for card trim cuts around the whole design. This probably wants
  an object role/flag rather than a separate tool colour, so it can stay visually
  outline-only while still resolving to the existing cut tool.
  → `WorkspaceObjectArtwork.tsx` (outline-only render), `buildWorkspaceCutSvg` in
  `workspace-objects.ts`, layer insertion/reorder in `App.tsx` and
  `DesignWorkspace.tsx`, tool/color model in `project-file.ts`.
  Tests: bottom-layer insertion, outline-only preview, and cut SVG still using the cut
  tool colour.

- [ ] **Cut-time estimate and pass count.** Count drawable/cuttable paths and show a
  realistic estimate before cutting. Factor material/paper weight into pass count
  once measured timings exist. Keep the estimate honest: "about 3 minutes" is better
  than fake precision. This should feed the cut preview and progress modal without
  changing hardware behavior.
  → `getWorkspaceObjectPartCount` and `buildWorkspaceCutSvg` in
  `apps/desktop/src/workspace-objects.ts`, material recipes in packages, cut preview
  UI in `apps/desktop/src/components/modals/CutPreviewModal.tsx`.
  Tests: path counts for groups/shapes/text, material-based pass count, and copy text
  for unknown estimates.

---

## Release Polish

- [ ] **Windows 1.1 smoke build.** The Windows icon/config exists, but 1.0 was only
  built and tested on macOS. Build on Windows, confirm the bundled SliceBug executable
  path resolves to `resources/slicebug/slicebug.exe`, and test project save/open plus
  setup status. Do not test real cutting unless explicitly approved.
  → `apps/desktop/package.json`, `apps/desktop/scripts/build-slicebug-runtime.cjs`,
  `apps/desktop/src/shell/slicebug-service.ts`.

- [ ] **macOS signing/notarization plan.** The 1.0 artifacts are unsigned/ad-hoc.
  For a shareable 1.1 build, add Developer ID signing, hardened runtime settings, and
  notarization docs/scripts. Keep local unsigned builds easy for development.
  → electron-builder `mac` config in `apps/desktop/package.json`,
  `docs/release-checklist.md`.
