/**
 * Authorization gateway HTTP contract for the experience pool page: the wire
 * types, the decoders that narrow them, and one fetch wrapper carrying the
 * timeout every call needs. Pure browser networking — no settings, no
 * credentials, no component state.
 *
 * @module bobo-settings-experience-ui/license-api
 */
/** Milliseconds before one gateway call aborts. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Plain-object view of a wire value, or undefined for anything else. */
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/** A wire string, or undefined for a missing or mistyped field. */
function text(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/**
 * Call one gateway endpoint with a hard timeout and no credentials echoed back.
 * @param baseUrl - gateway base URL the settings section currently holds.
 * @param path - absolute path such as `/v1/health`.
 * @param init - method, headers, and body for this call.
 * @returns the parsed JSON body on 2xx, or the failure classification otherwise.
 */
export async function callGateway(baseUrl, path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
    const url = `${baseUrl.trim().replace(/\/+$/u, '')}${path}`;
    let response;
    try {
        response = await fetch(url, { ...init, signal: controller.signal });
    }
    catch {
        clearTimeout(timer);
        return {
            ok: false,
            failure: controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network' },
        };
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        // A body read cut short by the same abort is the timeout, not a parse miss.
        if (controller.signal.aborted)
            return { ok: false, failure: { kind: 'timeout' } };
        body = undefined;
    }
    finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        const record = asRecord(body);
        const description = record === undefined ? undefined : text(record.status_description);
        const errorCode = record === undefined ? undefined : text(record.error_code);
        return {
            ok: false,
            failure: {
                kind: 'http',
                status: response.status,
                ...description === undefined ? {} : { description },
                ...errorCode === undefined ? {} : { errorCode },
            },
        };
    }
    return { ok: true, body };
}
/** Narrow one wire license record (snake case on the wire). */
function decodeLicense(value) {
    const record = asRecord(value);
    if (record === undefined)
        return undefined;
    const planCode = text(record.plan_code);
    const status = text(record.status);
    const licenseStart = text(record.license_start);
    const expiresAt = text(record.expires_at);
    if (planCode === undefined || status === undefined || licenseStart === undefined || expiresAt === undefined) {
        return undefined;
    }
    return { planCode, status, licenseStart, expiresAt };
}
/**
 * Narrow a successful `activate` / `migrate/complete` body.
 * @param body - parsed JSON body of the response.
 * @returns the token, server clock, and license, or undefined for any other body.
 */
export function decodeLicenseAuth(body) {
    const record = asRecord(body);
    if (record === undefined)
        return undefined;
    const accessToken = text(record.access_token);
    const serverTime = text(record.server_time);
    const license = decodeLicense(record.license);
    if (accessToken === undefined || serverTime === undefined || license === undefined)
        return undefined;
    return { accessToken, serverTime, license };
}
/**
 * Narrow a successful `GET /v1/license/me` body.
 * @param body - parsed JSON body of the response.
 * @returns the server clock and license, or undefined for any other body.
 */
export function decodeLicenseMe(body) {
    const record = asRecord(body);
    if (record === undefined)
        return undefined;
    const serverTime = text(record.server_time);
    const license = decodeLicense(record.license);
    if (serverTime === undefined || license === undefined)
        return undefined;
    return { serverTime, license };
}
/**
 * Narrow a successful `GET /v1/health` body.
 * @param body - parsed JSON body of the response.
 * @returns the upstream reachability fact, or undefined for any other body.
 */
export function decodeHealth(body) {
    const record = asRecord(body);
    if (record === undefined || typeof record.qdrant_reachable !== 'boolean')
        return undefined;
    return { qdrantReachable: record.qdrant_reachable };
}
/**
 * Project one response's license and server clock into the cached display
 * facts the settings section stores.
 * @param license - the license the response carried.
 * @param serverTime - the response's server clock.
 * @returns the non-sensitive cache entry.
 */
export function licenseCache(license, serverTime) {
    return {
        planCode: license.planCode,
        status: license.status,
        licenseStart: license.licenseStart,
        expiresAt: license.expiresAt,
        serverTime,
    };
}
/** Milliseconds in one day. */
const DAY_MS = 86_400_000;
/**
 * Whole days from the server clock until expiry, never the client clock.
 * @param expiresAt - ISO expiry timestamp from the response.
 * @param serverTime - ISO server clock from the same response.
 * @returns whole days left (0 once expired), or undefined when either stamp is unparseable.
 */
export function remainingDays(expiresAt, serverTime) {
    const expires = Date.parse(expiresAt);
    const observed = Date.parse(serverTime);
    if (!Number.isFinite(expires) || !Number.isFinite(observed))
        return undefined;
    return Math.max(0, Math.ceil((expires - observed) / DAY_MS));
}
/** Days-left threshold under which the page paints the expiry warning. */
export const EXPIRING_SOON_DAYS = 7;
//# sourceMappingURL=license-api.js.map