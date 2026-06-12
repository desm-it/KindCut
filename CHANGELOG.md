# Changelog

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
