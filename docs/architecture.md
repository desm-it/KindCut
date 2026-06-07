# Architecture

## Approach

Use a TypeScript monorepo with pure domain packages and a React/Electron desktop app. Keep machine control behind a SliceBug boundary so UI and AI features stay testable and hardware side effects require explicit user confirmation.

## Packages

- `craft-core`: project schema, recipes, machine/mat/material compatibility, validation.
- `svg-preflight`: SVG checks and cleanup transforms.
- `ai-designer`: prompt contracts and provider validation helpers.
- `slicebug-bridge`: safe command builders.
- `desktop`: UI composition, local files, Electron IPC, and the SliceBug subprocess wrapper.

## Data flow

```text
User prompt
  → craft-core project recipe
  → ai-designer prompt contract
  → SVG candidate
  → svg-preflight validation
  → craft-core layer/operation mapping
  → desktop SliceBug plan/cut wrapper
  → explicit user confirmation
  → SliceBug cut command
```

## Local-first principles

- Store user projects locally.
- Keep prompts and generated designs attached to project files.
- Prefer transparent SVG/JSON formats.
- Avoid mandatory cloud login.

## Hardware safety boundary

`buildCutCommand()` marks commands as `sideEffect: "hardware"`. The Electron wrapper must require explicit user confirmation and visible machine status before starting or continuing a cut session. Tests must use command builders, smoke mode, or fakes rather than a real cutter.
