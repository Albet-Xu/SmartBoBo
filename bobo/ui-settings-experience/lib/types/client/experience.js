/**
 * Experience pool contract for the settings page: the pure folds that turn
 * one settings mirror snapshot into the page's state, the path operations one
 * settings write applies, and the outcome vocabulary the inject face answers
 * with. No fetch, no ctx — components and the apply closure share these.
 *
 * @module bobo-settings-experience-ui/experience
 */
import { DEFAULT_GATEWAY_URL, EXPERIENCE_POOL_NAMESPACE, } from "../experience-pool.js";
/** Plain-object view of a wire value, or undefined for anything else. */
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/** A wire string, or undefined for a missing or mistyped field. */
function text(value) {
    return typeof value === 'string' ? value : undefined;
}
/** Narrow one wire cache record, or undefined when any stamp is missing. */
function decodeCache(value) {
    const record = asRecord(value);
    if (record === undefined)
        return undefined;
    const planCode = text(record.planCode);
    const status = text(record.status);
    const licenseStart = text(record.licenseStart);
    const expiresAt = text(record.expiresAt);
    const serverTime = text(record.serverTime);
    if (planCode === undefined || status === undefined || licenseStart === undefined
        || expiresAt === undefined || serverTime === undefined) {
        return undefined;
    }
    return { planCode, status, licenseStart, expiresAt, serverTime };
}
/**
 * Narrow one redacted settings section to the section the page edits. The
 * section arrives from the wire, so every field falls back to the value the
 * host schema defaults it to when the section omits or mistypes it; a
 * malformed cache drops to absent rather than failing the page.
 * @param section - the `experience-pool` namespace's resolved value.
 * @returns the settings, or undefined when the section is not an object at all.
 */
export function decodeExperience(section) {
    const row = asRecord(section);
    if (row === undefined)
        return undefined;
    const baseUrl = text(row.baseUrl);
    const deviceId = text(row.deviceId);
    const license = decodeCache(row.license);
    return {
        baseUrl: baseUrl === undefined || baseUrl === '' ? DEFAULT_GATEWAY_URL : baseUrl,
        deviceId: deviceId ?? '',
        ...license === undefined ? {} : { license },
    };
}
/**
 * The `experience-pool` namespace view inside one settings mirror snapshot.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the namespace view, or undefined while unanswered or unregistered.
 */
export function experienceView(mirror) {
    return mirror.view?.namespaces.find(row => row.ns === EXPERIENCE_POOL_NAMESPACE);
}
/**
 * Fold one settings mirror snapshot into the page's state.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the state the section renders.
 */
export function experiencePageState(mirror) {
    if (mirror.status === 'unavailable')
        return { status: 'unavailable' };
    if (mirror.view === undefined) {
        return mirror.error === null
            ? { status: 'loading' }
            : { status: 'failed', reason: 'read', detail: mirror.error };
    }
    const view = experienceView(mirror);
    if (view === undefined)
        return { status: 'absent' };
    const settings = decodeExperience(view.value);
    if (settings === undefined)
        return { status: 'failed', reason: 'section', detail: null };
    return {
        status: 'ready',
        settings,
        revision: view.revision,
        writable: mirror.view.writable,
        staleError: mirror.error,
    };
}
/**
 * Path operations carrying one partial edit into the namespace. Only the
 * provided fields are written, so a field the page does not touch keeps its
 * stored value.
 * @param patch - the fields this write sets.
 * @returns the operations one settings write applies.
 */
export function experienceWriteOps(patch) {
    const ops = [];
    if (patch.baseUrl !== undefined)
        ops.push({ op: 'set', path: ['baseUrl'], value: patch.baseUrl });
    if (patch.deviceId !== undefined)
        ops.push({ op: 'set', path: ['deviceId'], value: patch.deviceId });
    if (patch.license !== undefined) {
        ops.push({ op: 'set', path: ['license'], value: patch.license });
    }
    return ops;
}
//# sourceMappingURL=experience.js.map