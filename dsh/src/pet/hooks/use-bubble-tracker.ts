import type { Motion, PetBubbleHandle, PetRef } from 'dsh-pet-component'
import type { BubbleSession } from './use-bubble-tracker.helpers'
import type { PetSource } from './use-pet-source'
import { useUnmount, useWatch } from '@reause/core'
import { useRef } from 'react'
import { useListen } from '@/hooks/use-listen'
import {
  DONE_BUBBLE_TIMEOUT,
  pickLang,
  TERMINAL_MOTIONS,
} from './use-bubble-tracker.constants'
import {
  bubbleContent,

  rawSession,
  sessionMotion,
  sessionTitle,
} from './use-bubble-tracker.helpers'

type SessionAction = 'create' | 'remove' | 'update'

export interface BubbleTracker {
  apply: (payload: unknown, action: SessionAction) => void
  flush: () => void
  clear: () => void
  dispose: () => void
}

/** 订阅会话事件驱动桌宠气泡的 React Hook */
export function useBubbleTracker(pet: PetRef, source?: PetSource | null) {
  const trackerRef = useRef<BubbleTracker | null>(null)
  trackerRef.current ??= createBubbleTracker(pet.bubble)
  const tracker = trackerRef.current

  useWatch(source !== null, (ready) => {
    if (ready)
      tracker.flush()
  }, { immediate: true })

  useListen('session:create', event => tracker.apply(event.payload, 'create'))
  useListen('session:update', event => tracker.apply(event.payload, 'update'))
  useListen('session:remove', event => tracker.apply(event.payload, 'remove'))
  // 宿主累计态归零后（应用重启、宿主热重载）不会再补发 remove：残留气泡只能靠这一帧整批作废。
  useListen('session:clear', () => tracker.clear())
  useUnmount(() => tracker.dispose())
}

/** 创建会话气泡桥状态机 */
export function createBubbleTracker(bubble: PetBubbleHandle): BubbleTracker {
  const sessions = new Map<string, BubbleSession>()
  const previousMotion = new Map<string, Motion | undefined>()
  const terminalShown = new Set<string>()

  const forget = (id: string) => {
    sessions.delete(id)
    previousMotion.delete(id)
    terminalShown.delete(id)
  }

  const reset = () => {
    sessions.clear()
    previousMotion.clear()
    terminalShown.clear()
    bubble.clear()
  }

  const sync = (session: BubbleSession) => {
    const { id } = session
    const motion = sessionMotion(session)
    const previous = previousMotion.get(id)

    if (motion === undefined) {
      forget(id)
      bubble.close(id)
      if (previous === 'running') {
        bubble({
          id: `${id}:done`,
          title: sessionTitle(session).trim(),
          description: pickLang('已完成', 'Done'),
          variant: 'success',
          timeout: DONE_BUBBLE_TIMEOUT,
        })
      }
      return
    }

    if (TERMINAL_MOTIONS.has(motion)) {
      if (terminalShown.has(id))
        return
    }
    else {
      terminalShown.delete(id)
    }

    previousMotion.set(id, motion)
    const content = bubbleContent(session, motion)
    const key = bubble({
      id,
      title: content.title,
      description: content.description,
      loading: content.loading,
      motion,
    })

    if (key !== '' && TERMINAL_MOTIONS.has(motion)) {
      terminalShown.add(id)
    }
  }

  return {
    apply(payload, action) {
      const session = rawSession(payload)
      if (!session)
        return

      const { id } = session
      if (action === 'remove' || session.origin === 'subagent') {
        if (action === 'remove' || sessions.has(id)) {
          forget(id)
          bubble.close(id)
        }
        return
      }

      sessions.set(id, session)
      sync(session)
    },

    flush() {
      for (const session of [...sessions.values()]) sync(session)
    },

    clear() {
      reset()
    },

    dispose() {
      reset()
    },
  }
}
