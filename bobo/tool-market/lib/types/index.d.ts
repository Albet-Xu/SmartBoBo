/**
 * Model-facing skill-market plugin: registers the four `market_*` tools the
 * `/skill-model` flow uses to search, read, and install skills from the
 * ClawHub + SkillHub aggregate. The package deliberately ships no delete or
 * uninstall tool — installed skills surface in the user's skill library
 * settings page, where removal belongs to the user.
 * @module bobo-market-tool
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-market";
/** Services required before the tools can be registered. */
export declare const inject: string[];
/** Plugin config: the single switch that keeps this package mountable without advertising its tools. */
export interface Config {
    /**
     * Whether the four market tools register. Defaults to true; `false` registers
     * nothing and never builds a market — the same off switch `repo.mjs`'s
     * `thirdParty` gives the host-side market endpoints.
     */
    enabled?: boolean;
}
/** Config after schemastery has filled the defaulted field. */
export declare const Config: z<Config>;
/**
 * Register the four market tools over one aggregate market instance.
 *
 * The market is built here (construction touches no network), and the four
 * registrations ride one effect so disposing this plugin instance removes all
 * of them together.
 *
 * @param ctx - context whose `tools` registry receives the definitions; the
 *   registrations leave with this plugin instance.
 * @param config - {@link Config}; `enabled: false` registers nothing.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map