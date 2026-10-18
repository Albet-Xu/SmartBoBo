/**
 * Human-facing `/skill-model` command: hands a complex task to the model and
 * asks it to run the skill-market retrieval flow before doing the work.
 *
 * The handler validates the task text and wakes the model with the task
 * wrapped in `<skill-model-task>` tags. The task is recorded by the generic
 * `command/run` event (`recordInput` stays at its default), so this package
 * writes **no event type of its own**: the persistence read path refuses a
 * whole session log containing an event type the running harness does not
 * know (see the `ignorable` envelope contract), and an out-of-repo plugin
 * cannot mark its own type ignorable through `Session.append`. The market
 * tools the flow uses (`market_search` / `market_detail` / `market_file` /
 * `market_install`) ship in the sibling `tool-market` package; this package
 * only triggers the flow.
 *
 * @module bobo-skill-model-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name. */
export const name = 'command-skill-model'

/** Services required before the command is contributed. */
export const inject = ['commands']

/** What an empty invocation reads back instead of reaching the model. */
const USAGE = '用法：/skill-model <任务描述>'

/** Code points of the task the success card shows before truncating it. */
const SUMMARY_LIMIT = 80

/**
 * Render the task for the success card, cut to {@link SUMMARY_LIMIT} code points.
 * @param task - the trimmed task text.
 * @returns the task unchanged, or its first {@link SUMMARY_LIMIT} code points plus an ellipsis.
 */
function summarize(task: string): string {
  const points = Array.from(task)
  return points.length <= SUMMARY_LIMIT ? task : `${points.slice(0, SUMMARY_LIMIT).join('')}…`
}

/**
 * Register `/skill-model` for every composed human-command adapter. The
 * registration rides `ctx.effect`, so fiber teardown unregisters the command.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'skill-model',
      description: '给出复杂任务，自动检索技能市场寻找可借鉴技能并完成任务',
      input: { hint: '[任务描述]' },
      handler: (invocation: CommandInvocation): CommandResult => {
        const task = invocation.rawInput.trim()
        if (task === '') return { kind: 'success', text: USAGE }

        // 任务原文由通用 `command/run` 事件记录（recordInput 默认 true），
        // 这里只负责唤醒模型——不再写自定义事件类型，避免整个会话日志
        // 因为"未知事件"被读取侧拒绝。
        invocation.agent.followup(createUserMessage({
          content: [{
            type: 'text',
            text: `用户通过 /skill-model 命令提交了任务：

<skill-model-task>
${task}
</skill-model-task>

请先按系统提示中「技能市场检索」一节的流程，去技能市场寻找可借鉴的技能，再完成该任务。`,
          }],
          source: { kind: 'user' },
        }))

        return { kind: 'success', text: `已接收任务「${summarize(task)}」，正在检索技能市场…` }
      },
    })
  }, 'command-skill-model lifecycle')
}
