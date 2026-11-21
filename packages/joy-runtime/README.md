# KindCut original-Joy runtime

App-owned Python/crypto and a native IOBluetooth bridge, frozen into a standalone macOS executable. It does not execute SliceBug, CricutDevice or Design Space. The native product workflow supports on-mat pen and fine-point blade jobs on the original Joy with supported firmware, including explicit CardMat and insert-card recipes. Other cutters and Smart/matless native work are not supported. Windows uses the separate legacy backend; Intel-Mac native compatibility is not established.

## Build and software verification

From the repository root:

```sh
npm ci
npm run setup --workspace @cricut-companion/joy-runtime
npm run check
```

Setup uses the pinned Python build requirements; Python3.12 is the supported CI/native test interpreter. The build compiles the RFCOMM bridge, freezes the runtime/profile/decoder resources, performs a hardware-free probe and copies the self-contained folder to `apps/desktop/resources/joy`. App packaging installs it at `Contents/Resources/joy`. Native freezing is skipped on non-macOS platforms; portable tests still run there.

The application does not require an end-user Python/venv, Ghidra, research archive or vendor installation. macOS builds require the documented developer/Xcode tools. `--probe` is metadata-only; the packaged Bluetooth helper's `--self-test` is also hardware-free. Neither authorizes a connection.

Use the canonical platform-aware root test command for supported checks. The full inert suite runs on POSIX; Unix permission, Darwin framework-link and fcntl contracts are explicitly classified rather than faked on Windows. Compiled-host/frozen-runtime integration uses synthetic peers only.

## Runtime boundaries

- `worker.py`: private bounded JSON-lines dispatch, numeric request identities, allowlisted errors and EOF shutdown.
- Offline planning/configuration: validates declared source/frame and exact saved recipes, builds immutable programs, and never borrows a live connection.
- Session/crypto: model/firmware selection, source-bound initialization and the owned channel.
- Loading/retained scope: sensor arming, grip/measurement/readiness, independent operation ownership and guarded retirement.
- Job task/program: exact admission, immutable digest/source binding, ordered per-tool/per-pass data, fresh Go, retained completion and explicit End.
- Native bridge: cached paired-device SDP and CFRunLoop-scheduled IOBluetooth operations; no process-name killing or generic transport fallback.

The trusted Electron host provides user authority and validates snapshots/ownership; Python independently validates requests and execution context. The private worker is not a public network service. Keep independent admission even when contract types/fixtures are shared.

## Bundled initialization versus device data

Normal setup uses the two machine-12 records in `runtime/profiles/cricut-joy.json`, with their exact selector bounds/transforms. Unknown firmware fails closed, never through a generic machine-7 fallback. `decoder-prefix.bin` is an authorized shared33-byte decoder constant, not a user account/device key. Runtime builds package those reviewed resources; they do not extract an installed helper.

On deliberate Make entry the host connects once or reuses its ready owner, reuses exact device/firmware calibration or explicitly reads and saves that device's stored pressure table, adopts the exact material/tool recipes and prepares. No advanced toggle or import is needed. Reading device data is not mechanical calibration, force certification or validated stock suitability. Loading, each tool Go and unloading remain separate user actions.

Per-device calibration and per-connection session keys remain local. Never put real keys/bundles on command lines, in environment variables, logs, tests, git or chat. Tests use labeled synthetic data; managed memory cannot promise secure erasure.

Advanced provisioning import is an explicit session override, not normal setup. It accepts a host-chosen existing cache/bundle, validates it in the private worker and protects it using Electron safeStorage and private atomic storage; the renderer receives only metadata. There is no plaintext fallback or automatic vendor-cache read. Restart returns to bundled initialization. Developer research utilities are not app runtime dependencies.

## App authority and recovery

Preload setup/status is local metadata. Device selection is paired-device metadata, not active inquiry. Current Make entry/setup is host-owned; the renderer cannot supply approval booleans, source paths or initialization bundles. Host state and one-use input receipts bind genuine actions to the current source/library/session. Cancellation checks every awaited stage, retires only its captured owner and quarantines failed retirement. Native and legacy owners are mutually exclusive.

Interrupted jobs are observation-only: last-known diagnostics are not physical state, replay permission or a resumable cursor. Software cancellation/ACKs do not prove stopped motion. Keep action outcome, later cleanup failure and physical verification separate.

## Validation scope

Automated unit, contract, SDK and compiled-host/frozen-runtime tests are inert. Operator-observed successful basic pen/cut work and real-device onboarding are separate evidence; they do not certify every material, CardMat alignment, cut depth, physical calibration or fault/stopping outcome. Do not revive older inspection-only/trial restrictions as current product behavior. See `docs/native-joy.md` and `docs/architecture.md` for current workflow/support; historical/private research is provenance, never required for a clean build.
