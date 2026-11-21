// Default: every new test/workspace is portable and participates. Exceptions are explicit.
module.exports = Object.freeze({
  version: 1,
  exceptions: Object.freeze([
    ...[
      'joy-configuration-store',
      'joy-provisioning-store',
      'joy-runtime-resource-copy',
      'native-joy-job-journal',
      'native-joy-loading-journal',
    ].map((name) => ({
      file: `apps/desktop/src/shell/${name}.test.ts`,
      excludedOn: ['win32'],
      reason: 'Native macOS filesystem modes/O_NOFOLLOW or Darwin framework symlinks.',
    })),
    {
      file: 'packages/joy-runtime/tests/test_joy_load_test.py',
      excludedOn: ['win32'],
      reason: 'Native POSIX fcntl/pipe-locking integration, covered in full on POSIX.',
    },
  ]),
});
