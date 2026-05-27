# SliceBug Status

Local SliceBug checkout:

```text
/Users/joeldesmit/Cricut/SlicebugMac
```

Known capabilities from Joel's branch:

- macOS support based on `hoff/slicebug` branch `macos-support`
- Cricut Joy software-button experiments
- configurable mat presets/sizes
- Joy StandardGrip mat recipe: 4.5×12 inches
- software Load/Unload and Go via CricutDevice statuses

Safety:

- `slicebug cut` is a real hardware command.
- The companion app must never execute it without explicit confirmation.
- Initial integration should generate/preview commands only.
