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
npm ci
npm run setup --workspace @cricut-companion/joy-runtime
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
- `packages/joy-runtime`: app-owned Python/native protocol and compiler; independently validate trusted host requests.
- `apps/desktop/src`: renderer composition and cohesive feature state; pure craft logic belongs in packages.
- `apps/desktop/src/shell`: trusted Electron IPC, persistence, user authority and exclusive device/process adapters.
- See `docs/architecture.md` for current renderer/host/worker and lifecycle ownership.

## Safety

Never run `slicebug cut` or any machine-control command from this repo without explicit user approval. Tests should use command builders/fakes only. Refactoring and automated-test requests authorize software/inert verification, not a new physical device trial.

### Current native Joy development authorization

Joel has explicitly authorized relevant Bluetooth discovery, pairing/connection,
real-device protocol testing, and reading local Cricut settings/key material for
this integration. Earlier research-only blanket prohibitions are superseded.
Keep automated tests inert; normal OS permissions and deliberate cut/firmware
confirmation remain in place. Do not operate unrelated devices or start device
work automatically at app launch.

The installed KindCut app must be standalone: it must not read, load or execute
CricutDevice/Design Space to import material or connect. Shared decoder constants
necessary for device function may ship with the app. Joel permits necessary
secret material in source only when no alternative exists, or in a git-ignored
secrets file. Prefer OS-protected storage for account/device keys and settings;
never log them or copy AI/account credentials into source or test fixtures.
