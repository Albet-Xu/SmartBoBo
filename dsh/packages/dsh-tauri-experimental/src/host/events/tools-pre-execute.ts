import { PLUGIN_ID } from '../../shared/constants'
import { capture } from '../service/capture'

/**
 * `tools/pre-execute`：before 快照真正的执行屏障。
 *
 * 快照必须早于一切文件改动，而唯一会改文件的是工具派发——等待点放在这里与原先放在
 * `agent/pre-step` 语义等价（该钩子被 `dsh-tools` 在派发前 await），但这段等待与模型
 * 请求并行，用户看不到。常见情况下快照早已落地，这里是零等待。
 *
 * 任何异常都吞掉后继续 `next()`——快照失败绝不能拦住工具执行。
 */
export async function handlePreExecute(exec: any, next: () => Promise<any>): Promise<any> {
  try {
    const sessionId = exec?.agent?.session?.id
    if (typeof sessionId === 'string')
      await capture.awaitBegin(sessionId)
  }
  catch (error) {
    console.warn(`${PLUGIN_ID}: before snapshot barrier failed: ${String(error)}`)
  }
  return next()
}
