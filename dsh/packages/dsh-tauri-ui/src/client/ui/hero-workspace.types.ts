import type { SelectorHook } from '../types/selector'

export interface WorkspaceItemLike {
  workspaceId: string
  title: string
}

export interface WorkspaceListStateLike {
  items: readonly WorkspaceItemLike[]
  phase: string
}

export interface SessionListStateLike {
  current?: string
}

/** 槽位 owner 份额：官方 `ConversationRoot` 渲染 `conversation.hero.workspace` 时派发。 */
export interface HeroWorkspaceOwnerProps {
  open: boolean
  selectedId?: string
  onPick: (workspaceId: string) => void
  onClose: () => void
}

/** 本插件 `inject` 工厂补充的份额（官方同名能力，落点见 `register/hero-workspace.ts`）。 */
export interface HeroWorkspaceInjectedProps {
  useWorkspaces: SelectorHook<WorkspaceListStateLike>
  useSessions?: SelectorHook<SessionListStateLike>
  useDirectoryFlow?: SelectorHook<boolean>
  createWorkspace?: (input: { path: string }) => Promise<{ workspaceId: string }>
  startUngrouped: () => void
}

export type HeroWorkspaceProps = HeroWorkspaceOwnerProps & HeroWorkspaceInjectedProps
