# Cricut Companion App

Local-first Cricut companion app for grandma-easy craft design, AI-generated Cricut-ready SVGs, local project/library management, and eventual SliceBug-backed machine sending.

## Current status

This is a project foundation, not a finished cutter app yet. The first scaffold includes:

- npm workspaces monorepo
- React/Vite desktop UI prototype with an Electron shell
- shared craft project model
- mat/material/tool recipes for Cricut Joy-oriented MVP work
- SVG preflight package stub
- AI designer prompt scaffolding
- SliceBug bridge command builder scaffolding
- product/architecture docs
- curated `AppContext/` folder for Codex and other coding agents

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
open "apps/desktop/release/mac-arm64/Cricut Companion.app"
```

Create distributable macOS artifacts:

```bash
npm run package:desktop:mac
```

The generated app is unsigned for now; add a real app icon and signing/notarization before sharing it outside this Mac.

## Workspace layout

```text
apps/desktop/              React/Vite desktop UI prototype
packages/craft-core/       Project model, mats, materials, operations, validation
packages/svg-preflight/    SVG import/preflight checks for Cricut-safe output
packages/ai-designer/      AI prompt contracts for craft-ready SVG generation
packages/slicebug-bridge/  Safe command builder for SliceBug plan/cut flows
AppContext/                Curated notes safe to expose to Codex
_docs/                     Reserved for generated docs, if needed later
docs/                      Product, architecture, plans, decisions
```

## Codex usage

Codex CLI is installed on this Mac. Run it inside this git repo and provide it the relevant file/task scope.

Example:

```bash
cd /Users/joeldesmit/Cricut/CricutCompanionApp
codex exec "Read AGENTS.md and AppContext/product-vision.md. Add tests for craft-core validation edge cases."
```

Do not point Codex at Joel's entire Obsidian vault by default. Use `AppContext/` as the curated context boundary.
