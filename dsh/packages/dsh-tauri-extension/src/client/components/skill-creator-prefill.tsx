import { useStore } from 'dsh-tauri/client'
import { useEffect } from 'react'
import { SKILL_CREATOR_DRAFT } from '../constants'
import { store } from '../store'

export interface InputActions {
  setDraft: (text: string) => void
}

export interface ConversationInputLeftProps {
  sessionId: string
  inputActions: InputActions
}

/**
 * 新建技能会话后把草稿填进输入框。
 *
 * 必须订阅 store 而不能在挂载时读一次：会话复用已打开的空白会话时 `sessionId` 与
 * `inputActions` 都不变，只依赖这两个值的话 effect 永不重跑，晚到的登记会滞留
 * （表现为「有时候不出现」）。订阅范式与 `dsh-tauri-scheduler` 的 `PrefillBridge` 一致。
 */
export function SkillCreatorPrefill({ sessionId, inputActions }: ConversationInputLeftProps): null {
  const { pendingSessionIds } = useStore(store.prefill)
  const pending = pendingSessionIds.includes(sessionId)
  useEffect(() => {
    if (!store.prefill.consume(sessionId))
      return
    inputActions.setDraft(SKILL_CREATOR_DRAFT)
  }, [pending, inputActions, sessionId])
  return null
}
