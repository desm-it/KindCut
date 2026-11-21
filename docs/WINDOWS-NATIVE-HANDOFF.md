# Windows native Bluetooth — continuation handoff

## Start here

- Repository: https://github.com/desm-it/KindCut
- Branch: `feature/windows-native-bluetooth`
- Windows transport implementation commit: **`2ebefef1e2d07e267d31c08ed200df151424207f`**.
- Parent maintenance baseline: **`7b6c972a6e42639f99b84b7b19b9055bcab2eb45`**.
- That parent's tree is exactly the accepted/staged **2.1.1 maintenance snapshot**: `2c3e79eb44a69fc03f128b2094552c7282fee0bc`. Windows work is built ON TOP of all those fixes and refactors, not on an older release.
- This handoff and the SDK probe were added after the implementation commit. Clone the branch head to obtain both code and instructions; the full implementation SHA above is the immutable reference for the transport work.
- Version metadata remains 2.1.1 until the Windows-native feature is accepted for 2.2.0. Neither version has been tagged or published by this handoff task. Older staged-status notes describe the earlier verification checkpoint, not a public release.

**Native Windows is deliberately still disabled in host/worker admission.** The source transport exists, but paired-device discovery, Windows runtime packaging and actual Windows/device acceptance remain unfinished. Do not change one platform condition and call the feature complete.

## What is implemented

| Path under `packages/joy-runtime/`                           | Responsibility                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `runtime/bluetooth/windows_endpoint.py`                      | Packed 30-byte SOCKADDR_BTH, GUID/address validation, explicit UUID or channel resolution                                        |
| `runtime/bluetooth/windows_winsock.py`                       | Lazy System32 Winsock binding, explicit permission, nonblocking connect, SO_ERROR, read/write, cancellation and resource cleanup |
| `runtime/bluetooth/windows_transport.py`                     | Byte-stream adapter, one write deadline, partial transfers, no uncertain replay, ownership/late-result checks                    |
| `runtime/bluetooth/transport.py`                             | Inert platform adapter factory; macOS behavior preserved                                                                         |
| `runtime/worker.py`                                          | Default transport uses that factory; Windows admission remains closed                                                            |
| `tests/test_windows*.py`, `tests/test_platform_transport.py` | 41 new inert endpoint/API/adapter/factory regressions                                                                            |
| `native-tests/windows-rfcomm-abi.cpp`                        | New no-I/O Windows SDK layout/constant probe; not yet compiled on Windows                                                        |

The factory selects the same SPP UUID `00001101-0000-1000-8000-00805f9b34fb` used by the macOS helper's UUID16 `0x1101`; it does not guess an RFCOMM channel. This source mapping is not Windows SDP acceptance. Joy framing, initialization, crypto and protocol bytes remain shared. ECB/checksum framing is not authenticated encryption or proof of device identity.

## Verified here / not verified

A separate clean Git worktree was populated from the exact commits, then `npm ci`, a new Python 3.12 virtualenv setup and full `npm run check` passed on macOS. Observed coverage: 952 Vitest tests, 476 Python tests, typecheck/format/build, 37 compiled-host modules and nine frozen-runtime inert cases. The previous first delegate's guard-only Winsock tests were insufficient: parent API-call regressions reproduced and corrected connection-error, EOF, cleanup, invalid-handle, timeout and cancellation failures.

No real Windows DLL, Windows SDK compilation, Windows runtime packaging or Cricut device was exercised. Inert-DLL tests exercise our ctypes call boundary, not the real Windows API implementation. Windows CI can run portable contracts but has no demonstrated Bluetooth radio/device acceptance.

Dependency installation also reported **34 npm audit findings (1 low, 9 moderate, 22 high, 2 critical)**. They have not been triaged in this task. Run and review `npm audit`; do not use `npm audit fix --force` or treat a passing build as release/security approval.

## 1. Clone and install on Windows (PowerShell)

Use Windows 10/11 x64, Git, **Node 24**, Python **3.12** with the `py` launcher, and VS 2022 Build Tools + Windows SDK for the ABI probe. Native ARM64 is not accepted yet. Run from a normal writable development folder, not a system folder. A live device is NOT needed for sections 1–4.

```powershell
git clone --branch feature/windows-native-bluetooth https://github.com/desm-it/KindCut.git KindCut-windows-bluetooth
cd KindCut-windows-bluetooth
git merge-base --is-ancestor 2ebefef1e2d07e267d31c08ed200df151424207f HEAD
if ($LASTEXITCODE -ne 0) { throw 'Wrong branch or missing implementation commit' }
git log -3 --oneline

$ErrorActionPreference = 'Stop'
function Assert-Exit($step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit $LASTEXITCODE" }
}
$env:TMPDIR = Join-Path $env:LOCALAPPDATA 'KindCut-test-tmp'
New-Item -ItemType Directory -Force $env:TMPDIR | Out-Null
$env:PYTHON = (py -3.12 -c "import sys; print(sys.executable)").Trim()
Assert-Exit 'Locate Python 3.12'
node --version
& $env:PYTHON --version
npm ci
Assert-Exit 'npm ci'
npm run setup --workspace @cricut-companion/joy-runtime
Assert-Exit 'Joy runtime setup'
$joyPython = Join-Path $PWD 'packages/joy-runtime/.venv/Scripts/python.exe'
& $joyPython --version
Assert-Exit 'Virtualenv interpreter'
```

Do not mix the legacy SliceBug Python 3.10 toolchain with the app-owned Python 3.12 runtime. Do not import CricutDevice, Design Space caches, real keys or saved calibration into test fixtures.

## 2. Run focused inert Windows regressions

```powershell
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = Join-Path $PWD 'packages/joy-runtime/runtime'
    & $joyPython -m unittest discover -s packages/joy-runtime/tests -p 'test_windows*.py' -v
    Assert-Exit 'Windows contracts (37 tests at implementation commit)'
    & $joyPython -m unittest discover -s packages/joy-runtime/tests -p 'test_platform_transport.py' -v
    Assert-Exit 'Platform/factory integration (4 tests)'
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
```

Tests use injected inert DLL/byte peers. They must not load a live Bluetooth session, connect a radio or move a device. Keep negative tests proving Windows production admission remains closed until the wider feature is ready. If changing that policy later, replace its negative regression with the complete guarded admission/ownership tests, not a blanket skip.

## 3. Run repository checks

Some existing desktop integration fixtures name `.venv/bin/python` even on Windows. CI currently creates real-interpreter symbolic links. On a local Windows machine, enable Developer Mode or use the permissions needed for these two links; do not replace them with fake outputs or silently skip suites:

```powershell
$bin = Join-Path $PWD 'packages/joy-runtime/.venv/bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$target = (Resolve-Path $joyPython).Path
foreach ($name in @('python', 'python.exe')) {
    $aliasPath = Join-Path $bin $name
    if (-not (Test-Path $aliasPath)) {
        New-Item -ItemType SymbolicLink -Path $aliasPath -Target $target | Out-Null
    }
}
npm run check
Assert-Exit 'Full repository check'
git diff --check
Assert-Exit 'Whitespace check'
```

The canonical runner declares POSIX-only exclusions; record what Windows actually runs. Do not assume the macOS test count applies on Windows. The existing Windows `build-runtime.cjs` still reports macOS-only/skips the native build, and `test:runtime-inert` is macOS-only. Thus a green root check on Windows does NOT establish a Windows Joy runtime artifact or the nine frozen native cases. Capture these limitations rather than claiming coverage that did not run.

## 4. Compare against the actual Windows SDK (no Bluetooth I/O)

Open an **x64 Native Tools / Developer PowerShell for VS 2022** with `cl.exe` available, return to this checkout and recreate `$env:TMPDIR` if this is a fresh shell. Match compiler target and Python architecture.

```powershell
$probeExe = Join-Path $env:TMPDIR 'kindcut-rfcomm-abi.exe'
$probeObj = Join-Path $env:TMPDIR 'kindcut-rfcomm-abi.obj'
cl.exe /nologo /EHsc /std:c++17 /W4 "/Fo$probeObj" "/Fe$probeExe" packages/joy-runtime/native-tests/windows-rfcomm-abi.cpp
if ($LASTEXITCODE -ne 0) { throw 'Windows SDK ABI comparison failed' }
& $probeExe
if ($LASTEXITCODE -ne 0) { throw 'ABI probe execution failed' }
```

The probe has compile-time checks for packed address/GUID offsets, pointer-sized SOCKET, fd_set alignment, timeval, WSAStartup backing-buffer size and constants. It prints observed sizes, but performs no socket creation/discovery/pairing/connect. Archive compiler version, OS/Python architecture, output and source commit. This probe is supplied for execution on Windows; it was not compiled on macOS.

A separate no-radio Winsock startup/cleanup smoke check should then validate real DLL loading, signatures and negotiated 2.2 version before any RFCOMM connection. Keep startup/cleanup balanced even on failure; the injected API tests alone do not establish that real call boundary.

## 5. Finish the feature in this order

1. **Actual Windows API acceptance.** Run the above, add a repeatable no-radio real-DLL startup/cleanup test, and diagnose any ABI/calling-convention/error behavior before allowing a radio connection.
2. **Paired-device discovery.** Implement an app-owned Windows equivalent of `joy_rfcomm --devices`: return filtered compatible original-Joy name/id/paired/connected metadata. Inspect `runtime/bluetooth/joy_rfcomm.m`, `apps/desktop/src/shell/joy-discovery.ts` and its tests. Do not perform active inquiry, automatic pairing, adapter resets or device traffic at global startup. Select automatically only one unambiguous paired candidate.
3. **Windows frozen runtime.** Extend `packages/joy-runtime/scripts/build-runtime.cjs` and resource copying for `.venv/Scripts/python.exe` and a Windows `.exe` artifact, without compiling IOBluetooth/Objective-C or invoking vendor helpers. Inspect package host guards, `apps/desktop/package.json` mac/win extraResources and `.github/workflows/release.yml`. Include required shared profile/decoder data; never ship real keys, device calibration or synthetic execution fixtures. Verify fresh install, resource discovery and relocation on Windows.
4. **Guarded host and worker integration.** Review all Darwin gates in `runtime/worker.py`, `runtime/joy_loading_task.py`, `runtime/joy_job_task.py`, desktop `native-joy-service.ts`, `main.ts`, routing/startup snapshots and platform UI metadata. Preserve private host intents, exclusive ownership, cancellation generations, post-await and queued Go/Resume checks, calibration/device binding, quarantine and explicit tool approvals. Do not spoof `platform='darwin'` for real Windows I/O; that exists only in an explicitly inert integration test.
5. **Frozen Windows inert matrix.** Exercise actual compiled host + real workspace producer + actual frozen Windows worker + SDK inert peer for initialization/configuration, source-bound recipes, loading/job/cancel/retirement, CardMat and all advertised vinyl modes. Current nine-case harness is macOS-scoped; extend it honestly instead of replacing a frozen worker with fabricated replies. Prove startup stays metadata-only and there is no unexpected secret access.
6. **Authorized device acceptance.** Only after explicit operator approval, test paired discovery and a single RFCOMM connection, then encrypted initialization/configuration reads, recording each boundary separately. Retire or safely hand off any existing app owner first; never kill/End an unknown retained session. Connection/read approval is NOT Load/Go/cut/unload permission. Get fresh physical setup/clearance and distinct approvals before any movement. Do not bypass host gates with renderer flags or run a cut automatically.
7. **Windows UI/install acceptance.** Test normal auto/native/legacy routing, real packaged renderer/preload/main IPC, fresh and saved profiles, save/open/history, Make previews, connection failure/cancel/retry, multiple/zero candidates and uninstall/update behavior. A clickable Connect button or an inert success does not establish real connectivity.
8. **2.2.0 release.** Only after the remaining acceptance is actually observed, update matching app/workspace/lockfile versions, preserve already accepted 2.1.1 fixes, create reviewed release notes and produce installers from the exact immutable tag. Do not call this branch or a local dirty bundle a published Windows-native release.

## Record and hand back

For every failing gate retain: full commit, Windows version/architecture, Python/Node/compiler versions, exact command/exit status, phase/first error, native numeric error code and whether any DLL/socket/device operation occurred. Never log keys or full private request payloads. Preserve a failed delegated verdict; fix it with a meaningful regression rather than rewriting it as passed.

Useful existing docs: `AGENTS.md`, `docs/architecture.md`, `docs/github-release-ci.md`, `docs/plans/windows-native.md`, `docs/maintainability-refactor-results.md`. Private `docs/research/` is ignored and is not a clean-clone prerequisite. This tracked handoff contains the continuation context needed on Windows.
