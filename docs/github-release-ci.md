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
- Windows packaging uses Python 3.10 because SliceBug's pinned
  `cx-Freeze==6.13.2` provides a compatible prebuilt Windows wheel there.
- The KindCut SliceBug bundler also constrains `lief` to `>=0.12,<0.13` so the
  old `cx-Freeze` pin does not pick up a newer incompatible parser API.

The release workflow runs when a GitHub Release is published. It builds native
macOS and Windows artifacts, then uploads them to that release. It also runs for
version tags such as `v1.0.0` or `1.0.0`; tag builds create a draft GitHub
release and attach the generated artifacts.

The workflow can also be started manually from GitHub Actions. Pass
`release_tag` to attach builds to an existing release, or leave it blank to make
smoke-test artifacts only.

Release builds also generate updater metadata for the generic update feed:

```text
latest-mac.yml
latest.yml
```

KindCut is configured to check `https://kindcut.joeldesmit.nl/` silently in
packaged builds. The sibling `KindCutUpdateServer/` project serves those files
and installers from a Proxmox-hosted VM or container. If the update feed is
unreachable or has no newer version, KindCut does not notify the user.

## Release Flow

1. Commit the release-ready source.
2. Push a branch and wait for CI to pass.
3. Start the `Release Builds` workflow manually for a smoke build, optionally
   choosing a SliceBug ref.
4. Download and smoke-test the artifacts.
5. Publish a GitHub Release for the exact tag when ready:

```bash
git tag 1.0.0
git push origin 1.0.0
```

Publishing the GitHub Release triggers the native release workflow and attaches
the macOS DMG/zip and Windows installer to the release.

## Signing Status

The current workflow builds unsigned artifacts. Before broad distribution, add:

- Apple Developer ID certificate, provisioning/notarization credentials, and
  `electron-builder` mac signing configuration.
- Windows code-signing certificate and `electron-builder` Windows signing
  configuration.

Until signing is configured, treat CI output as smoke-test artifacts.
