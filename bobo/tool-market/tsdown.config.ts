import { defineConfig } from 'tsdown'

// Bundle from `src`, not the tsc-emitted `lib/types` tree: the package imports
// `../../plugins/market-core.mjs` relative to `src/`, and a `lib/types` entry
// would carry that specifier one directory too deep for the resolver.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
