# SliceBug internals & integration notes

How SliceBug works, how KindCut drives it, and where it can fail. Written from a hands-on
investigation of the local checkout at `/Users/joeldesmit/Cricut/SlicebugMac` (slicebug
version `0.2`) plus how `apps/desktop/src/shell/slicebug-service.ts` calls it.

> SliceBug is a third-party reverse-engineering of Cricut Design Space's local protocol. It
> reuses Design Space's own keys, plugins, and machine profiles. It is **not** an official
> Cricut tool, and the protocol is an old snapshot — newer Design Space versions can drift.

---

## 1. What SliceBug is, from the outside (the CLI)

A single Python entry point: `slicebug <subcommand>`. Run `slicebug --help` to list them.

```
usage: slicebug [-h] [--version] [--profile PROFILE]
                {bootstrap,list-materials,list-tools,plan,cut} ...
```

| Subcommand | Needs keys | Needs profile | Touches hardware | What it does |
|---|---|---|---|---|
| `bootstrap` | no | no | no | Imports keys/plugins/profiles from an installed Cricut Design Space; downloads usvg. |
| `list-materials` | yes | yes | no | Prints supported materials and their numeric IDs. |
| `list-tools` | yes | yes | no | Lists tools usable with a material. |
| `plan` | yes | yes | no | Converts an SVG → a cut-plan JSON (geometry, material, tools). Offline. |
| `cut` | yes | yes | **yes** | Connects to the machine and executes a plan. |

Notes that bit us:
- There is **no `version` subcommand** — it's the flag `slicebug --version` (prints e.g. `0.2`).
- `--software-buttons` (on `cut`) makes SliceBug simulate the physical Load/Unload and Go
  buttons, for buttonless machines like the **Cricut Joy**. In this mode it **blocks on
  `input()`** waiting for the operator to press Enter before sending each simulated button.

### The `plan` invocation KindCut uses

```
slicebug plan <in.svg> <out.json> \
  --material <id> --mat-preset <preset> \
  --map <hex>:<tool> [--map <hex>:<tool> ...]
```

- `--map RRGGBB:tool` maps a stroke colour to a tool (`pen`, `fine_point_blade`, …).
- `--mat-preset` is e.g. `joy-standard`, `joy-standard-short`, `joy-card`.
- Output JSON includes `mat {width,height}`, `material {width,height,type}`, and `paths[]`
  each with a `tool`. KindCut parses this in `parsePlanSummary()`. `plan.tools` is the set of
  tool **type** names used — **not** per-colour, which is why per-pen-colour cut steps in the
  UI are derived from the design's colours, not from the plan.

### The `cut` invocation KindCut uses

```
slicebug cut --software-buttons <plan.json>
```

- KindCut spawns this and treats **stdin = the "Continue" button** (writes `"\n"`) and
  **stdout/stderr = progress** (parsed heuristically into UI states). See §4.

---

## 2. Config & data layout (`~/.slicebug`)

Config root is hard-coded to `~/.slicebug` (`slicebug/cli/main.py`). Layout:

```
~/.slicebug/
  keys.json                         # imported secrets (see §3)
  profiles.json                     # machine profile index
  profiles/<SERIAL>/material_settings.json
  plugins/
    device-common/
      CricutDevice                  # the device plugin binary (copied from Design Space)
      crashpad_handler, crashpad/, logs/
    usvg/usvg                       # SVG renderer (downloaded from GitHub by bootstrap)
```

- `config_root` = `~/.slicebug` (`os.path.expanduser("~/.slicebug")`).
- `device_plugin_path()` returns `plugins/device-common/CricutDevice` (`.exe` on Windows), or
  `None` if missing → `cut` errors with "Device plugin is missing. Try `slicebug bootstrap`."
- `usvg_path()` falls back to `shutil.which("usvg")` if the bundled one is absent.
- Profiles: if exactly one exists it's auto-selected; otherwise `default`, else `--profile`
  must be given.
- `logs/bridge.log` is **encrypted protobuf**, not human-readable — useless for debugging.
- `crashpad/` is the plugin's crash reporter; it tries to upload reports over HTTP (you'll see
  `HTTP status 400` lines — that's crashpad failing to phone home, not the root cause).

---

## 3. `bootstrap` — what it actually changes

`slicebug bootstrap` (in `slicebug/cli/bootstrap.py`) reads from an installed Design Space and
runs, in order:

1. **`import_plugins`** — `shutil.copytree(<DS>/plugins/device-common, ~/.slicebug/plugins/device-common, dirs_exist_ok=True)`.
   Note `dirs_exist_ok=True` → it **merges** over the existing dir; it does not wipe-and-replace,
   so stale files from a prior version can linger. The `CricutDevice` binary itself is
   overwritten with Design Space's current copy.
2. **`import_keys`** — locates the obfuscation key inside Design Space's `app.asar` via a regex
   (`([0x..,]×64)`), XOR-decodes the user's `settings`/`settings8` from CDS LocalData, and writes
   `~/.slicebug/keys.json`.
3. **`import_machine_profiles`** — copies each machine's `material_settings.json`; **interactive**
   if multiple machines are found (asks you to name each; name `-` to skip).
4. **`download_usvg`** — fetches a pinned resvg/usvg release from GitHub and extracts it.

Defaults (macOS):
- Design Space app: `/Applications/Cricut Design Space.app/Contents/Resources`
- CDS user data: `~/.cricut-design-space`

**Implications / footguns**
- bootstrap rotates `keys.json` to whatever the **currently installed** Design Space uses. The
  keys and the device plugin are imported from the same Design Space, so they stay mutually
  consistent — but if Design Space has changed protocol since SliceBug `0.2` was written, the
  whole thing can drift.
- The plugin copy is a **merge** (`dirs_exist_ok=True`); a truly clean reinstall means deleting
  `~/.slicebug/plugins/device-common` first, then re-bootstrapping.
- bootstrap reads CDS LocalData, so Design Space must have been installed and used at least once.

---

## 4. The `cut` protocol (what happens on the wire)

Driven by `slicebug/cli/cut.py::cut_inner`, talking to the `CricutDevice` plugin over an
encrypted pipe (`slicebug/cricut/device_plugin.py`). Messages are protobuf `PBCommonBridge`,
**AES-ECB encrypted with `cricutdevice_request_key`** from `keys.json`.

High-level sequence:

1. Launch the `CricutDevice` plugin subprocess (`DevicePlugin.__enter__`).
2. **Auth:** `dev.send(riMATCUT, authData=settings8)` → `dev.recv(riStartSuccess)`.
   - Getting `riStartSuccess` back means **the keys are valid**. (Key problems fail *here*.)
3. **Device connect:** `device_connected_resp = dev.recv()` — the plugin reports the machine
   connection. **If no machine is reachable, the plugin crashes here** (see §5).
4. Material selection → prints `Clamp <head>: <tool>` lines.
5. `riWaitOnMatLoad`:
   - software-buttons: `input("Insert mat, then press Enter to load it…")` → on Enter, sends
     `riMATCUTSimulateLoadButtonPressed` (the Load/Unload **toggle**). It first drains any queued
     mat-load event so it doesn't accidentally *eject* an already-loaded mat.
6. `riWaitOnGo`: software-buttons → `input("Press Enter to send software Go…")` → sends
   `riMATCUTSimulateCricutButtonPressed`.
7. Sends tool array + path data; machine cuts. The loop consumes status messages:
   - `riMATCUTNeedAccessoryChange` → "Replace the <current> with <required>." then waits for Go.
   - `riDevicePaused` → "Press Go to resume or Load/Unload to abort." (Load/Unload here aborts.)
   - `riMATCUTReportTool` → tool mismatch; **not recoverable**, must restart the whole cut.
8. `riMATCUTCompleteSuccess` → "Cutting finished." → `riWaitOnMatUnload` → software Unload.

### Cancelling a cut — there is no clean way

`--software-buttons` only ever injects two inputs: the **Load/Unload toggle** and **Go**. There
is **no "cancel cut" command** on stdin or the CLI. A running cut can only be aborted via the
hardware **pause → Load/Unload** path, which SliceBug isn't sitting in a position to trigger on
demand. So the only way KindCut can cancel is to **fully tear SliceBug down** (close stdin, then
SIGTERM, then SIGKILL fallback). Closing the process drops the device-plugin connection, which
halts the Cricut. This is what `SlicebugCutSession.stop()` does.

---

## 5. Failure modes we've actually seen

### "Machine off / not connected" → plugin **crash**, not a hang
When the Cricut isn't reachable (powered off, asleep, not Bluetooth-connected, or Design Space
is holding the link), the `CricutDevice` plugin **crashes at step 3** instead of waiting:

```
EOFError: Plugin stdout closed while reading message: expected 4 bytes, got 0
  at cut_inner → device_connected_resp = dev.recv()
[crashpad] UniversalExceptionRaise: (os/kern) failure ... HTTP status 400
```

SliceBug then exits non-zero → KindCut surfaces a generic error. **This is the most common
real-world failure.** Because the auth step *succeeds* first, a key/bootstrap problem and a
"no machine" problem look different: keys fail at `riStartSuccess`, hardware fails at the next
`recv()`.

KindCut detects this signature (`isCutterConnectionFailure()` in `CutPreviewModal.tsx`:
`/plugin stdout closed|eoferror|could not keep the cut session|failed to connect|no device/i`)
and shows the friendly "is your cutter on / Bluetooth connected?" guide instead of a raw error.

### Diagnosing safely without moving the machine
In `--software-buttons` mode SliceBug **blocks on Enter before sending any Load/Go**, so you can
exercise the connect path without the machine moving by feeding EOF on stdin:

```bash
SB=/Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug
D=$(mktemp -d)
printf '%s' '<svg xmlns="http://www.w3.org/2000/svg" width="288" height="240" viewBox="0 0 288 240">
  <path d="M 24 24 L 120 24 L 120 120 L 24 120 Z" stroke="#ff0000" fill="none"/></svg>' > "$D/s.svg"
"$SB" plan "$D/s.svg" "$D/s.json" --material 218 --mat-preset joy-standard --map ff0000:fine_point_blade
"$SB" cut --software-buttons "$D/s.json" </dev/null   # EOF → exits at the first prompt
```

With stdin = `/dev/null`, `input()` raises `EOFError` and SliceBug exits cleanly *before* any
button is sent — but you still see the real connect error/stack trace. (`timeout` isn't on
macOS by default; use `perl -e 'alarm 20; exec @ARGV' …` to cap it.)

### Other checks worth running
- `slicebug --version` (works) vs `slicebug version` (invalid subcommand).
- `slicebug list-materials` exercises **keys + profile** without hardware — if this works, the
  config is healthy and any `cut` failure is hardware/connection.
- Is Design Space running? `pgrep -fl -i cricut` — a running CDS holds the Bluetooth link.
- Is the Joy connected? `system_profiler SPBluetoothDataType | grep -iA4 joy` — "paired" with no
  "Connected: Yes" means it's off/asleep.

---

## 6. How KindCut wraps SliceBug (`apps/desktop/src/shell/slicebug-service.ts`)

- **Executable resolution:** `JOEL_LOCAL_SLICEBUG = /Users/joeldesmit/Cricut/SlicebugMac/.venv/bin/slicebug`,
  else `slicebug` on `PATH`. (Hard-coded dev path — a release would need this configurable.)
- **Status check:** `runVersion()` calls `slicebug --version`.
- **Planning:** `runSvgPlan()` writes the SVG to a temp dir, runs `plan`, reads the JSON back,
  and `summarizePlanResult()` parses it. 30s timeout.
- **Cut session:** `SlicebugCutSession` spawns `cut --software-buttons <plan>` and maintains a
  `CutSessionSnapshot { status, action, transcript }`:
  - `status`: `idle | running | waiting | finished | error | stopped | blocked`.
  - `action.kind`: `idle | load-tools | load-mat | press-go | replace-tool | finished | running | error`.
  - **`parseCutAction()` is heuristic** — it regex-matches stdout text ("load… mat", "replace…
    tool", "press… go", "finished/unload", "error/failed/traceback/exception") to pick the UI
    state. Brittle if SliceBug changes its wording.
  - `continue()` writes `"\n"` to stdin (the simulated button); only valid while `waiting` +
    `requiresContinue`.
  - `stop()` tears the process down (see §4): `stdin.end()` → `kill()` → SIGKILL after 2s.
  - **"Connecting"** in the UI = `status === "running"` with an **empty transcript** (spawned,
    no output yet). A 15s timer then shows the connection guide; a fast crash shows it via the
    error-signature detection above.
- `smokeMode` blocks real hardware cuts in tests.
- Changes to this file are **main-process** code: rebuild with
  `npm run build:shell --workspace=apps/desktop` and restart the app.

---

## 7. Quick reference — gotchas

- `slicebug --version`, not `slicebug version`.
- Auth OK = `riStartSuccess`; **no machine = crash at the next `recv()`**, not a hang.
- No cancel command — cancelling means killing the process.
- `bootstrap` merges the plugin dir (`dirs_exist_ok=True`) and rotates `keys.json`; clean
  reinstall = delete `~/.slicebug/plugins/device-common` first.
- `list-materials` working ⇒ keys+profile fine ⇒ blame hardware/connection for `cut` failures.
- `bridge.log` is encrypted; don't bother reading it. `HTTP status 400` is crashpad noise.
- UI state mapping is regex-on-stdout — fragile across SliceBug versions.
</content>
</invoke>
