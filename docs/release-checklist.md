# KindCut 1.0 Release Checklist

Use this checklist before tagging or sharing a KindCut release build.

## Version and Git

- Confirm all workspace `package.json` versions are `1.0.0`.
- Confirm `package-lock.json` was refreshed after version changes.
- Confirm the working tree only contains intentional release changes.
- Commit locally before packaging final artifacts.
- Do not push or tag until the local smoke build has been tested.

## SliceBug Runtime

- Keep the current local SliceBug checkout at `vendor/slicebug/`.
- Run `npm run build:slicebug`.
- Confirm `apps/desktop/resources/slicebug/slicebug --version` prints `0.2` or the expected SliceBug version.
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

Build Windows artifacts on Windows before release-signing them.

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
