/**
 * Experience pool settings page, browser half: contributes the Experience
 * Pool section to Settings and owns every call it makes — license activation,
 * status refresh, migration, connection diagnostics, and the settings and
 * credential writes behind them. The gateway URL, device id, and cached
 * license status persist through the `experience-pool` settings namespace the
 * node half registers; the access token and license key persist through the
 * `credentials` Remote namespace and are never echoed back to the page. The
 * session token itself is held in this closure only, so a page reload keeps
 * the cached status display but asks for the key again to go back online.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
// Client-safe UUID minting: the lint rule points crypto.randomUUID callers here.
import { randomUUID } from '@deepseek-ai/dsh-util-crypto';
import { DEFAULT_GATEWAY_URL, EXPERIENCE_POOL_NAMESPACE, } from "../experience-pool.js";
import { ExperienceSection } from "./ExperienceSection.js";
import { decodeExperience, experienceView, experienceWriteOps, } from "./experience.js";
import { callGateway, decodeHealth, decodeLicenseAuth, decodeLicenseMe, licenseCache, } from "./license-api.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.experience';
/** Credential reference holding the activation response's access token. */
const TOKEN_REF = 'bobo_experience_access_token';
/** Credential reference holding the user's license key. */
const KEY_REF = 'bobo_experience_license_key';
/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'configForms'];
/** Version string sent as `client_version`; unset builds report unknown. */
function clientVersion() {
    return process.env.DSH_CLIENT_VERSION ?? 'unknown';
}
/** JSON body helper for the POST calls this plugin makes. */
function jsonBody(value) {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
    };
}
/**
 * Register the Experience Pool section once the `settings.section`
 * declaration is on the ledger, with every gateway call and store write
 * closed over this plugin's context.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-experience: copy dictionaries');
    const describeFace = ctx.configForms.describe();
    const t = ctx.locale.bind(NS);
    // The activate answer's token lives here for the page session only: the
    // credentials domain has no read path, by design, so nothing can echo it.
    let sessionToken;
    const load = async () => { await describeFace.ensure(); };
    const currentSection = () => {
        const view = experienceView(describeFace.getSnapshot());
        if (view === undefined)
            return undefined;
        const settings = decodeExperience(view.value);
        if (settings === undefined)
            return undefined;
        return { settings, revision: view.revision };
    };
    const save = async (patch) => {
        // Read the revision at write time, not at draft time: the fence only has
        // to cover the window in which another writer could have moved the section.
        const view = experienceView(describeFace.getSnapshot());
        if (view === undefined)
            return { kind: 'absent' };
        const ops = experienceWriteOps(patch);
        if (ops.length === 0)
            return { kind: 'written' };
        try {
            const response = await ctx.remote.settings.mutate(EXPERIENCE_POOL_NAMESPACE, ops, view.revision);
            if (response.ok) {
                describeFace.acceptView(response.value);
                return { kind: 'written' };
            }
            return response.error.code === 'settings/conflict'
                ? { kind: 'conflict' }
                : { kind: 'refused', message: response.error.message };
        }
        catch (error) {
            return { kind: 'refused', message: error instanceof Error ? error.message : String(error) };
        }
    };
    /** Gateway URL every call in this session resolves from the mirror. */
    const currentBaseUrl = () => currentSection()?.settings.baseUrl ?? DEFAULT_GATEWAY_URL;
    /**
     * Reuse the stored device id, or mint and persist one first so two
     * activations never present as two devices.
     * @returns the device id, or undefined when it could not be persisted.
     */
    const ensureDeviceId = async () => {
        const stored = currentSection()?.settings.deviceId;
        if (stored !== undefined && stored !== '')
            return stored;
        const deviceId = randomUUID();
        const outcome = await save({ deviceId });
        return outcome.kind === 'written' ? deviceId : undefined;
    };
    /**
     * Store one secret in the credentials domain.
     * @param ref - credential reference name.
     * @param value - the secret; it crosses the wire in this direction only.
     * @returns null on success, otherwise the host's refusal message.
     */
    const storeCredential = async (ref, value) => {
        try {
            const response = await ctx.remote.credentials.set(ref, value);
            return response.ok ? null : response.error.message;
        }
        catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    };
    /**
     * Adopt a successful auth response: hold the token for this session, cache
     * the non-sensitive status in settings, and persist token (and key when the
     * caller has one) in credentials.
     * @param auth - the decoded activate / migrate-complete body.
     * @param key - the license key to persist, or null when there is none.
     * @returns the ok outcome carrying the license and both stores' answers.
     */
    const adoptAuth = async (auth, key) => {
        sessionToken = auth.accessToken;
        const license = licenseCache(auth.license, auth.serverTime);
        const settingsStorage = await save({ license });
        const tokenStorage = await storeCredential(TOKEN_REF, auth.accessToken);
        const keyStorage = key === null ? null : await storeCredential(KEY_REF, key);
        return {
            kind: 'ok',
            license,
            settingsStorage,
            credentialsStorage: tokenStorage ?? keyStorage,
        };
    };
    /** Fold one gateway result into the auth outcome shape. */
    const authFromGateway = async (result, decode, key) => {
        if (!result.ok)
            return { kind: 'gateway', failure: result.failure };
        const auth = decode(result.body);
        if (auth === undefined)
            return { kind: 'gateway', failure: { kind: 'malformed' } };
        return adoptAuth(auth, key);
    };
    const activate = async (key) => {
        const deviceId = await ensureDeviceId();
        if (deviceId === undefined)
            return { kind: 'device' };
        const result = await callGateway(currentBaseUrl(), '/v1/license/activate', jsonBody({ key, device_id: deviceId, client_version: clientVersion() }));
        return authFromGateway(result, decodeLicenseAuth, key);
    };
    const refresh = async () => {
        if (sessionToken === undefined)
            return { kind: 'no-token' };
        const result = await callGateway(currentBaseUrl(), '/v1/license/me', {
            method: 'GET',
            headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!result.ok)
            return { kind: 'gateway', failure: result.failure };
        const me = decodeLicenseMe(result.body);
        if (me === undefined)
            return { kind: 'gateway', failure: { kind: 'malformed' } };
        const license = licenseCache(me.license, me.serverTime);
        const settingsStorage = await save({ license });
        return { kind: 'ok', license, settingsStorage, credentialsStorage: null };
    };
    const migrateRequest = async (email, recoveryCode) => {
        const result = await callGateway(currentBaseUrl(), '/v1/license/migrate/request', jsonBody({ email, recovery_code: recoveryCode }));
        return result.ok ? { kind: 'ok' } : { kind: 'gateway', failure: result.failure };
    };
    const migrateComplete = async (email, recoveryCode, code) => {
        const deviceId = await ensureDeviceId();
        if (deviceId === undefined)
            return { kind: 'device' };
        const result = await callGateway(currentBaseUrl(), '/v1/license/migrate/complete', jsonBody({ email, recovery_code: recoveryCode, code, device_id: deviceId }));
        return authFromGateway(result, decodeLicenseAuth, null);
    };
    const health = async () => {
        const result = await callGateway(currentBaseUrl(), '/v1/health', { method: 'GET' });
        if (!result.ok) {
            // A non-2xx HTTP answer still proves the gateway answered.
            if (result.failure.kind === 'http') {
                return {
                    gateway: 'up',
                    qdrant: 'unknown',
                    ...result.failure.description === undefined ? {} : { detail: result.failure.description },
                };
            }
            return { gateway: 'down', qdrant: 'unknown' };
        }
        const report = decodeHealth(result.body);
        if (report === undefined)
            return { gateway: 'up', qdrant: 'unknown' };
        return { gateway: 'up', qdrant: report.qdrantReachable ? 'up' : 'down' };
    };
    const credentialsState = async () => {
        try {
            const response = await ctx.remote.credentials.describe([KEY_REF, TOKEN_REF]);
            if (!response.ok)
                return null;
            return {
                key: response.value[KEY_REF]?.configured ?? false,
                token: response.value[TOKEN_REF]?.configured ?? false,
            };
        }
        catch {
            // A refused read only hides the hint line; the section still works.
            return null;
        }
    };
    const injected = () => ({
        load,
        save,
        activate,
        refresh,
        migrateRequest,
        migrateComplete,
        health,
        credentialsState,
        hooks: { settings: describeFace },
    });
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'experience-pool',
        order: 68,
        label: () => t('nav'),
        locale: NS,
        inject: injected,
    }, ExperienceSection));
}
//# sourceMappingURL=index.js.map