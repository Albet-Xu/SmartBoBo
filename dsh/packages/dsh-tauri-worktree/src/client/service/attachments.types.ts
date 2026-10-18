export interface DraftUploadState {
  status?: 'uploading' | 'ready' | 'error'
}

/** 运行期附件草稿描述符：`file` 是浏览器持有的本体（附件对象会随会话作用域物化/销毁而失效）。 */
export interface DraftAttachmentDescriptor {
  id: string
  kind?: 'image' | 'file'
  file?: File
}

/**
 * 会话服务上附件迁移所需的最小面（`ctx.get('conversation')`）。
 *
 * 草稿正文按会话持久化，附件却只是运行期对象：会话作用域一旦重新物化（建工作树那几秒里就会发生），
 * 正文还在、附件已被释放。因此迁移必须在拦截时抓住本体，再在目标会话里重建草稿——重建出来的凭证
 * 天然归属目标会话，文件上传也不会再落在源会话上。
 */
export interface ConversationAttachments {
  resolveDraftAttachments?: (ids: readonly string[]) => readonly DraftAttachmentDescriptor[]
  createDrafts?: (sessionId: string, files: readonly File[]) => readonly { id: string }[]
  releaseDraftAttachments?: (attachments: readonly { id: string }[]) => void
  fileUploads?: { getSnapshot: () => Record<string, DraftUploadState | undefined> }
}

export interface DraftUploadWaitInput {
  conversation?: ConversationAttachments
  ids: readonly string[]
  wait: (ms: number) => Promise<void>
  attempts?: number
  delayMs?: number
}
