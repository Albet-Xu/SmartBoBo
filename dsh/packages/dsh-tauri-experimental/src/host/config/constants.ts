/**
 * host/config/constants.ts — 宿主侧静态常量。
 *
 * 上限与原因码集中在此：捕获路径与容量治理共用同一组判定，
 * 避免「预览说超限、执行却照做」这类双份常量漂移。
 */

import {
  PLUGIN_ID,
  RUNNING_CHANGES_REASON_EXPIRED,
  RUNNING_CHANGES_REASON_GIT_REQUIRED,
  RUNNING_CHANGES_REASON_SNAPSHOT_FAILED,
  RUNNING_CHANGES_REASON_WORKSPACE_BUSY,
} from '../../shared/constants'

/** 每个工作区私有快照仓与每会话账本的存放目录（DSH_HOME 下）。 */
export const SNAPSHOT_FEATURE_DIR = PLUGIN_ID

/** 账本子目录（`$DSH_HOME/<feature>/sessions`）。 */
export const LEDGER_SUBDIR = 'sessions'

/** 账本文件版本；字段或折叠语义变更时递增。 */
export const LEDGER_VERSION = 1

/** 保留快照 refs 的最近 turn 数；更老的 turn 标记过期（保留审计行、删除 refs）。 */
export const MAX_TURNS_PER_SESSION = 50

/** 每会话账本行的硬上限（审计窗口），超过即丢弃最老的行。 */
export const MAX_TURN_RECORDS = 200

/**
 * 单个文件超过此字节数即从快照中排除并在记录里标注（不是让整轮不可用）。
 * 这不是内存上限，而是防止单个巨大产物撑爆私有仓。
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024

/** 单条 git 子进程的墙钟超时（快照/差异统计等重活）。 */
export const GIT_TIMEOUT_MS = 5 * 60 * 1000

/** 会话 cwd 不在 Git worktree 内：不做快照。 */
export const REASON_GIT_REQUIRED = RUNNING_CHANGES_REASON_GIT_REQUIRED

/** 会话 cwd 是家目录/家目录祖先/盘根等系统目录：拒绝快照。 */
export const REASON_UNSAFE_WORKSPACE = 'RUNNING_CHANGES_UNSAFE_WORKSPACE'

/** 快照或统计过程失败（git 异常、仓库损坏等）。 */
export const REASON_SNAPSHOT_FAILED = RUNNING_CHANGES_REASON_SNAPSHOT_FAILED

/** 快照仓被隔离重建 / 手工删除，该 turn 的 refs 已不存在。 */
export const REASON_EXPIRED = RUNNING_CHANGES_REASON_EXPIRED

/** 工作区被另一个宿主进程占用（跨进程锁等待超时）。 */
export const REASON_WORKSPACE_BUSY = RUNNING_CHANGES_REASON_WORKSPACE_BUSY

/** 旧版单文件锁协议的围栏/诊断目录（真正互斥由内核监听句柄持有，见 utils/lock.ts）。 */
export const LOCK_DIR_NAME = 'locks'

/**
 * 跨进程锁的等待上限：与 git 重活同预算。
 *
 * 拿到锁意味着「轮到我动这个工作区的私有仓」，而一次捕获/结算本身就是 git 重活
 * （大仓库首次要几十秒），所以等待时长必须覆盖对方**一整次操作**。等不到就给调用方
 * 一个明确的结论（捕获照实记不可用）。没有任何 TTL 接管活锁的通道：
 * 持有者挂死时这里就是唯一的收口——如实报「占用」，宁可暂时不可用也不去抢一把活着的锁。
 */
export const LOCK_WAIT_TIMEOUT_MS = GIT_TIMEOUT_MS

/** 屏障任务开始前的 FIFO 与争锁等待预算；治理和 before 在一次持锁内完整执行。 */
export const LOCK_BARRIER_TIMEOUT_MS = 20 * 1000

/** 锁竞争时的重试间隔：轮询粒度，太小会空转 I/O，太大则让短临界区白等。 */
export const LOCK_RETRY_INTERVAL_MS = 200
