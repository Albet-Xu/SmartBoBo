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
import { defineTool } from '@deepseek-ai/dsh-tools';
import { deriveBrowserPort, probeBrowserService, sendCommand } from "./browser-server.js";
import { resolveDeployment } from "./deployment.js";
import { clearPendingHandoff, setPendingHandoff } from "./handoff-state.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser-handoff';
/** Services required: the tool registry, and the question seam that reaches the user. */
export const inject = ['tools', 'userQuestions'];
/** Model-visible tool name. */
export const BROWSER_HANDOFF_TOOL = 'browser_handoff';
/** Stable id of the question this tool asks; the answer echoes it back. */
export const HANDOFF_QUESTION_ID = 'browser-handoff';
/** Budget for one browser-service command that answers from page state alone. */
const SERVICE_TIMEOUT_MS = 15_000;
/** Budget for the navigation that puts a page in front of the user. */
const NAVIGATE_TIMEOUT_MS = 120_000;
/** Wait after that navigation, before the page is read back; the human owns what follows. */
const NAVIGATE_SETTLE_MS = 1_500;
/** Heading the user sees above the question. */
const QUESTION_HEADER = '需要你手动完成';
/** Option label for "the wall is behind us, carry on". */
const ANSWER_DONE = '我已完成，继续';
/** Option label for "drop this site". */
const ANSWER_SKIP = '跳过这个站点';
/** Option label for "try again through another proxy". */
const ANSWER_PROXY = '换个代理再试';
/** What each option means, in the user's own terms. */
const OPTIONS = [
    { label: ANSWER_DONE, description: '这一关过了，我继续采集。' },
    { label: ANSWER_SKIP, description: '这个站点不采了，去做任务的其它部分。' },
    { label: ANSWER_PROXY, description: '换一个出口代理，再试同一页。' },
];
/** A JSON object, or null for an array, a scalar, or a parse failure. */
function asObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
/** A reply field read as text; anything but a string is the empty string. */
function textOf(value) {
    return typeof value === 'string' ? value : '';
}
/** One failure's reason, from an error of any shape. */
function detailOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Read the session page's address and title.
 * @param port - the browser service's loopback port.
 * @returns the page facts, or null when the service did not answer with one.
 */
async function readPage(port) {
    const reply = asObject(await sendCommand(port, { op: 'panel_state' }, SERVICE_TIMEOUT_MS));
    if (reply === null || reply.ok !== true)
        return null;
    return { hasPage: reply.has_page === true, url: textOf(reply.url), title: textOf(reply.title) };
}
/**
 * The refusal a service reply carries, if it carries one.
 * @param reply - a parsed service reply, or the null answer.
 * @returns the reason to report, or null when the reply reports success.
 */
function errorOf(reply) {
    if (reply === null)
        return '浏览器服务无应答';
    const object = asObject(reply);
    if (object === null)
        return '浏览器服务返回了无法解析的应答';
    if (object.ok === true)
        return null;
    return textOf(object.error) === '' ? '浏览器服务拒绝了这次导航' : textOf(object.error);
}
/** Map the user's answer onto the outcome the model reads. */
function outcomeOf(answer) {
    if (answer === ANSWER_DONE)
        return 'done';
    if (answer === ANSWER_SKIP)
        return 'skip';
    if (answer === ANSWER_PROXY)
        return 'proxy';
    return 'unknown';
}
/**
 * The user-facing question: where the wall is, what to do about it, and why the
 * panel is the place to do it.
 * @param facts - the page the shared browser is showing.
 * @param reason - what the page still needs from the human, from the caller.
 * @param note - extra instruction from the caller, empty when none.
 * @returns the question text.
 */
function questionText(facts, reason, note) {
    const where = facts.title === '' ? facts.url : `${facts.title}（${facts.url}）`;
    const needed = reason === '' ? '完成页面上的验证码 / 滑块 / 登录' : `完成${reason}`;
    return [
        `我卡在一个需要你手动完成的环节，已经把它放到你面前：${where}`,
        `需要你做的：${needed}。`,
        '怎么操作：打开右栏的「内置浏览器」面板（我已经把它推到你的界面上），面板里显示的就是我停住的这一页——'
            + '在画面里直接用鼠标和键盘完成即可，然后回到这里选「我已完成，继续」。',
        '为什么这样有效：面板和我操作的是同一个浏览器、同一份登录态，你过一次，我后面的采集就带着它。',
        note === '' ? '' : `补充：${note}`,
    ].filter(line => line !== '').join('\n');
}
/**
 * The text the model reads back: the choice, what it obliges, and the one thing
 * the answer must not be taken as.
 * @param value - this call's canonical result.
 * @returns the rendered text.
 */
function renderHandoff(value) {
    if (value.error !== undefined && value.error !== '')
        return `未能请到用户手动接管：${value.error}`;
    const where = value.title === '' ? value.url : `${value.title}（${value.url}）`;
    const head = `用户的选择：${value.answer}（${where}）`;
    if (value.outcome === 'skip') {
        return `${head}\n用户选择跳过这一页：不要再尝试它，继续任务的其它部分，并在最终交付里说明跳过了什么、为什么。`;
    }
    if (value.outcome === 'proxy') {
        return `${head}\n用户选择换代理：按代理池的既有约定换一个出口代理，再用同一个调用重试这一页。`;
    }
    if (value.outcome === 'unknown') {
        return `${head}\n这个回答不在预期选项里：把原文交给用户确认下一步，不要自行推断。`;
    }
    return `${head}\n下一步：先重试刚才失败的那一步（同一个 crawl_fetch / debug_navigate 调用）再判断——`
        + '用户说完成了不等于真的通过了，以页面实际返回为准；仍被拦可以再交接一次，但不要把同一页反复交给用户。';
}
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
export function apply(ctx) {
    const deployment = resolveDeployment({});
    ctx.tools.register(defineTool({
        name: BROWSER_HANDOFF_TOOL,
        description: 'Hand one page to the human. Surface the built-in browser panel — the right Sidebar mirror of the '
            + 'shared Camoufox session this agent works in — on the page the agent is stuck on, ask the user to '
            + 'finish a captcha, a slider, or a login there by hand, and wait for their answer. The panel and '
            + 'every later capture share one browser and one login state, so a wall the user clears once stays '
            + 'cleared. Returns the choice the user made and the page it was about.',
        parameters: {
            url: {
                type: 'string',
                description: 'Optional URL to navigate the shared browser to before handing off. '
                    + 'Omit it to hand off the page the browser already shows, which keeps a loaded captcha or a half-filled form intact.',
            },
            reason: {
                type: 'string',
                description: 'What the page still needs from the human, such as "验证码", "滑块", or "登录". Shown to the user as the thing to finish.',
            },
            note: {
                type: 'string',
                description: 'Optional extra instruction appended to the question, for example which account to sign in with.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    outcome: { type: 'string', required: true, description: 'One of done / skip / proxy / unknown.' },
                    answer: { type: 'string', required: true, description: 'The option the user picked, verbatim.' },
                    url: { type: 'string', required: true, description: 'Address of the page the user was handed.' },
                    title: { type: 'string', required: true, description: 'Title of that page, empty when it reports none.' },
                    error: { type: 'string', description: 'Why the handoff could not be asked for; absent on success.' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderHandoff(value) }],
        },
        async execute(args, exec) {
            const wantUrl = typeof args.url === 'string' ? args.url.trim() : '';
            const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
            const note = typeof args.note === 'string' ? args.note.trim() : '';
            const failed = (error) => ({ outcome: 'unknown', answer: '', url: '', title: '', error });
            if (deployment.root === undefined) {
                return failed('这个部署不在 BoBo 项目里，推导不出浏览器服务端口');
            }
            const port = deriveBrowserPort(deployment.root);
            // Never launch the service here: a handoff is for a page the agent is
            // already stuck on, and starting a browser would hand the user a blank one.
            if (!await probeBrowserService(port)) {
                return failed('浏览器服务未运行：先用 crawl_fetch 或 debug_navigate 打开目标页，再交接给用户');
            }
            let facts = await readPage(port);
            if (facts === null)
                return failed('浏览器服务无应答');
            if (wantUrl !== '') {
                const navigation = await sendCommand(port, { op: 'debug_navigate', url: wantUrl, wait_ms: NAVIGATE_SETTLE_MS }, NAVIGATE_TIMEOUT_MS);
                const refusal = errorOf(navigation);
                if (refusal !== null)
                    return failed(`打开待人工处理的页面失败：${refusal}`);
                facts = await readPage(port);
                if (facts === null)
                    return failed('浏览器服务无应答');
            }
            if (!facts.hasPage) {
                return failed('共享浏览器里没有页面：先用 crawl_fetch 或 debug_navigate 打开目标页，再交接给用户');
            }
            setPendingHandoff({ url: facts.url, title: facts.title, reason, note, at: Date.now() });
            let answer = '';
            try {
                const result = await ctx.userQuestions.ask({
                    questions: [{
                            id: HANDOFF_QUESTION_ID,
                            header: QUESTION_HEADER,
                            question: questionText(facts, reason, note),
                            options: OPTIONS,
                        }],
                    ...exec.agent !== undefined ? { agent: exec.agent } : {},
                    signal: exec.signal,
                });
                const first = result.answers[0];
                answer = first === undefined ? '' : first.selected[0] ?? first.custom ?? '';
            }
            catch (error) {
                return { ...failed(`请用户手动完成这一步失败：${detailOf(error)}`), url: facts.url, title: facts.title };
            }
            finally {
                // An entry left behind keeps pulling the panel in front of the user on
                // every poll, so every way out of the question drops it.
                clearPendingHandoff();
            }
            return { outcome: outcomeOf(answer), answer, url: facts.url, title: facts.title };
        },
    }));
}
//# sourceMappingURL=handoff.js.map