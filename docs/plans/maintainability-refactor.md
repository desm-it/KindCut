# Maintainability Refactor Implementation Plan

**Goal:** Address audit M1–M8 with behavior-preserving extractions and reproducible verification.
**Architecture:** Keep renderer, trusted Electron host and independently validating Python runtime separate. Extract cohesive feature controllers, typed ownership actors and versioned RPC contracts without changing packets, policy limits, approvals, geometry or user-visible workflow.
**Stack:** React/TypeScript, Electron CommonJS, Python/unittest, Vitest, Vite, pinned formatter.

## Fixed constraints
- Starting tracked HEAD5f3db75 clean; preserve all pre-existing untracked plans. No staging/commit/push/release/version bump.
- Software/inert verification only: no discovery/connect/status/calibration/motion against a real device; no changes to saved user profiles or existing app owners.
- Keep normal mat mode0, explicit CardMat mode2, exact recipes, generation bindings, per-tool Go and intentional End. Never substitute a mock for a claimed real boundary.

## Workstreams / acceptance
1. **M1 UI feature ownership.** Characterize editing/history, source generation and routing, extract cohesive hooks/controllers; split workspace canvas/inspector/shell with grouped interfaces. Keep public App behavior and all saved-project semantics. Tests before extraction; consumer/typecheck tests after each slice. Do not merely move both monoliths intact.
2. **M2 lifecycle ownership.** Characterize loading/job transitions and teardown, extract typed loading/job actors under one hardware/session owner; make state/reservation/queue ownership explicit. Focused native service/controller and actual worker tests, including cancel/generation/retirement negatives. Independent review required before accepting.
3. **M3/M6 tooling and tests.** Canonical discovered platform-aware test entrypoint; data-driven POSIX contracts with explicit audit output; CI/package scripts share it. Replace named-file/string import rewriting with declarative structural compilation mapping that covers every emitted consumer. Convert brittle source-spelling tests to semantic/behavior checks. Add hardware-free compiled-host/frozen-runtime integration target to macOS CI.
4. **M4 formatting.** Pin formatter, scoped configuration, format/check commands. Do not format files concurrently owned by implementers. Apply mechanical formatting after all semantic extractions; fix spelling-sensitive tests structurally, not by deleting authority coverage.
5. **M5 contracts.** Versioned typed host RPC request/response definitions, role-specific constraint metadata and shared accepted/rejected vectors exercised by TS and Python validators. Preserve independent exact-key/runtime admission and different host/worker deadline roles.
6. **M7/M8 docs/style.** Update actual renderer→host→worker ownership/API/dataflow, build/test support matrix and pinned release provenance; consolidate Native Make material layout/style ownership without visual changes.

## Verification sequence
- Baseline root check recorded before implementation.
- Each new seam: minimal throwing API plus meaningful RED regression, implementation/extraction, focused GREEN and neighboring consumers.
- Integrate all streams, then formatting-only pass.
- Canonical format/typecheck/test/build and git diff --check; verify dynamic test discovery/classification and all compiled shared-package consumers.
- Run nine compiled-host/real-producer/frozen-compiler/SDK inert cases, plus actor/lifecycle fault regressions.
- Build a separate local ARM64 candidate; strict signature, relocated app, isolated userData/sessionData/Documents, updates off and fail-closed hardware/secret tripwires. Exercise project edit/undo/save/load, Make preview and configured inert tool workflow; return actual screenshot. Never overwrite a live bundle.
- Independent spec/correctness/security review of final exact diff/new files. Correct demonstrated regressions and reverify; report remaining unverified physical/distribution scope honestly.
- Final delivery maps M1–M8 to concrete files and observed tests, with before/after metrics. Leave changes uncommitted.
