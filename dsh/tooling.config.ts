import { fileURLToPath } from 'node:url'

export const SHARED_ALIAS = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}
