# Architecture

KindCut separates editable craft documents, visual previews, trusted desktop orchestration and device execution. Native original-Joy and legacy SliceBug execution are independent backends: neither is an implicit fallback after an uncertain operation.

## Package and process ownership

- `craft-core`: pure project/model types, material/mat semantics, geometry and planning.
- `svg-preflight`: SVG validation and transformation into the declared execution frame.
- `ai-designer`: AI request/provider contracts and generated-design validation helpers.
- `slicebug-bridge`: legacy command builders and explicit side-effect classification.
- `joy-runtime`: app-owned original-Joy initialization, crypto, protocol/compiler, loader/job execution and native macOS Bluetooth bridge.
- `apps/desktop/src`: React feature state, workspace/preview components and preload consumers.
- `apps/desktop/src/shell`: trusted IPC, persistence, authorization, runtime subprocess ownership, native session coordination and legacy adapters.

```text
React feature controllers: editable project / selection / history
  ├─ visual preview (presentation fields only)
  └─ declared executable source + exact material/tool recipes
       ↓ typed preload API, never renderer-supplied approvals
Electron main: trusted frame + one-use intent, private preparation handles,
              source/library/device bindings, exclusive backend ownership
  ├─ separate offline compiler (cannot borrow the live transport)
  └─ initialized live original-Joy owner
       ↓ bounded private JSON-lines protocol
Python: independent closed admission, program/lifecycle validation and cleanup
       ↓ app-owned native macOS IOBluetooth bridge
Original Cricut Joy
```

The legacy path instead uses the SliceBug command/subprocess adapter. Windows currently uses that path; portable parser tests do not imply Windows native-Joy hardware support.

## Feature and lifecycle boundaries

Keep project persistence, workspace editing/history and Make preparation as cohesive features. Canvas/viewport mechanics and object/layer inspection belong outside application-shell orchestration. Group related state/actions into typed feature interfaces; do not replace the application with one giant context or hook.

Focused connection/job controllers own API requests and subscriptions. Make-level coordination owns entry/setup completion, source invalidation and motion-free preparation. Views render snapshots and dispatch actions. An early ready-session snapshot does not establish completed onboarding. Hiding Make must preserve the admitted preview/controller rather than recreate execution authority.

The native facade owns transport exclusivity, session generation and actual client retirement/quarantine. `NativeJoyLoadingActor` and `NativeJoyJobActor` own operation snapshots, reservations, serialized mailboxes and action receipts; the job actor also owns its operation token and admitted-program binding. `NativeOperationLifecycle` supplies the per-actor mailbox and receipts without granting hardware authority. The facade retains generation checks inside dispatch queues and arbitrates shared-session teardown; actors do not open or close physical transports. Host and worker independently validate untrusted boundaries; a shared contract/type definition must not remove either authority.

Project save/open/navigation state lives in `features/project/use-project-persistence.ts`; the pure IO and document adapters preserve existing project formats. Workspace history and executable Make-source memoization are separate features. `DesignWorkspace` retains canvas interaction orchestration, while `CanvasViewport`, `WorkspaceInspector` and shared rendering helpers own the extracted presentation. Inspector-only expansion, rename and drag state stays in the inspector. Child interfaces group model/actions/refs; the existing broad workspace facade remains for caller compatibility.

## Normal Native Make sequence

1. Startup reads local metadata only: no discovery, connection, device polling or calibration read.
2. A deliberate Make entry supplies a trusted host intent. Paired candidates are discovered once; only one unambiguous candidate is selected automatically. A ready app-owned session can be reused.
3. Setup reuses calibration matching the current device fingerprint/firmware or reads and saves that device's stored pressure table. This is not mechanical calibration or permission to move.
4. Exact material/tool recipes are selected; matching custom adjustments survive. Source identity is never inferred from a similar material name.
5. A separate offline compiler freezes the complete workflow. Main retains immutable source/library/session bindings and exposes only safe metadata plus opaque handles.
6. Deliberate Load authorizes the actual sensor/grip/measurement/readiness lifecycle under the required tool-clearance conditions.
7. Each pen colour or blade requires a fresh deliberate Go. Automatic preparation/arming never means automatic execution.
8. Tool completion can retain the same loaded session; End/unload is separate. Interrupted history is observation-only, never restored replay/resume authority.

## Data and safety semantics

Projects are local SVG/JSON; AI/cloud requests are explicit, separately configured services. Shared initialization records, decoder constants and reviewed material defaults are bundled. Normal native operation does not require running/reading vendor software. Device calibration and session keys are never distributable fixtures; provisioning overrides remain protected and distinct from material settings.

Diagnostics are bounded/allowlisted and separate action completion from cleanup failure. ACKs are not physical alignment, completion or stopped-motion proof. CardMat requires explicit card mode and canonical dimensions, not an alias to the ordinary short mat. Preview colours/margins/guides never change executable coordinates.

## Tests and extension policy

Use the canonical repository check command and its declared platform policy. Full inert native tests run on POSIX; Windows runs portable contracts without emulating Unix modes or fcntl. Workspace discovery and platform classification must have one owner.

New RPCs/phases need typed contracts, independently enforced host/worker admission, and accepted/rejected vectors. New shared-package consumers must resolve in emitted CommonJS, not only Vite's TS loader. Compiled-host/frozen-runtime checks use inert peers and deny physical transports and secret access.

Package verification additionally checks relative framework resources, relocation, metadata-only startup, isolated profiles and actual renderer/preload/main behavior. Synthetic/software success is not physical stock, emergency-stop or calibration certification.

See [Native Joy](native-joy.md) for user setup/limits, [release CI](github-release-ci.md) for provenance, and the runtime README for backend ownership. Historical/private research is provenance, not the current API or a clean-build prerequisite.
