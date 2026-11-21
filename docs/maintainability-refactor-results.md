# Maintainability refactor — verification results

## Scope

Implemented against HEAD `5f3db7594dd197f722ae23fb982f522e9ac37096`. Changes remain unstaged/uncommitted; no version change, release or real-device operation was performed. Existing untracked planning files were preserved. The broad tracked-file diff includes the intentional pinned-formatter pass, not just semantic changes.

## Implemented boundaries

- **M1, UI ownership:** workspace history controller; stable executable Make-source hook; project document/signature adapter, IO controller and persistence/navigation hook. Split workspace rendering into `CanvasViewport`, `WorkspaceInspector` and shared helpers. Inspector expansion, rename and layer-drag state moved into the inspector. Child contracts group model/actions/refs; the legacy broad workspace facade remains for caller compatibility.
- **M2, lifecycle:** Make-entry/source/automatic-preparation coordinator; loading/job actors with owned snapshots, reservations, action receipts and serial mailboxes. Job token/program binding belongs to the job actor. The native facade remains the exclusive hardware/session owner and retains actual client retirement/quarantine and generation checks inside dispatch queues.
- **M3/M6, tooling/tests:** discovered workspace test runner, explicit platform policy, recursive AST-based compiled-consumer import mapping, semantic wiring tests, compiled-host and inert frozen-runtime checks wired into the canonical check/CI path. The inert harness now validates an existing directory below the actual TMPDIR, rather than requiring a developer-specific home path.
- **M4, formatting:** pinned Prettier, scoped tracked/new-source policy and format/check commands; applied the mechanical formatting pass after integration.
- **M5, RPC:** typed v1 host constructors and closed validators, schema/shared accepted/rejected vectors, Python fixture validator and shared live deadline-validation helper. Version remains metadata, not a wire field. The complete Python envelope fixture validator is not the runtime dispatch authority: live action-specific admission remains independently enforced.
- **M7/M8, docs/styles:** documented current process and lifecycle ownership, platform/release tooling, and consolidated Native Make material layout ownership.

## Measured component changes

Measured from TypeScript ASTs, including each component's descendants:

- `App`: 53 → 43 direct `useState` calls; 13,650 → 12,221 AST nodes.
- `DesignWorkspace`: 15 → 11 direct `useState` calls; 16,134 → 9,295 AST nodes.
- Formatting changes line density: App's function grows from 2,290 to 2,455 physical lines despite the extraction; DesignWorkspace falls from 2,254 to 1,740. These remain substantial components, not fully decomposed shells.

## Executed checks

`TMPDIR=<owned scratch> npm run check` completed with exit 0:

- Formatting policy/check and root typecheck.
- Tooling/policy regression tests.
- 952 Vitest tests across workspaces, including 800 desktop tests.
- 435 Python runtime tests.
- Root build, including frozen Joy runtime.
- Compiled host: 37 recursively discovered emitted modules checked; vendor exports loaded.
- Nine inert compiled-host/real-producer/frozen-runtime/SDK cases: mixed-tool CardMat, insert-card pen/corners, corners only, five named vinyl types and long-mat premium vinyl.
- `git diff --check` passed.

The same nine cases also passed using the signed, relocated package's actual frozen executable. No physical transport or secret reads were permitted by the inert adapters.

## Packaged application

Local ARM64, ad-hoc-signed candidate:

`/Users/joeldesmit/.hermes/profiles/balanced/cache/scratch/kindcut-maintainability/relocated/KindCut.app`

- `codesign --verify --deep --strict` passed. Not notarized or distribution-approved.
- All 83 current emitted host/renderer files byte-match the relocated ASAR. Known inert fixture filenames are absent from the archive inventory.
- ASAR SHA-256: `2c99ceb4ac0e0c857a5e359824d29802a8f4c6812069aa4f1b5953779da632c1`.
- Actual packaged renderer/preload/main verified with isolated userData, sessionData and Documents; updates disabled. Guards installed before application entry denied hardware requests and provisioning-secret loads.
- Exercised new project, add shape, undo/redo, Save, another edit, cancelled Open preserving edits, and explicit discard/Open restoring the saved object.
- Save/Open dialogs supplied owned fixture paths in process; real IPC and filesystem serialization ran. This is not a native-dialog usability test.
- Make's visual SVG loaded; actual job and preview image nodes survived Settings navigation and reopening. No prepared execution authority or real connection was claimed.
- Audit: zero worker requests and zero secret reads in this GUI exercise. Test application exited and both owned debugger ports were verified closed.

## Independent review

Separate frontend/project and host/runtime reviewers both returned pass with no blocking logic or security findings. Parent verified all 15 reported source hashes against current files; one abbreviated digest in the frontend summary was recovered from the reviewer's original tool result.

Nonblocking observations:

- Applying an asynchronous Open result after edits made while its dialog is pending is pre-existing behavior, not changed here.
- Keep the Python fixture-envelope validator aligned with independent live action-specific admission.
- Broad App/workspace facade contracts and remaining canvas interaction orchestration can be reduced further in later bounded refactors.

## Evidence and limits

Logs, measured metrics, hash checks, screenshots and isolated GUI audit are under:

`/Users/joeldesmit/.hermes/profiles/balanced/cache/scratch/kindcut-maintainability/`

Important artifacts: `final-check.log`, `final-package-verification.log`, `before-after-metrics.json`, `gui-verification.json`, `independent-review-verification.json`, `workspace-verified.png`, `make-verified.png`.

Scratch evidence is disposable; this document records the durable result. Tests do not establish physical motion/calibration/stock acceptance, Windows execution on this Mac, notarization, clean-checkout reproducibility or publication. No normal application profile, existing app owner or real device was modified by the verification.
