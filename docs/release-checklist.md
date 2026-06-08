# KindCut Release Checklist

Use this checklist before tagging or sharing a KindCut release build.

## Version and Git

- Confirm all workspace `package.json` versions match the release version.
- Confirm `package-lock.json` was refreshed after version changes.
- Confirm the working tree only contains intentional release changes.
- Commit locally before packaging final artifacts.
- Push a branch and wait for GitHub CI before tagging.
- Do not tag until the local or CI smoke build has been tested.

## SliceBug Runtime

- Keep the current local SliceBug checkout at `vendor/slicebug/`.
- Run `npm run build:slicebug`.
- Run `npm run verify:slicebug`.
- Confirm `apps/desktop/resources/slicebug/slicebug --version` prints `0.3` or the expected SliceBug version.
- Confirm `apps/desktop/resources/slicebug/plugins/usvg/usvg --version` prints `0.27.0` on macOS/Linux, or `apps/desktop/resources/slicebug/plugins/usvg/usvg.exe --version` prints `0.27.0` on Windows.
- Confirm `vendor/slicebug/` and `apps/desktop/resources/slicebug/` stay ignored by the KindCut repo.
- Do not run `slicebug cut` from release checks unless the user is deliberately testing hardware.

## Automated Checks

```bash
npm run typecheck
npm run test
npm run build
npm run package:desktop:dir
```

`npm audit --omit=dev` currently reports the known `potrace` -> Jimp -> `phin`
moderate advisory. npm's suggested `potrace@2.1.1` fix pulls older transitive
packages with high/critical advisories, so do not downgrade for 1.0. Track a
post-1.0 tracer replacement or upstream dependency update instead.

For distributable artifacts:

```bash
npm run package:desktop:mac
npm run package:desktop:win
```

Build Windows artifacts on Windows, preferably with `.github/workflows/release.yml`,
before release-signing them. Local cross-packaging is blocked unless
`KINDCUT_ALLOW_CROSS_PACKAGE=1` is deliberately set for shell-only experiments.

For CI release setup, see `docs/github-release-ci.md`.

## Manual Smoke Test

- Launch `apps/desktop/release/mac-arm64/KindCut.app`.
- Confirm the app icon appears in the Dock and About panel.
- Create a new project, add text, add a shape, and import or generate an SVG.
- Save, close, reopen, and verify unsaved-change prompts behave correctly.
- Open the cut preview and confirm it shows clear guarded steps.
- Confirm the app does not start a hardware cut without explicit user action.
- Run the SliceBug setup/bootstrap flow on a machine with Cricut Design Space installed.

## Distribution Notes

- macOS builds are unsigned until Developer ID signing and notarization are configured.
- Windows builds need an `.ico`, code signing, and a real Windows smoke test before sharing broadly.
- Keep release artifacts out of git; commit source, config, docs, and icon assets only.
