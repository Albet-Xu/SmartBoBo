import type { ClientContext } from 'dsh-tauri/client'
import type { ConversationAttachments, DraftAttachmentDescriptor, DraftUploadState, DraftUploadWaitInput } from './attachments.types'
import { ATTACHMENT_READY_DELAY_MS, ATTACHMENT_READY_MAX_ATTEMPTS } from '../constants'

/** 探测官方会在场的能力；inject-only 守卫下读服务名即抛错，读不到按不可用处理。 */
export function conversationAttachments(ctx: ClientContext): ConversationAttachments | undefined {
  try {
    const conversation = ctx.get('conversation') as ConversationAttachments | undefined
    return conversation ?? undefined
  }
  catch {
    return undefined
  }
}

/**
 * 拦截时抓住附件本体（必须在建工作树之前调用）。
 *
 * 会话作用域在创建窗口里会被重新物化：草稿正文有持久化兜底，附件对象没有，晚一步就只剩死 id。
 * 抓不到本体（核心不提供该面，或对象已被释放）时返回空数组，调用方回退为搬迁原 id。
 */
export function captureDraftAttachments(
  conversation: ConversationAttachments | undefined,
  ids: readonly string[],
): readonly DraftAttachmentDescriptor[] {
  if (conversation === undefined || ids.length === 0 || typeof conversation.resolveDraftAttachments !== 'function')
    return []
  try {
    return conversation.resolveDraftAttachments(ids).filter(value => value?.file !== undefined)
  }
  catch {
    return []
  }
}

/** 在目标会话重建附件草稿（新 id、新上传），返回新 id 与可回收的描述符；能力缺席或失败时返回空。 */
export function recreateDraftAttachments(
  conversation: ConversationAttachments | undefined,
  sessionId: string,
  captured: readonly DraftAttachmentDescriptor[],
): { ids: readonly string[], drafts: readonly { id: string }[] } {
  if (conversation === undefined || captured.length === 0 || typeof conversation.createDrafts !== 'function')
    return { ids: [], drafts: [] }
  try {
    const drafts = conversation.createDrafts(sessionId, captured.map(value => value.file as File))
    return { ids: drafts.map(draft => draft.id), drafts }
  }
  catch {
    return { ids: [], drafts: [] }
  }
}

/**
 * 合并两次抓取结果：新的在前，早先抓到但这次没解析出来的补在后面。
 *
 * 只保留仍在草稿里的 id——用户删掉的附件不该被迁走；而部分解析（对象已被释放）绝不能丢掉早先的本体，
 * 那正是这次唯一救得回来的东西。
 */
export function mergeCapturedAttachments(
  fresh: readonly DraftAttachmentDescriptor[],
  previous: readonly DraftAttachmentDescriptor[],
  ids: readonly string[],
): readonly DraftAttachmentDescriptor[] {
  const merged = fresh.filter(item => ids.includes(item.id))
  for (const item of previous) {
    if (ids.includes(item.id) && !merged.some(value => value.id === item.id))
      merged.push(item)
  }
  return merged
}

/** 回收浏览器持有的草稿附件（回滚或搬迁后不留悬挂预览/上传）。 */
export function releaseDraftAttachments(
  conversation: ConversationAttachments | undefined,
  attachments: readonly { id: string }[],
): void {
  if (conversation === undefined || attachments.length === 0 || typeof conversation.releaseDraftAttachments !== 'function')
    return
  try {
    conversation.releaseDraftAttachments(attachments)
  }
  catch {
    // 回收是尽力而为：失败不该改变迁移结果。
  }
}

/**
 * 等重建后的文件上传落地：凭证只在目标会话可用，抢在上传完成前提交会被拒。
 *
 * 快照里没有的附件（图片不上传，或核心不上报进度）按就绪处理；失败与超时抛出，交由调用方回滚。
 * 判定在每次等待之后也做一次：刚好在最后一次等待里落地的上传不该按超时回滚。
 */
export async function awaitDraftUploads(input: DraftUploadWaitInput): Promise<void> {
  const uploads = input.conversation?.fileUploads
  if (input.ids.length === 0 || typeof uploads?.getSnapshot !== 'function')
    return
  const attempts = input.attempts ?? ATTACHMENT_READY_MAX_ATTEMPTS
  const delayMs = input.delayMs ?? ATTACHMENT_READY_DELAY_MS
  for (let attempt = 0; ; attempt++) {
    const snapshot = uploads.getSnapshot() ?? {}
    const states = input.ids
      .map(id => snapshot[id])
      .filter((state): state is DraftUploadState => state !== undefined)
    if (states.some(state => state.status === 'error'))
      throw new Error('消息附件上传失败，请重新发送')
    if (!states.some(state => state.status === 'uploading'))
      return
    if (attempt >= attempts)
      throw new Error('等待消息附件上传超时，请重新发送')
    await input.wait(delayMs)
  }
}
