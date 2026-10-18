import z from "@deepseek-ai/schemastery";
//#region lib/types/experience-pool.js
/** Gateway base URL a fresh section starts from; the page can edit it for testing. */
const DEFAULT_GATEWAY_URL = "https://www.smartbobo.cn";
//#endregion
//#region lib/types/index.js
/**
* Host loader entry for the experience pool settings page: the entry's
* volatile Config fields ARE the `experience-pool` section the browser half
* reads and writes through the settings forms over this entry id, so the
* gateway URL, device id, and cached license status persist in the active
* profile's Cordis patch. The page's license calls themselves go straight
* from the browser to the authorization gateway; no Host Remote is added.
*
* @module bobo-settings-experience-ui
*/
/** Schema for the cached license facts; secrets never enter this section. */
const LicenseCacheSchema = z.object({
	planCode: z.string(),
	status: z.string(),
	licenseStart: z.string(),
	expiresAt: z.string(),
	serverTime: z.string()
});
/**
* This plugin's cordis.yml config: the `experience-pool` section. Every field
* is `.volatile()` so it appears in this entry's settings form; the browser
* half's writes land here through the settings wire.
*/
const Config = z.object({
	baseUrl: z.string().default(DEFAULT_GATEWAY_URL).volatile(),
	deviceId: z.string().default("").volatile(),
	license: LicenseCacheSchema.required(false).volatile()
});
/**
* Tell Settings this entry ships its own page, so no auto-generated form
* appears beside it. Optional: the plugin runs without a Settings service.
* @param ctx - Host context whose optional settings service owns the form policy.
*/
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
	});
}
//#endregion
export { Config, apply };
