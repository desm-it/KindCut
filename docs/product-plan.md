# Cricut Companion Product Plan

## Vision

A local-first Windows/macOS companion app that makes Cricut projects understandable for non-technical crafters. The user describes what they want, the app generates a craft-ready SVG, guides mat/material/tool choices, previews draw/cut layers, saves the project locally, and eventually sends the job to Cricut through SliceBug.

## Target user

- Beginner Cricut owners.
- Cricut Joy users confused by missing physical buttons and material/mat choices.
- Crafters who want AI help but need real cuttable files, not just pretty images.
- Advanced users who want local project ownership and reusable libraries.

## Core jobs

1. Make a simple card/sticker/decal without learning Cricut jargon.
2. Generate or import a design and know whether it will cut/draw correctly.
3. Choose compatible machine, mat, material, and tools.
4. Save reusable local projects and design assets.
5. Send a verified plan to SliceBug/Cricut when ready.

## MVP scope

- Local project library foundation.
- React/Vite desktop prototype shell.
- Cricut Joy recipe model.
- AI prompt contract for SVG output.
- SVG preflight foundation.
- SliceBug command builder preview.
- No actual cutter execution from the app yet.

## Non-goals for MVP

- Full Design Space clone.
- Built-in marketplace/subscription assets.
- Direct hardware protocol implementation inside the app.
- Full vector editor parity with Illustrator/Inkscape.
- Unprompted hardware operation.

## Product wedge

Start with Cricut Joy cards and simple pen+cut designs:

- black paths = pen/draw
- red paths = cut border
- mat = Joy StandardGrip 4.5×12
- material = cardstock
- output = SVG + SliceBug plan command preview

## Roadmap

### Phase 1 — Foundation

- Set up monorepo and domain packages.
- Define project schema.
- Build static guided project preview.
- Add curated Codex context.

### Phase 2 — AI SVG generation loop

- Prompt form.
- Provider abstraction.
- SVG response validation.
- Preflight warnings.
- Local save/load.

### Phase 3 — Visual editor

- Mat preview.
- Layer list.
- Operation mapping.
- Color/tool assignment.
- Resize-to-fit.

### Phase 4 — SliceBug sidecar

- Generate temporary SVG.
- Run `slicebug plan` safely.
- Display plan summary.
- Require explicit confirmation before `slicebug cut`.

### Phase 5 — Packaging

- Decide Electron vs Tauri shell.
- Package for macOS and Windows.
- Add local SQLite library.
