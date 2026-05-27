# Architecture

## Approach

Use a TypeScript monorepo with pure domain packages and a React desktop UI prototype. Keep machine control behind a SliceBug bridge boundary so UI and AI features can be built safely before executing hardware side effects.

## Packages

- `craft-core`: project schema, recipes, machine/mat/material compatibility, validation.
- `svg-preflight`: SVG checks and future cleanup transforms.
- `ai-designer`: prompt contracts and future provider adapters.
- `slicebug-bridge`: command builders and future subprocess wrapper.
- `desktop`: UI shell.

## Data flow

```text
User prompt
  → craft-core project recipe
  → ai-designer prompt contract
  → SVG candidate
  → svg-preflight validation
  → craft-core layer/operation mapping
  → slicebug-bridge plan command
  → explicit user confirmation
  → SliceBug cut command later
```

## Local-first principles

- Store user projects locally.
- Keep prompts and generated designs attached to project files.
- Prefer transparent SVG/JSON formats.
- Avoid mandatory cloud login.

## Hardware safety boundary

`buildCutCommand()` marks commands as `sideEffect: "hardware"`. Future runner code must require explicit user confirmation and visible machine status before executing it.
