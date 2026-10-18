import { PLUGIN_ID } from '../../shared/constants'
import { capture } from '../service/capture'

/**
 * `agent/pre-step`：登记 before 快照，**不做屏障**。
 *
 * 真正的执行屏障在 `tools/pre-execute`（见 `events/tools-pre-execute.ts`）：快照只需
 * 早于文件改动，而文件改动只发生在工具派发时。把等待留在这里会让「prompt 已受理 →
 * user 节点落盘」之间多出一整个快照的时间，客户端表现为自己刚发出的消息迟迟不出现。
 *
 * 任何异常都吞掉后继续 `next()`——快照失败绝不能拦住用户的 turn。
 */
export function handlePreStep(payload: any, next: () => Promise<any>): Promise<any> {
  try {
    const sessionId = payload?.agent?.session?.id
    if (payload?.step === 1 && typeof sessionId === 'string' && typeof payload?.turn === 'number')
      capture.start(sessionId, payload.turn)
  }
  catch (error) {
    console.warn(`${PLUGIN_ID}: before snapshot scheduling failed: ${String(error)}`)
  }
  return next()
}
