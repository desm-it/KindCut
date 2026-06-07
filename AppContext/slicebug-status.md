# SliceBug Status

Local SliceBug checkout:

```text
/Users/joeldesmit/Cricut/SlicebugMac
```

KindCut 1.0 packaging checkout:

```text
/Users/joeldesmit/Cricut/CricutCompanionApp/vendor/slicebug
```

`vendor/slicebug/` is intentionally ignored by the KindCut repo for now. It is a copied worktree so KindCut can bundle SliceBug without rewriting upstream SliceBug. Later it can become a submodule, subtree, or scripted clone from the upstream branch.

Known capabilities from Joel's branch:

- macOS support based on `hoff/slicebug` branch `macos-support`
- Cricut Joy software-button experiments
- configurable mat presets/sizes
- Joy StandardGrip mat recipe: 4.5×12 inches
- software Load/Unload and Go via CricutDevice statuses

Safety:

- `slicebug cut` is a real hardware command.
- The companion app must never execute it without explicit confirmation.
- Tests should use command builders, fakes, or SliceBug smoke mode only.
- Packaged apps include the frozen helper from `apps/desktop/resources/slicebug/`.
