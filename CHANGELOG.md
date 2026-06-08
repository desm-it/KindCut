# Changelog

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
