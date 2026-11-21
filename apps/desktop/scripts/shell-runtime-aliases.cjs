// One declarative owner for TS-development packages that need a CJS runtime artifact.
module.exports = Object.freeze([
  {
    specifier: '@cricut-companion/svg-preflight',
    entry: '../../../packages/svg-preflight/src/joy-svg-plan.ts',
    output: 'vendor/native-joy-svg.cjs',
  },
]);
