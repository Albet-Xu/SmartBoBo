/**
 * Model-facing `browser_handoff`: stop on the wall the agent cannot pass, put
 * that page in front of the user, and wait for what they did with it.
 *
 * A captcha, a slider, a login wall is work only a human can do, and it has to
 * happen inside the browser that holds the session — the deployment's
 * long-lived Camoufox instance. That browser already mirrors itself into the
 * right Sidebar's built-in browser panel, so this handoff needs no new surface:
 * it needs the user looking at the panel, and a way for the agent to learn that
 * the human is done.
 *
 * Three steps, in this order, because each depends on the one before it:
 *
 * 1. the page the agent stopped on is already the session page; an explicit
 *    `url` is navigated to only when the caller names one, so a captcha the
 *    agent already loaded keeps its half-filled state;
 * 2. the handoff is registered in `handoff-state.ts` **before** the question, so
 *    the panel's poll can put the mirror in front of the user;
 * 3. the question carries the whole vocabulary of answers — done / skip / switch
 *    proxy — and the registration is dropped on every way out.
 *
 * What the answer is worth: the user's word is not evidence that the wall is
 * gone. This tool reports the choice and says so; judging the retry is the
 * caller's job.
 * @module bobo-crawl-tool/handoff
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-browser-handoff";
/** Services required: the tool registry, and the question seam that reaches the user. */
export declare const inject: string[];
/** Model-visible tool name. */
export declare const BROWSER_HANDOFF_TOOL = "browser_handoff";
/** Stable id of the question this tool asks; the answer echoes it back. */
export declare const HANDOFF_QUESTION_ID = "browser-handoff";
/** Outcome of one handoff, as it reaches the model. */
export type HandoffOutcome = 'done' | 'skip' | 'proxy' | 'unknown';
/**
 * Register `browser_handoff`.
 *
 * The tool answers from state the deployment already has, so the registration
 * needs no service of its own: the port is derived from the deployment root and
 * the page is read from the browser service a capture or a debug session owns.
 *
 * @param ctx - context whose `tools` registry receives the tool and whose
 *   `userQuestions` seam reaches the human; both leave with this plugin instance.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=handoff.d.ts.map