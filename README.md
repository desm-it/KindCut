# KindCut

Local-first Cricut companion app for grandma-easy craft design, AI-generated Cricut-ready SVGs, local project/library management, and SliceBug-backed machine sending.

## Current status

KindCut is being prepared as a local 1.0 desktop release. The app currently includes:

- npm workspaces monorepo
- React/Vite workspace UI with an Electron desktop shell
- local `.kindcut` project save/load
- image library storage under the user's Documents folder
- AI silhouette generation and SVG tracing helpers
- editable text, shapes, imported SVGs, grouping, layer reorder, and cut preview
- Cricut Joy mat/material/tool recipes
- guarded SliceBug plan/cut handoff with explicit user confirmation
- bundled SliceBug helper builds for packaged apps
- curated `AppContext/` folder for Codex and other coding agents

Release builds are still unsigned. Sign and notarize macOS builds before sharing them outside this Mac, and smoke-test Windows builds on Windows hardware before calling them distributable.

## Quick start

```bash
cd /Users/joeldesmit/Cricut/CricutCompanionApp
npm install
npm run check
npm run dev
```

Run the packaged desktop shell from source:

```bash
# Terminal 1: renderer dev server
npm run dev

# Terminal 2: Electron shell pointing at the dev server
npm run desktop:shell
```

Build an unpacked macOS app bundle for smoke testing:

```bash
npm run package:desktop:dir
open "apps/desktop/release/mac-arm64/KindCut.app"
```

Create distributable macOS artifacts:

```bash
npm run package:desktop:mac
```

The desktop shell includes a safe SliceBug bridge. Normal status/setup checks call commands such as:

```bash
slicebug --version
slicebug bootstrap --design-space-path "<Design Space app>"
```

from the Electron main process and expose user-friendly status to the renderer.

`slicebug cut` is a real machine-control command. KindCut must only run it after the user has opened the cut preview and explicitly pressed the start/continue controls.

Bundled SliceBug runtime:

```bash
npm run build:slicebug
```

This reads the ignored local checkout at `vendor/slicebug/` and writes the frozen helper to `apps/desktop/resources/slicebug/`, which electron-builder includes as an app resource.

## Workspace layout

```text
apps/desktop/              React/Vite desktop UI and Electron shell
packages/craft-core/       Project model, mats, materials, operations, validation
packages/svg-preflight/    SVG import/preflight checks for Cricut-safe output
packages/ai-designer/      AI prompt contracts for craft-ready SVG generation
packages/slicebug-bridge/  Safe command builder for SliceBug plan/cut flows
AppContext/                Curated notes safe to expose to Codex
docs/                      Product, architecture, plans, decisions
vendor/                    Ignored local third-party/runtime checkouts
```

## Codex usage

Codex CLI is installed on this Mac. Run it inside this git repo and provide it the relevant file/task scope.

Example:

```bash
cd /Users/joeldesmit/Cricut/CricutCompanionApp
codex exec "Read AGENTS.md and AppContext/product-vision.md. Add tests for craft-core validation edge cases."
```

Do not point Codex at Joel's entire Obsidian vault by default. Use `AppContext/` as the curated context boundary.
