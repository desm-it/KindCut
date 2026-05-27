# Cricut Companion App — Agent Instructions

This repo is for a local-first cross-platform Cricut companion app. The target user is a non-technical crafter who wants a grandma-easy flow: describe a craft, get a Cricut-ready design, preview cut/draw layers, save locally, and send to Cricut later through SliceBug or integrated protocol support.

## Priorities

1. Make the beginner workflow simple and safe.
2. Keep craft/domain logic in packages, not hidden inside UI components.
3. Use local-first storage and files; avoid cloud/login assumptions.
4. Treat cutter commands as hardware side effects. Never auto-run a cut in tests or demos.
5. Prefer explicit project recipes over blank-canvas-first workflows.
6. Keep Codex scoped to this repo plus `AppContext/`; do not read Joel's entire Obsidian vault unless explicitly asked.

## Commands

```bash
npm install
npm run typecheck
npm run test
npm run build
npm run check
npm run dev
```

## Important paths

- SliceBug checkout: `/Users/joeldesmit/Cricut/SlicebugMac`
- Curated context: `AppContext/`
- Product plan: `docs/product-plan.md`

## Architecture rules

- `packages/craft-core`: pure TypeScript domain logic only.
- `packages/svg-preflight`: SVG validation/cleanup logic only.
- `packages/ai-designer`: prompt contracts and AI output validation helpers.
- `packages/slicebug-bridge`: command construction and subprocess boundaries only; no direct machine side effects without explicit caller confirmation.
- `apps/desktop`: UI composition only.

## Safety

Never run `slicebug cut` or any machine-control command from this repo without explicit user approval. Tests should use command builders/fakes only.
