/**
 * Human-facing `/skill-model` command: hands a complex task to the model and
 * asks it to run the skill-market retrieval flow before doing the work.
 *
 * The handler validates the task text and wakes the model with the task
 * wrapped in `<skill-model-task>` tags. The task itself is recorded by the
 * generic `command/run` event (`recordInput` left at its default), so this
 * package writes no event type of its own. The market tools the flow uses
 * (`market_search` / `market_detail` / `market_file` / `market_install`)
 * ship in the sibling `tool-market` package; this package only triggers the
 * flow.
 *
 * @module bobo-skill-model-tool
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "command-skill-model";
/** Services required before the command is contributed. */
export declare const inject: string[];
/**
 * Register `/skill-model` for every composed human-command adapter. The
 * registration rides `ctx.effect`, so fiber teardown unregisters the command.
 * @param ctx - context carrying the command registry.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map