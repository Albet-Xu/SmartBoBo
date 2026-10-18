import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * Package-local build faces. `lib/index.js` (the Loader's node half, which
 * registers the `experience-pool` settings namespace) is bundled from the tsc
 * output, and `lib/client.js` is the browser artifact the client module
 * registry serves — the same preset every `packages/client` package uses so
 * the module-table externals and the artifact layout stay identical.
 */
export default clientBundle('bobo-settings-experience-ui', ['lib/types/index.js'])
