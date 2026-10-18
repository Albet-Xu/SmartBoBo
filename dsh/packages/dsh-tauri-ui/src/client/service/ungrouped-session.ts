import type { ClientAdapter, ClientContext, SessionId } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'
import { getUngrouped } from '../apis'

/** 会话列表快照中本服务读取的字段（`current` 在 0.1.7 由适配层投影补回）。 */
interface ListSnapshotLike {
  current?: SessionId
  byId?: Record<string, { blank?: boolean, cwd?: string } | undefined>
}

/**
 * 未分组新建会话：不传 workspaceId、只传宿主解析出的未分组目录（`$DSH_HOME/ungrouped`），
 * 宿主据此建会话且不 attach 任何工作区。
 *
 * 不显式传 `cwd` 时宿主退回 `process.cwd()`——桌面壳把该进程的 cwd 固定为核心安装目录
 * （版本切换时需持住目录句柄），未分组会话就会落进核心目录这一伪项目。目录由宿主在建会话
 * 前 `mkdir -p`，无需客户端预热；路由不可用时退回旧行为并告警。
 *
 * `adapter` 负责跨内核代的会话能力：`open` 在 ≤0.1.6 位于 `sessions`，0.1.7 收进
 * `uiWorkspace.openSession`；列表快照的 `current` 在 0.1.7 也改由 `uiSession` 投影补回。
 * 省略 `adapter` 时回退原生 `ctx.sessions`（旧内核与单测路径）。
 */
export function startUngroupedSession(ctx: ClientContext, adapter?: ClientAdapter): void {
  void connectUngroupedSession(ctx, adapter).then(
    (sessionId) => {
      openSession(ctx, adapter, sessionId)
      ctx.layout.selectPanel(null)
    },
    (reason: unknown) => {
      console.warn(`[${PLUGIN_ID}] 未分组新建会话失败:`, reason)
    },
  )
}

async function connectUngroupedSession(ctx: ClientContext, adapter?: ClientAdapter): Promise<SessionId> {
  const cwd = await resolveUngroupedCwd()
  const current = snapshotOf(ctx, adapter).current
  if (current !== undefined && isUngroupedBlank(ctx, adapter, current, cwd))
    return current
  return cwd === undefined ? ctx.sessions.create() : ctx.sessions.create({ cwd })
}

function isUngroupedBlank(
  ctx: ClientContext,
  adapter: ClientAdapter | undefined,
  sessionId: SessionId,
  cwd: string | undefined,
): boolean {
  const summary = snapshotOf(ctx, adapter).byId?.[sessionId]
  if (summary === undefined || !summary.blank)
    return false
  // 复用只认「已经落在未分组目录」的空白会话：核心目录 cwd 的历史会话不得被继续沿用。
  if (cwd !== undefined && summary.cwd !== cwd)
    return false
  const workspaces = readWorkspaces(ctx)
  return workspaces === undefined || workspaces.every(workspace => !workspace.sessionIds.includes(sessionId))
}

/** 宿主解析未分组目录；取不到时按「无 cwd」处理，退回核心默认目录，绝不阻断开会话。 */
async function resolveUngroupedCwd(): Promise<string | undefined> {
  try {
    const response = await getUngrouped()
    const cwd = response?.cwd
    return typeof cwd === 'string' && cwd.trim().length > 0 ? cwd : undefined
  }
  catch (reason) {
    console.warn(`[${PLUGIN_ID}] 未分组目录解析失败，沿用核心默认目录:`, reason)
    return undefined
  }
}

/** 打开已有会话：适配层优先（0.1.7 走 `uiWorkspace.openSession`），缺席时回退原生成员。 */
function openSession(ctx: ClientContext, adapter: ClientAdapter | undefined, sessionId: SessionId): void {
  if (adapter !== undefined) {
    adapter.openSession(sessionId)
    return
  }
  const native = ctx.sessions as unknown as { open?: (id: SessionId) => unknown }
  native.open?.(sessionId)
}

function snapshotOf(ctx: ClientContext, adapter?: ClientAdapter): ListSnapshotLike {
  const list = adapter?.sessions.list ?? ctx.sessions.list
  return (list.getSnapshot() ?? {}) as ListSnapshotLike
}

interface WorkspacesRuntime {
  list: { getSnapshot: () => { items: readonly { sessionIds: readonly SessionId[] }[] } }
}

/** 走 `ctx.get` 并吞掉 inject-only 守卫的抛错：读不到时按「无法判断」处理，绝不阻断开会话。 */
function readWorkspaces(ctx: ClientContext): readonly { sessionIds: readonly SessionId[] }[] | undefined {
  try {
    const workspaces = ctx.get('workspaces') as WorkspacesRuntime | undefined
    return workspaces?.list.getSnapshot().items
  }
  catch {
    return undefined
  }
}
