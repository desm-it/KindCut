# GitHub Release CI

KindCut release builds should run on native GitHub-hosted runners so the bundled
SliceBug runtime is built for the same operating system as the app package.

## Repository Setup

Create the KindCut GitHub repository, then push this repo to it:

```bash
git remote add origin https://github.com/desm-it/KindCut.git
git push -u origin feature/cut-flow-and-project-guards
```

Set these repository variables in GitHub under Settings -> Secrets and variables
-> Actions -> Variables:

```text
SLICEBUG_REPOSITORY=desm-it/slicebug
SLICEBUG_REF=main
```

If the SliceBug repository is private and the default `GITHUB_TOKEN` cannot read
it, add this repository secret:

```text
SLICEBUG_TOKEN=<fine-grained token with read access to the SliceBug repo>
```

The release workflow checks SliceBug out into `vendor/slicebug/`, which stays
ignored in the KindCut repo. That keeps KindCut pullable while still letting CI
bundle a fresh SliceBug runtime from `desm-it/slicebug` `main`.

## Workflows

- `.github/workflows/ci.yml` runs typecheck, tests, and production build on
  pull requests and branch pushes.
- `.github/workflows/release.yml` builds release artifacts on native runners:
  macOS arm64 on `macos-15`, Windows x64 on `windows-latest`.

The release workflow can be started manually from GitHub Actions. It also runs
for tags matching `v*`; tag builds create a draft GitHub release and attach the
generated artifacts.

## Release Flow

1. Commit the release-ready source.
2. Push a branch and wait for CI to pass.
3. Start the `Release Builds` workflow manually for a smoke build, optionally
   choosing a SliceBug ref.
4. Download and smoke-test the artifacts.
5. Tag the exact commit when ready:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The tag workflow creates a draft GitHub release with the macOS DMG/zip and
Windows installer attached.

## Signing Status

The current workflow builds unsigned artifacts. Before broad distribution, add:

- Apple Developer ID certificate, provisioning/notarization credentials, and
  `electron-builder` mac signing configuration.
- Windows code-signing certificate and `electron-builder` Windows signing
  configuration.

Until signing is configured, treat CI output as smoke-test artifacts.
