/**
 * Bundle this package from `src`, not from the tsc-emitted `lib/types` tree
 * every upstream package uses: this package is outside `tsconfig.host.json`
 * (adding it there would edit an upstream file), so on a clean tree its
 * `lib/types` is absent and a `lib/types`-based entry would abort the root
 * workspace build for the whole repository. Every other option mirrors the
 * root host build so a workspace run and a package run produce one artifact.
 */
export default {
  // `src/bridge.ts` is the second entry — the host-side HTTP route the Web
  // right-panel browser mirror posts to (mounted by packages/bobo/cordis.patch.yml).
  // It ships as its own `lib/bridge.js` because one Cordis plugin is one module:
  // the tool registration and the route are separate plugins, each with its own
  // `inject`, so neither may live inside the other's bundle. `src/handoff.ts` is
  // the third — the `browser_handoff` tool, mounted per preset like this package's
  // first entry, and separate for the same reason: its `inject` reaches the user.
  entry: ['src/index.ts', 'src/bridge.ts', 'src/handoff.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}
