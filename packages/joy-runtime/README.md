# Experimental KindCut Joy runtime

KindCut-owned Python/crypto + native IOBluetooth code, packaged into a standalone
macOS executable. It does not execute SliceBug, CricutDevice or Design Space.
The native backend is available on macOS without an environment-variable gate.
Device operations still require an explicit user action. Mat load/unload requests
are available; there are no native cutting/job/path APIs.

## Build (macOS, verified on ARM64)

```sh
python3 -m venv packages/joy-runtime/.venv
packages/joy-runtime/.venv/bin/python -m pip install -r packages/joy-runtime/requirements-build.txt
npm run build --workspace @cricut-companion/joy-runtime
```

This compiles the native RFCOMM bridge, freezes Python/cryptography with
PyInstaller, probes the resulting worker without hardware, and copies its own
runtime folder into `apps/desktop/resources/joy`. macOS desktop packaging includes
that folder in `Contents/Resources/joy`. Windows builds skip this experimental
runtime; no Windows or Intel-Mac compatibility has been validated.

The generated artifact is self-contained; an end user does not need the build
venv, Python installation, Ghidra, research evidence, SliceBug or a running Design
Space for a provisioned session. Build tools/Xcode are developer prerequisites.

Safe verification:

```sh
apps/desktop/resources/joy/kindcut-joy-runtime --probe
packages/joy-runtime/.venv/bin/python -W error::ResourceWarning -m unittest discover -s packages/joy-runtime/tests -v
```

`--probe` imports the packaged crypto/runtime and reports capabilities without
opening a connection. Native hardware-free `--self-test` is separately available
in the bundled `_internal/bluetooth/joy_rfcomm` executable.

## One-time provisioning

**Normal Joy setup does not require provisioning import.** The app ships
`profiles/cricut-joy.json` with two decoded machine-12 initialization records,
exact firmware-selector bounds and transformation flags. The default connection
uses this profile without reading old cache/Keychain material, even if an earlier
import exists. Unknown firmware fails closed: no generic machine-7 fallback.
Advanced import explicitly opts into an override for the current app session;
restarting returns to the bundled default. No user address/account/AI credentials
are included in the profile. The shared device initialization records are shipped
under Joel's explicit authorization.

The app asks for ONE JSON file: an existing cache containing `settings8_raw`, or
a format-1 KindCut bundle containing `settings8` and `seedPrefixBase64`. It does
not ask for, read, load or execute a Cricut helper. Unrelated cache fields are
ignored. Malformed material fails closed.

`decoder-prefix.bin` is a shipped 33-byte shared decoder constant, not a user's
account/device key. Its inclusion is explicitly authorized by Joel and makes
cache import independent of a Design Space installation. `seed_import.py`
remains a developer research utility; it is not imported or included in the
frozen worker. Runtime builds package the existing decoder resource and do not
extract anything from an installed helper.

After validating settings8, the private worker pipe returns the bundle ONLY to
Electron main. Main protects it using Electron `safeStorage` and a private
0700 directory / 0600 atomic file. No plaintext fallback is permitted. The
renderer receives only a record count. After import, the source JSON is not
needed during connection. Online refresh/login is not implemented. This is
material/key provisioning, not an arbitrary calibration-settings importer.

Do not put the bundle on a command line, in environment variables, diagnostics,
logs, tests, git or chat. Tests contain only explicitly synthetic values. Python
and JavaScript managed memory cannot guarantee secure erasure.

## App interface and authority

The preload exposes `cricutCompanion.nativeJoy`:

- `getSetupStatus()` — local metadata only; does not launch the worker.
- `devices()` — paired original-Joy metadata through the app-owned native bridge;
  no manual address entry, active inquiry or automatic connection. Pair new
  devices once in macOS Bluetooth settings. A single Joy is selected automatically.
- `mat('load'|'unload')` — trusted main-process roller-motion confirmation; requires
  an initialized session. Device rejection remains visible without retry. An ACK
  is not proof of physical mat presence or completed feeding.
- `importProvisioning()` — main-process confirmation + one native file chooser;
  renderer cannot supply paths or receive a bundle.
- `connect(address)` — requires a native confirmation naming Bluetooth/
  authentication, AES reset/key negotiation and
  firmware/status reads. Renderer-provided approval flags are ignored.
- `pollStatus()` — only for an approved, initialized session.
- `disconnect()` — cancels pending work and closes the owned session.

Only the exact packaged main-frame renderer or configured loopback dev origin
may invoke these IPC handlers. Existing and native cutter sessions block each
other; a pending keychain read cannot start a connection after cancellation.
App shutdown aborts the owned worker process group. No process-name killing.

`worker.py --stdio` is a private JSON-lines protocol, not a public network server.
It validates numeric request IDs, bounds input, redacts error text, rejects
unapproved hardware operations, and closes on EOF. The Node client bounds
responses, has a hard deadline, and does not silently restart after failure.

## Validation boundaries

**Current hardware proof (pass 18):** frozen runtime through the real Node service
discovered Joy-C3D0, initialized firmware selector 8.164000001 from bundled record
0, read encrypted status, accepted a load request, and returned an explicit
unload rejection (device code 5) without losing synchronization. Imported-key reads
were zero. No cutting or firmware-update command was sent. Physical mat insertion
and completed feeding/unloading are not verified. Older statements below describe
earlier checkpoints.

The macOS bridge schedules SDK work with CFRunLoopPerformBlock rather than a
main-dispatch block, allowing IOBluetooth callbacks to reenter the main run loop.
It uses cached SDP records for paired devices instead of racing an asynchronous
SDP query against RFCOMM open. A POSIX serial experiment was discarded; it is not
part of the app. See `macos-joy-profiles-discovery-pass18.md` for current evidence.

The packaged worker has passed a real Node-client probe and an isolated clean-
environment import of the existing local cache in RAM (22 records), with only
counts/booleans emitted. Neither original helper nor hardware was executed.
No real imported bundle was persisted during development. Protected-store unit
coverage uses an injected test cipher; actual OS Keychain interaction and native
dialog display require a separate app smoke test. Hardware interoperability,
reset-reply semantics and strict encrypted-status confirmation remain unverified.
Settings now includes Auto/Native/SliceBug preference and a native setup panel
with metadata, provisioning import and explicit connection/status/disconnect
controls. Auto cutting requires confirmation to use SliceBug; Native-only cutting
is blocked. No retry/fallback follows an uncertain operation. Native cutting
itself remains unimplemented. Settings now separates Cutter and AI services into
accessible tabs, preserving drafts while switching. Latest standalone validation
also imported 22 real cached records while macOS denied helper-installation and
research-helper reads and all network access. No keys were printed or persisted
by that check. See pass-17 for current behavior; pass-16 is historical.

Research provenance: `docs/research/cricut-native/evidence/joy-runtime/` and
`macos-joy-initialization-pass14.md`. Promoted protocol/crypto/session source
initially matches the already-tested research implementation byte-for-byte.
