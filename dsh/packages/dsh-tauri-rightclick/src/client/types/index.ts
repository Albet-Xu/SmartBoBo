import type {
  ISessions,
  IWorkspaces,
  SessionId,
  SessionListState,
  SessionSummary,
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceView,
} from 'dsh-tauri/client'

export type { SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceSnapshot, WorkspaceView }

export type SessionSummaryLike = SessionSummary
/**
 * 会话列表快照的读取面：`current` 在 ≤0.1.6 由核心自带，0.1.7 起改由适配层投影补回，
 * 因此此处按可选成员声明（缺席即「无法判断当前会话」）。
 */
export type SessionListSnapshotLike = Pick<SessionListState, 'ids' | 'byId'> & { current?: SessionId }

/** 官方 sessions 服务加上右键菜单 fork 所需能力（`open` 在 0.1.7 移除，由适配层兼容桥补回）。 */
export type SessionsRuntimeLike = Omit<Pick<ISessions, 'list' | 'binding' | 'fork'>, 'list'> & {
  open?: (sessionId: SessionId) => unknown
  list: { getSnapshot: () => SessionListSnapshotLike }
}

export type WorkspaceViewLike = WorkspaceView
export type WorkspaceListSnapshotLike = Pick<WorkspaceSnapshot, 'items' | 'archivedSessionIds'> & {
  /** 0.1.7 起官方快照提供置顶集合；旧核心缺席即「无置顶」。 */
  pinnedSessionIds?: readonly SessionId[]
}

/** 官方 workspaces 服务加上 alpha/桌面导航兼容扩展。 */
export type WorkspacesRuntimeLike = Pick<IWorkspaces, 'list' | 'archiveSession' | 'delete'> & {
  startSession?: (workspaceId: WorkspaceId) => unknown
  /** 置顶/取消置顶会话：0.1.7 起官方提供；旧核心缺席时右键菜单不展示该入口。 */
  pinSession?: (sessionId: SessionId) => Promise<void>
  unpinSession?: (sessionId: SessionId) => Promise<void>
}

export interface ActionOutcome {
  ok: boolean
  error?: string
}

/** 右键菜单扩展协议：其他 Web 插件登记到全局注册表的一条扩展项。 */
export interface ContextMenuExtension {
  id: string
  order?: number
  label?: string
  visible?: (context: { session?: SessionSummaryLike | null, row: Element | null }) => boolean
  run: (context: {
    session?: SessionSummaryLike | null
    row: Element | null
    sessions: SessionsRuntimeLike
    workspaces: WorkspacesRuntimeLike
    close: () => void
  }) => void | Promise<void>
}

/** `dsh:rightclick-menu` 事件 detail（每次打开菜单时派发）。 */
export interface ContextMenuEventDetail {
  row: Element | null
  action: HTMLElement | null
  session: SessionSummaryLike | null
  workspace: WorkspaceViewLike | null
  target: EventTarget | null
  x: number
  y: number
  extensions: ContextMenuExtension[]
}
