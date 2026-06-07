# Vendored Runtime Checkouts

`vendor/slicebug/` is a local, ignored copy of the SliceBug worktree used to
build the helper binary that KindCut bundles in release builds.

For now it is intentionally not tracked by the KindCut repository. That lets us
carry Joel's local dirty SliceBug worktree while we polish KindCut 1.0, then
replace it with a proper pullable dependency later.

Expected local layout:

```text
vendor/slicebug/
  .git/
  slicebug/
  setup.py
  requirements-dev.txt
```

For release CI, GitHub Actions checks out `desm-it/slicebug` `main` into this
same path before building native macOS and Windows packages.

Build the bundled runtime with:

```bash
npm run build:slicebug
```

The frozen helper is written to `apps/desktop/resources/slicebug/`, which is
also ignored and included in Electron packages as an app resource. The build
also vendors SliceBug's pinned `usvg` helper into
`apps/desktop/resources/slicebug/plugins/usvg/` so the packaged app can run SVG
planning without relying on SliceBug's first-run downloader.
