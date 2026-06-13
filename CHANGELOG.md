# Changelog

## 1.2.3 - 2026-06-13

### Fixed

- Bundle SliceBug 0.3.6 with a Design Space-compatible `logId` on the cutter startup message.
- Add native CricutDevice bridge-log details to SliceBug ping-loop timeout diagnostics.
- Keep the Windows startup timeout path non-hanging while collecting better clues for Bluetooth/helper startup failures.

## 1.2.2 - 2026-06-13

### Fixed

- Keep the SliceBug 0.3.5 Windows cutter startup diagnostics and helper bootstrap recovery from 1.2.1.
- Harden the Windows release build by retrying the bundled `usvg` download, falling back to `curl`, and logging full download errors.
- Pin the Windows release runner to `windows-2022` while GitHub migrates `windows-latest` to the newer Server 2025 image.

## 1.2.1 - 2026-06-13

### Fixed

- Bundle SliceBug 0.3.5 with a clean `device-common` bootstrap copy so stale Windows plugin files are removed before helper setup imports fresh Design Space files.
- Improve SliceBug bootstrap user selection when Design Space has multiple `LocalData` users, preferring a user that has both `UserSettings` and machine profiles.
- Add non-secret SliceBug diagnostics for request-key, settings, profile, and device-plugin fingerprints to help debug Windows cutter startup issues.
- Treat the Windows CricutDevice ping-loop startup timeout as a recoverable helper setup problem, so KindCut retries bootstrap once.

## 1.2.0 - 2026-06-13

### Added

- Add **Skip this update** so automatic update prompts can be suppressed for one specific release while manual checks still work.
- Add local PNG/JPG import with a Potrace preview modal, progress feedback, and import into the local image library.
- Add trace settings for local raster imports: threshold, detail, invert, reset, and debounced live preview updates.
- Add image library renaming by double-clicking the image name, including filename renames and automatic duplicate numbering.

### Fixed

- Keep the previous vector preview visible while local image retracing is running.
- Make the raster threshold slider use a real pixel luminance cutoff so the full slider range changes the trace.
- Translate newly added cut-window status and error messages into Dutch.

## 1.1.14 - 2026-06-13

### Fixed

- Fix Windows auto-update downloads by making the installer asset name match `latest.yml`.
- Add release metadata verification so CI fails if updater YAML references a missing build asset.
- Update README install instructions to use the new Windows installer filename.

## 1.1.13 - 2026-06-12

### Fixed

- Bundle SliceBug 0.3.4 with a fuller CricutDevice ping reply for Windows startup handshakes.
- Add a 60-second ping-only startup timeout so stuck Windows cutter connections fail with clear diagnostics instead of hanging.
- Log ping count and elapsed startup time when CricutDevice stays in the heartbeat loop.

## 1.1.12 - 2026-06-12

### Added

- Add a cross-platform in-app update modal with checking, available, downloading, ready, installing, and error states.
- Show update download progress inside KindCut with percent, transferred bytes, total bytes, and speed when available.
- Add explicit update choices for downloading now, downloading in the background, restarting to update, and trying later.
- Log updater events, errors, cache hints, pending update state, and downloaded files for Windows debugging.

### Fixed

- Bundle SliceBug 0.3.3 so the copied CricutDevice helper starts from its own plugin directory and writes stderr diagnostics.
- Clear stale pending update state when the installed app version has already caught up.
- Keep automatic update-check failures silent while showing manual check failures in the modal.

## 1.1.11 - 2026-06-12

### Fixed

- Bundle SliceBug 0.3.2 with a Windows cutter handshake fix.
- Handle CricutDevice `riPing` frames by replying with `riPingReply` instead of treating them as protocol errors.
- Keep the extra SliceBug debug logging from 1.1.10 so Windows cut-session failures still write useful diagnostics.

## 1.1.10 - 2026-06-12

### Added

- Bundle SliceBug 0.3.1 for Windows debugging.
- Write SliceBug protocol diagnostics to `slicebug-debug.log` beside `kindcut.log`.
- Automatically rerun helper setup once when CricutDevice rejects cut startup with `expected 2, got 0`.

### Fixed

- Show the actual cut-session recovery message in the cut UI instead of replacing it with generic error copy.

## 1.1.9 - 2026-06-12

### Added

- Added persistent production diagnostics logging for SliceBug helper setup, plan generation, and cut-session traffic.
- Added an **Open Logs Folder** menu action so installed Windows and macOS builds can expose `kindcut.log`.
- Added startup diagnostics with app version, platform, app paths, resources path, and log file path.

### Fixed

- Mirror SliceBug debug/error output to a local log file instead of relying only on hidden production console output.

## 1.1.8 - 2026-06-11

### Added

- Hardened Windows SliceBug bootstrap by trying alternate Design Space install and profile folders.
- Added post-bootstrap `list-materials` validation, which checks keys and machine profiles without touching hardware.
- Added console debug logging around SliceBug commands, cut-session output, and continue prompts.
- Added a README development note clarifying that KindCut is a 100% vibe coded / AI generated codebase.

### Fixed

- Detect empty or incomplete SliceBug machine profiles before generating plans.
- Block cuts when Design Space or its cutter helper appears to be holding the Windows connection.
- Show friendlier setup, Bluetooth, wrong-cutter, multiple-cutter, and helper-connection errors.
- Clear stale bootstrapped device-plugin files before re-importing from Design Space.

## 1.1.1 - 2026-06-08

### Fixed

- Ad-hoc sign macOS smoke builds as complete app bundles instead of leaving them unsigned.

### Notes

- macOS builds still need Apple Developer ID signing and notarization before broad public distribution.

## 1.1.0 - 2026-06-08

### Added

- Silent background update checks for packaged KindCut builds.
- GitHub Releases update feed support, so published release assets can be found by installed apps automatically.
- GitHub release build workflow support for attaching updater metadata and native installers to releases.

### Changed

- Refreshed the public README with clearer install/update guidance and a polished product screenshot.
- Hardened CI dependency installation with retries to reduce flaky Electron download failures during release builds.

### Notes

- Update checks stay silent when offline, when GitHub is unreachable, or when no newer release is available.
- macOS and Windows release artifacts are still unsigned until signing and notarization are configured.
