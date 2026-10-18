import { defineDshConfig } from '../dsh-tauri-tsdown/src/index.ts'

export default defineDshConfig({
  // Client bundle inlines CJS deps (css-render/murmurhash) whose
  // `exports.default` triggers publint's __esModule+default false positive.
  publint: false,
  client: {
    dts: true,
  },
})
