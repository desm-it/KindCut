# GitHub release CI

The workflow files and committed platform test policy are the executable source of truth. Release product source and workflow/build-tool provenance are distinct; a CI repair must not rewrite a published tag.

## Reproducible inputs

- Install the committed npm lockfile with `npm ci`; use pinned tool versions.
- Set up the Joy runtime from its pinned build requirements with Python3.12.
- `.github/workflows/release.yml` pins SliceBug to immutable commit `f00348732cc6501b987a39cff0a1982d8b35cad7` in `desm-it/slicebug`. It does **not** accept a moving `SLICEBUG_REF=main` override. Change the reviewed workflow pin deliberately when upgrading.
- The helper checkout is `vendor/slicebug/`, ignored by git. A read-only `SLICEBUG_TOKEN` is needed only if repository access requires it; never put credentials in source or release notes.
- macOS ARM64 uses `macos-15`; Windows x64 uses `windows-2022`. Native runtime tests use Python3.12, while Windows legacy SliceBug packaging separately uses Python3.10 for its compatible cx-Freeze wheel. Keep those environments separate.

## Checks and platform policy

CI runs on macOS, Linux and Windows. It uses repository test commands/platform classification rather than pretending Unix file modes/fcntl are Windows contracts. POSIX runs full inert native coverage; Windows runs supported portable contracts. No workflow connects a cutter, reads real secrets or sends movement.

`TMPDIR` is initialized in a shell step through `GITHUB_ENV`; job-level expressions cannot assume a runner context. Older immutable tags can require real-interpreter compatibility aliases for POSIX-style test paths. Such aliases are build tooling, not synthetic test responses or edits to tagged source.

Release checks must include the emitted CommonJS host/shared-package boundary and the frozen offline compiler with SDK inert peers, not only source tests or `--probe`. Runtime resources preserve relative framework symlinks for relocation/signature verification.

## Publishing

1. Run the canonical checks and verify a clean-source build plus isolated inert package smoke test.
2. Commit reviewed product source only when authorized. Exclude private research, user profiles, real calibration/session keys and caches.
3. Create an immutable version tag and explicit release notes. The published-release event triggers `.github/workflows/release.yml`; tag pushes alone do not trigger duplicate release builds.
4. For a manual build, dispatch the workflow with `release_tag` naming the existing tag. Empty input makes smoke artifacts without attaching them to a release. There is no arbitrary mutable helper-ref input.
5. Wait for both native platform packaging jobs and the attachment job. The exact source tag is checked out. When repair tooling comes from the workflow revision, it is checked out separately at `github.workflow_sha`, outside the tagged product source.
6. Verify DMG, ZIP, Windows EXE, blockmaps and both `latest-mac.yml`/`latest.yml` feeds on the release. Check feed version, filenames, sizes and SHA512 against actual downloaded artifacts. A published release entry without assets is not completion.
7. Verify the actual macOS runtime/profile resources and packaged host boundary, plus documented supported-platform smoke behavior. Do not infer physical acceptance from software checks.

KindCut's packaged updater reads the public `desm-it/KindCut` feed and asks before installation; installation/update acceptance remains distinct from artifact assembly. Preserve existing release notes when adding verified provenance. Record the source commit and successful workflow run, not just a green local working tree.

## Signing and support limits

Current macOS artifacts use ad-hoc signing, not Apple Developer ID notarization. Strict signature integrity is not Gatekeeper/notarization acceptance. Developer ID/notarization and Windows signing require separately configured credentials and verification; do not invent or silently alter them during a refactor.

Native Joy support is original Joy on macOS Apple Silicon with supported firmware and explicit on-mat recipes. Windows remains the legacy route. New device/model, Smart/matless and physical stock/fault safety claims require separate implementation and acceptance.
