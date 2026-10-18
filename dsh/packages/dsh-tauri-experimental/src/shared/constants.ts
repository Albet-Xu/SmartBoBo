/**
 * shared/constants.ts — 跨 host/client 的稳定协议常量。
 *
 * 插件名、API 前缀与「不可用原因」是两半端共享的线协议面：host 侧路由/账本写入、
 * client 侧 RPC/界面呈现各自硬编码必然漂移，集中在此由两端共同引用
 * （plugin.baisc.md「客户端常量集中规则」）。
 */

/** 插件名（诊断元数据 / registrant / 存储目录名）。 */
export const PLUGIN_ID = 'dsh-tauri-experimental'

/** 会话 cwd 不在 Git worktree 内：不建快照，也不产生任何变更记录。 */
export const RUNNING_CHANGES_REASON_GIT_REQUIRED = 'RUNNING_CHANGES_GIT_REQUIRED'

/**
 * PATH 上没有 git 可执行文件。与「不是 Git 仓库」必须分开：
 * 前者提示用户装 git，后者提示用户 git init，混在一起会给出错误指引。
 */
export const RUNNING_CHANGES_REASON_GIT_UNAVAILABLE = 'RUNNING_CHANGES_GIT_UNAVAILABLE'

/** 该 turn 的快照已被容量治理回收（超保留条数 / 仓库隔离重建 / 手工删除）。 */
export const RUNNING_CHANGES_REASON_EXPIRED = 'RUNNING_CHANGES_EXPIRED'

/**
 * 快照或统计过程失败（git 异常、仓库损坏、捕获子进程被中断等）。
 *
 * 与「超限」类原因（文件数/字节数）的区别在于**不可操作**：它说的是「我们没能
 * 把这一轮记下来」，而不是「这一轮超出快照范围」。客户端据此对「连基线都没建立」
 * 的记录保持沉默（见 client/utils/format.ts）。
 */
export const RUNNING_CHANGES_REASON_SNAPSHOT_FAILED = 'RUNNING_CHANGES_SNAPSHOT_FAILED'

/** 写盘路径命中了不允许穿透的目标（父级符号链接/junction、非空目录占位）。 */
export const RUNNING_CHANGES_REASON_UNSAFE_PATH = 'RUNNING_CHANGES_UNSAFE_PATH'

/**
 * 工作区锁等待超时：由固定 loopback 端口的内核独占监听句柄串行（host/utils/lock.ts）。
 * 拿不到锁不代表本轮没有记录，客户端应呈现为可重试的失败，而非终态错误。
 */
export const RUNNING_CHANGES_REASON_WORKSPACE_BUSY = 'RUNNING_CHANGES_WORKSPACE_BUSY'

/**
 * 工作区在本轮期间被带外操作换了提交世代（checkout / worktree 更新 / 合并）。
 *
 * before 快照取自旧世代，磁盘已是新世代：两者的差是整段世代差，不是这一轮的改动。
 * 客户端据此给出「改动无法归属」的说明，而不是把成千上万行「变更」算到用户头上。
 */
export const RUNNING_CHANGES_REASON_WORKSPACE_CHANGED = 'RUNNING_CHANGES_WORKSPACE_CHANGED'
