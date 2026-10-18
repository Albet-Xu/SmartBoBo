/**
 * The `experience-pool` settings namespace contract shared by the Host
 * registration (the node half) and the browser page: the namespace key, the
 * gateway default, and the section's field types. Values only — the schemastery
 * schema itself stays in the node half so the browser bundle never carries it.
 *
 * @module bobo-settings-experience-ui/experience-pool
 */
/** Settings namespace the license page reads and writes on the Host. */
export declare const EXPERIENCE_POOL_NAMESPACE = "experience-pool";
/** Gateway base URL a fresh section starts from; the page can edit it for testing. */
export declare const DEFAULT_GATEWAY_URL = "https://www.smartbobo.cn";
/**
 * Non-sensitive license facts cached in settings so the page can show status
 * after a reload. The access token never rides here — it lives in credentials
 * and the page's own memory only.
 */
export interface ExperienceLicenseCache {
    /** Plan code as the gateway reported it (for example `3m`). */
    planCode: string;
    /** License status as the gateway reported it (for example `active`). */
    status: string;
    /** ISO timestamp the license became active. */
    licenseStart: string;
    /** ISO timestamp the license expires. */
    expiresAt: string;
    /** Server clock of the response that produced this cache, used instead of the client clock. */
    serverTime: string;
}
/** Resolved `experience-pool` section the page renders from. */
export interface ExperiencePoolSettings {
    /** Authorization gateway base URL, without a trailing slash. */
    baseUrl: string;
    /** Stable per-install device identifier sent to `activate` and `refresh`. */
    deviceId: string;
    /** Last known license status; absent until the first successful activation. */
    license?: ExperienceLicenseCache;
}
//# sourceMappingURL=experience-pool.d.ts.map