/**
 * Authorization gateway HTTP contract for the experience pool page: the wire
 * types, the decoders that narrow them, and one fetch wrapper carrying the
 * timeout every call needs. Pure browser networking — no settings, no
 * credentials, no component state.
 *
 * @module bobo-settings-experience-ui/license-api
 */
import type { ExperienceLicenseCache } from '../experience-pool.ts';
/** License facts as the gateway reports them over the wire. */
export interface LicenseInfo {
    /** Plan code (for example `3m`). */
    planCode: string;
    /** License status (for example `active`). */
    status: string;
    /** ISO timestamp the license became active. */
    licenseStart: string;
    /** ISO timestamp the license expires. */
    expiresAt: string;
}
/** Successful `activate`, `refresh`, and `migrate/complete` body, narrowed. */
export interface LicenseAuth {
    /** Bearer token for `/v1/license/me` and `/v1/license/refresh`. */
    accessToken: string;
    /** Server clock of this response; remaining days derive from it, not the client clock. */
    serverTime: string;
    /** The license this token carries. */
    license: LicenseInfo;
}
/** Successful `GET /v1/license/me` body, narrowed to the summary fields the page shows. */
export interface LicenseMe {
    /** Server clock of this response. */
    serverTime: string;
    /** The license the token carries. */
    license: LicenseInfo;
}
/** Successful `GET /v1/health` body, narrowed. */
export interface HealthReport {
    /** Whether the gateway's upstream Qdrant answered. */
    qdrantReachable: boolean;
}
/** Why one gateway call failed, as the page turns it into copy. */
export type GatewayFailure = 
/** The timeout aborted the request. */
{
    readonly kind: 'timeout';
}
/** The request never produced an HTTP answer (DNS, TLS, offline, CORS). */
 | {
    readonly kind: 'network';
}
/** An HTTP answer whose body the page cannot use. */
 | {
    readonly kind: 'malformed';
}
/** A non-2xx HTTP answer, carrying the server's own description when it sent one. */
 | {
    readonly kind: 'http';
    readonly status: number;
    readonly description?: string;
    readonly errorCode?: string;
};
/** Result of one gateway call: narrowed body or the failure the page renders. */
export type GatewayResult = {
    readonly ok: true;
    readonly body: unknown;
} | {
    readonly ok: false;
    readonly failure: GatewayFailure;
};
/**
 * Call one gateway endpoint with a hard timeout and no credentials echoed back.
 * @param baseUrl - gateway base URL the settings section currently holds.
 * @param path - absolute path such as `/v1/health`.
 * @param init - method, headers, and body for this call.
 * @returns the parsed JSON body on 2xx, or the failure classification otherwise.
 */
export declare function callGateway(baseUrl: string, path: string, init: RequestInit): Promise<GatewayResult>;
/**
 * Narrow a successful `activate` / `migrate/complete` body.
 * @param body - parsed JSON body of the response.
 * @returns the token, server clock, and license, or undefined for any other body.
 */
export declare function decodeLicenseAuth(body: unknown): LicenseAuth | undefined;
/**
 * Narrow a successful `GET /v1/license/me` body.
 * @param body - parsed JSON body of the response.
 * @returns the server clock and license, or undefined for any other body.
 */
export declare function decodeLicenseMe(body: unknown): LicenseMe | undefined;
/**
 * Narrow a successful `GET /v1/health` body.
 * @param body - parsed JSON body of the response.
 * @returns the upstream reachability fact, or undefined for any other body.
 */
export declare function decodeHealth(body: unknown): HealthReport | undefined;
/**
 * Project one response's license and server clock into the cached display
 * facts the settings section stores.
 * @param license - the license the response carried.
 * @param serverTime - the response's server clock.
 * @returns the non-sensitive cache entry.
 */
export declare function licenseCache(license: LicenseInfo, serverTime: string): ExperienceLicenseCache;
/**
 * Whole days from the server clock until expiry, never the client clock.
 * @param expiresAt - ISO expiry timestamp from the response.
 * @param serverTime - ISO server clock from the same response.
 * @returns whole days left (0 once expired), or undefined when either stamp is unparseable.
 */
export declare function remainingDays(expiresAt: string, serverTime: string): number | undefined;
/** Days-left threshold under which the page paints the expiry warning. */
export declare const EXPIRING_SOON_DAYS = 7;
//# sourceMappingURL=license-api.d.ts.map