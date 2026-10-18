//#region src/handoff-state.ts
/** The pending handoff, or null while no tool call is waiting on the user. */
let pending = null;
/**
* Register the handoff the calling tool is about to ask the user about. Called
* before the question, because the panel's poll is what opens the mirror.
* @param payload - the page, reason, note, and registration time.
*/
function setPendingHandoff(payload) {
	pending = payload;
}
/**
* Drop the pending handoff. An entry left behind keeps pulling the panel in
* front of the user, so every path out of the question clears it.
*/
function clearPendingHandoff() {
	pending = null;
}
/**
* Read the pending handoff.
* @returns the pending handoff, or null when none is registered.
*/
function readPendingHandoff() {
	return pending;
}

//#endregion
export { readPendingHandoff as n, setPendingHandoff as r, clearPendingHandoff as t };