/**
 * The `experience-pool` settings namespace contract shared by the Host
 * registration (the node half) and the browser page: the namespace key, the
 * gateway default, and the section's field types. Values only — the schemastery
 * schema itself stays in the node half so the browser bundle never carries it.
 *
 * @module bobo-settings-experience-ui/experience-pool
 */
/** Settings namespace the license page reads and writes on the Host. */
export const EXPERIENCE_POOL_NAMESPACE = 'experience-pool';
/** Gateway base URL a fresh section starts from; the page can edit it for testing. */
export const DEFAULT_GATEWAY_URL = 'https://www.smartbobo.cn';
//# sourceMappingURL=experience-pool.js.map