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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type ExperienceLicenseCache } from './experience-pool.ts';
/**
 * This plugin's cordis.yml config: the `experience-pool` section. Every field
 * is `.volatile()` so it appears in this entry's settings form; the browser
 * half's writes land here through the settings wire.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    baseUrl: z<string, string, "volatile-defined">;
    deviceId: z<string, string, "volatile-defined">;
    license: z<NoInfer<ExperienceLicenseCache>, NoInfer<ExperienceLicenseCache>, "volatile">;
}>>, Schemastery.ObjectT<NoInfer<{
    baseUrl: z<string, string, "volatile-defined">;
    deviceId: z<string, string, "volatile-defined">;
    license: z<NoInfer<ExperienceLicenseCache>, NoInfer<ExperienceLicenseCache>, "volatile">;
}>>, "plain">;
/**
 * Tell Settings this entry ships its own page, so no auto-generated form
 * appears beside it. Optional: the plugin runs without a Settings service.
 * @param ctx - Host context whose optional settings service owns the form policy.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map