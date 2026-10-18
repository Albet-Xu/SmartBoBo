/**
 * host/service/snapshot.ts — 每个工作区一个**私有 Git 快照仓**的捕获 / 差异 / 恢复引擎。
 *
 * 设计要点：
 *   - 私有仓自包含（不借源仓库对象、不用 alternates），源仓库 gc 不会破坏快照；
 *   - 私有仓自带 index（stat 缓存让 `add --all` 后续轮次天然增量）；
 *   - 源仓库只做只读探测：镜像 core.autocrlf / core.eol / core.symlinks 与 info/exclude；
 *   - **快照仓代数（generation）**：整仓被隔离重建或被删后轮换，账本记录据此判定过期；
 *   - 不在快照范围内却不该静默漏掉的东西（超大文件、嵌套 Git 仓库）排除并记录进账本。
 */

import type {
  CaptureLimits,
  CaptureOptions,
  CaptureResult,
  SnapshotStore,
  TurnFileChange,
} from '../types'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { defineService, DSH_HOME } from 'dsh-tauri'
import { dirname, isAbsolute, join, resolve } from 'pathe'
import { GIT_TIMEOUT_MS, MAX_FILE_BYTES, REASON_SNAPSHOT_FAILED, SNAPSHOT_FEATURE_DIR } from '../config/constants'
import { gitInRepo, gitInSnapshot, resolveSourceCommonDir } from '../utils/git'
import { workspaceHash } from '../utils/workspace'

const SNAPSHOT_REF_PREFIX = 'refs/running-changes'

const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024

const MAX_FILES_PER_SNAPSHOT = 5000

const MAX_OVERSIZED_SKIPS = 200

const REASON_TOO_MANY_FILES = 'RUNNING_CHANGES_TOO_MANY_FILES'

const REASON_SNAPSHOT_TOO_LARGE = 'RUNNING_CHANGES_SNAPSHOT_TOO_LARGE'

const REASON_TOO_MANY_OVERSIZED = 'RUNNING_CHANGES_TOO_MANY_OVERSIZED'

/** commit-tree 的身份（私有仓的提交只做锚点，不代表用户，故用固定身份）。 */
const SNAPSHOT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: 'DSH Running Changes',
  GIT_AUTHOR_EMAIL: 'running-changes@localhost',
  GIT_COMMITTER_NAME: 'DSH Running Changes',
  GIT_COMMITTER_EMAIL: 'running-changes@localhost',
}

/** 随源仓库同步的配置键：影响 add 的归一化与 checkout 的还原方式。 */
const MIRRORED_CONFIG_KEYS = ['core.autocrlf', 'core.eol', 'core.symlinks']

/** 「体积超限 → 排除最大文件重试」与「解析出嵌套仓库 → 排除重试」的次数上限。 */
const MAX_OVERSIZE_ATTEMPTS = 2
const MAX_NESTED_ATTEMPTS = 3

export const snapshot = defineService({
  /** 某工作区对应的私有快照仓定位；给出会话 id 时 index 也按会话隔离。 */
  resolve(worktree: string, commonDir?: string | null, sessionId?: string | null): SnapshotStore {
    const gitDir = join(snapshotWorkspacesDir(), `${workspaceHash(worktree)}.git`)
    return {
      worktree,
      gitDir,
      commonDir: commonDir ?? null,
      ...(sessionId ? { indexFile: sessionIndexFile(gitDir, sessionId) } : {}),
    }
  },

  /** 快照 ref 名；会话 id 先做文件系统/ref 安全化，再拼短哈希防撞。 */
  ref(sessionId: string, turn: number, phase: 'before' | 'after'): string {
    const sanitized = sessionId.replace(/[^\w.-]/g, '_').slice(0, 64) || 'session'
    const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
    return `${SNAPSHOT_REF_PREFIX}/${sanitized}-${digest}/${turn}/${phase}`
  },

  /** 有界扫描嵌套 Git 仓库（根 + 两级，跳过噪音目录）。 */
  scan(worktree: string): string[] {
    return scanNestedRepos(worktree)
  },

  /** 轮换快照仓代数：整仓被删/被隔离重建后调用，旧记录据此自然过期。 */
  async rotate(store: SnapshotStore, reason?: string): Promise<string> {
    const generation = randomUUID()
    await writeMarker(workspaceMarkerPath(store), { generation, rebuiltAt: Date.now() })
    store.generation = generation
    if (reason !== undefined)
      store.rebuiltReason = reason
    return generation
  },

  /**
   * 捕获一次快照：`add --all`（带排除）→ `write-tree` → `commit-tree` → `update-ref`。
   *
   * 体积超限时先排除最大的那几个文件重试（并回传给调用方持久化，后续 turn 不必再重捕），
   * 否则一个巨大的构建产物会让整个工作区永久不可用且原因不可读。
   */
  async capture(store: SnapshotStore, ref: string, message: string, options: CaptureOptions = {}): Promise<CaptureResult> {
    if (!isSafeRef(ref))
      return { ok: false, reason: REASON_SNAPSHOT_FAILED }
    const limits: CaptureLimits = {
      maxFileBytes: options.limits?.maxFileBytes ?? MAX_FILE_BYTES,
      maxSnapshotBytes: options.limits?.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES,
      maxFiles: options.limits?.maxFiles ?? MAX_FILES_PER_SNAPSHOT,
    }
    const ready = await ensureSnapshotRepo(store)
    if (!ready.ok)
      return { ok: false, reason: ready.reason }

    const excluded = new Set(options.exclude ?? [])
    const nestedDirs = new Set(options.nestedDirs ?? scanNestedRepos(store.worktree))
    for (const dir of nestedDirs)
      excluded.add(dir)
    const learned = new Set<string>()
    const oversizedSkipped = new Set<string>()

    let stats: TreeStats | null = null
    let lockRetried = false
    let oversizeAttempts = 0
    let nestedAttempts = 0

    for (let attempt = 0; attempt < 8; attempt += 1) {
      // 每轮重新过滤：循环里还会学到新的排除项（嵌套仓库/超限文件），而**被忽略的路径
      // 一旦出现在 exclude pathspec 里就会让 git add 直接失败**（见 dropIgnoredExclusions）。
      const activeExclude = await dropIgnoredExclusions(store, [...excluded])
      // 已被排除的路径必须从 index 里移除：否则上一轮捕获留下的 blob 仍在树里，
      // 体积统计与「已排除」的记录会对不上。
      if (activeExclude.length > 0)
        await gitInSnapshot(store, ['rm', '--cached', '-r', '--quiet', '--ignore-unmatch', '--', ...activeExclude])
      const added = await gitInSnapshot(store, ['add', '--all', '--', '.', ...excludePathspecs(activeExclude, nestedDirs)])
      if (!added.ok) {
        const nested = parseNestedRepoPath(added.error)
        if (nested !== null && !excluded.has(nested) && nestedAttempts < MAX_NESTED_ATTEMPTS) {
          excluded.add(nested)
          nestedDirs.add(nested)
          learned.add(nested)
          nestedAttempts += 1
          continue
        }
        if (/index\.lock/.test(added.error) && !lockRetried) {
          sweepStaleIndexLock(store)
          lockRetried = true
          continue
        }
        return { ok: false, reason: REASON_SNAPSHOT_FAILED }
      }
      const tree = await gitInSnapshot(store, ['write-tree'])
      if (!tree.ok)
        return { ok: false, reason: REASON_SNAPSHOT_FAILED }
      const counted = await treeStats(store, tree.out.trim(), limits.maxFileBytes)
      if (!counted.ok)
        return { ok: false, reason: REASON_SNAPSHOT_FAILED }
      stats = counted.stats

      if (stats.files > limits.maxFiles)
        return { ok: false, reason: REASON_TOO_MANY_FILES }

      if (stats.bytes > limits.maxSnapshotBytes) {
        // 超限文件太多时不逐个排除（argv 与重试成本都会爆），如实记不可用。
        if (stats.oversized.length > MAX_OVERSIZED_SKIPS)
          return { ok: false, reason: REASON_TOO_MANY_OVERSIZED }
        const candidates = stats.oversized
          .filter(entry => !excluded.has(entry.path))
          .slice(0, MAX_OVERSIZED_SKIPS)
        if (candidates.length === 0 || oversizeAttempts >= MAX_OVERSIZE_ATTEMPTS)
          return { ok: false, reason: REASON_SNAPSHOT_TOO_LARGE }
        for (const entry of candidates) {
          excluded.add(entry.path)
          oversizedSkipped.add(entry.path)
          learned.add(entry.path)
        }
        oversizeAttempts += 1
        continue
      }

      const commit = await gitInSnapshot(store, ['commit-tree', tree.out.trim(), '-m', message], { env: SNAPSHOT_IDENTITY })
      if (!commit.ok)
        return { ok: false, reason: REASON_SNAPSHOT_FAILED }
      const updated = await gitInSnapshot(store, ['update-ref', ref, commit.out.trim()])
      if (!updated.ok)
        return { ok: false, reason: REASON_SNAPSHOT_FAILED }
      return {
        ok: true,
        commit: commit.out.trim(),
        skippedOversized: [...new Set([...oversizedSkipped, ...(options.exclude ?? []).filter(path => !nestedDirs.has(path))])].filter(path => path.length > 0),
        skippedNestedRepos: [...new Set([...nestedDirs, ...stats.gitlinks])].filter(path => path.length > 0),
        learnedExclusions: [...learned],
      }
    }
    return { ok: false, reason: REASON_SNAPSHOT_TOO_LARGE }
  },

  /** 删除快照 ref（账本过期/淘汰后调用），失败忽略。 */
  async remove(store: SnapshotStore, refs: readonly string[]): Promise<void> {
    for (const ref of refs) {
      if (isSafeRef(ref))
        await gitInSnapshot(store, ['update-ref', '-d', ref])
    }
  },

  /**
   * 读源仓库当前 HEAD（只读探测，绝不写用户仓库）。
   *
   * 基线绑定用：before 快照取自**某个提交世代**的工作区。若之后工作区被带外操作
   * （git checkout / worktree 更新 / 合并）换了世代，before 树与当前磁盘之间就横着
   * 整段世代差——把它算成「这一轮的改动」，用户什么都没改也会报出成千上万行。
   */
  async head(worktree: string): Promise<string | null> {
    const result = await gitInRepo(worktree, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    if (!result.ok)
      return null
    const oid = result.out.trim()
    return /^[0-9a-f]{40,64}$/i.test(oid) ? oid : null
  },

  /**
   * 计算两个快照之间的逐文件差异（`+N -M` 与新增/修改/删除）。
   * 状态由两侧路径集合推导：只看 after 有=A，只看 before 有=D，两侧都有=M。
   */
  async diff(store: SnapshotStore, beforeCommit: string, afterCommit: string): Promise<{ ok: true, changes: TurnFileChange[] } | { ok: false, reason: string }> {
    const [before, after, numstat] = await Promise.all([
      treePaths(store, beforeCommit),
      treePaths(store, afterCommit),
      gitInSnapshot(store, ['diff', '--numstat', '-z', '--no-renames', beforeCommit, afterCommit]),
    ])
    if (!before.ok)
      return { ok: false, reason: before.reason }
    if (!after.ok)
      return { ok: false, reason: after.reason }
    if (!numstat.ok)
      return { ok: false, reason: numstat.error }
    const changes: TurnFileChange[] = []
    for (const record of splitNul(numstat.out)) {
      const firstTab = record.indexOf('\t')
      const secondTab = record.indexOf('\t', firstTab + 1)
      if (firstTab < 0 || secondTab < 0)
        continue
      const rawInsertions = record.slice(0, firstTab)
      const rawDeletions = record.slice(firstTab + 1, secondTab)
      const path = record.slice(secondTab + 1)
      if (path.length === 0)
        continue
      const binary = rawInsertions === '-' || rawDeletions === '-'
      changes.push({
        path,
        status: !before.paths.has(path) ? 'A' : !after.paths.has(path) ? 'D' : 'M',
        insertions: binary ? null : Number(rawInsertions),
        deletions: binary ? null : Number(rawDeletions),
        binary,
      })
    }
    changes.sort((left, right) => left.path.localeCompare(right.path))
    return { ok: true, changes }
  },

  /**
   * 运行中实时统计：刷新私有 index 后与 before 快照比较当前工作区。
   *
   * 必须先 `add --all` 再 diff：`git diff <commit>` 只认提交与 index 里出现过的路径，
   * 本轮新建的文件在 index 里还不存在，不刷新就会漏掉它们。
   *
   * 排除清单在两条命令里的用法不一样：`git add` 用剔除被忽略项的结果（指向被忽略目录的
   * exclude pathspec 会让 git add 直接失败），`git diff` 必须带**完整**排除清单，
   * 否则嵌套仓库会作为 gitlink 被报成「本轮新增的文件」。
   */
  async live(store: SnapshotStore, beforeCommit: string, options: CaptureOptions = {}): Promise<{ ok: true, stats: { fileCount: number, insertions: number, deletions: number } } | { ok: false, reason: string }> {
    // 目录语义的排除必须知道哪些路径是目录，因此把嵌套仓库目录并进同一份排除清单。
    const nestedDirs = new Set(options.nestedDirs ?? [])
    const excluded = [...new Set([...(options.exclude ?? []), ...nestedDirs])]
    const activeExclude = await dropIgnoredExclusions(store, excluded)
    const added = await gitInSnapshot(store, ['add', '--all', '--', '.', ...excludePathspecs(activeExclude, nestedDirs)])
    if (!added.ok)
      return { ok: false, reason: added.error }
    const diffArgs = ['diff', '--numstat', '-z', '--no-renames', beforeCommit]
    if (excluded.length > 0)
      diffArgs.push('--', '.', ...excludePathspecs(excluded, nestedDirs))
    const numstat = await gitInSnapshot(store, diffArgs)
    if (!numstat.ok)
      return { ok: false, reason: numstat.error }
    let fileCount = 0
    let insertions = 0
    let deletions = 0
    for (const record of splitNul(numstat.out)) {
      const firstTab = record.indexOf('\t')
      const secondTab = record.indexOf('\t', firstTab + 1)
      if (firstTab < 0 || secondTab < 0)
        continue
      fileCount += 1
      const rawInsertions = record.slice(0, firstTab)
      const rawDeletions = record.slice(firstTab + 1, secondTab)
      if (rawInsertions === '-' || rawDeletions === '-')
        continue
      insertions += Number(rawInsertions)
      deletions += Number(rawDeletions)
    }
    return { ok: true, stats: { fileCount, insertions, deletions } }
  },

})

// --- internal ---

/** 嵌套仓库预扫的深度、目录数与跳过名单（有界扫描，只做启发式）。 */
const NESTED_SCAN_MAX_DEPTH = 2
const NESTED_SCAN_MAX_DIRS = 2000
const NESTED_SCAN_SKIP = new Set(['.git', 'node_modules', '.running-changes'])

interface WorkspaceMarker {
  generation: string
  rebuiltAt?: number
}

interface TreeStats {
  files: number
  bytes: number
  /** 超过单文件上限的条目（按大小降序），供「排除最大文件后重试」使用。 */
  oversized: Array<{ path: string, size: number }>
  /** 树里的 gitlink（mode 160000 = 嵌套仓库/子模块）：内容不纳入快照。 */
  gitlinks: string[]
}

/** 快照仓根目录（固定落在 `DSH_HOME` 下）。 */
function snapshotWorkspacesDir(): string {
  return join(DSH_HOME, SNAPSHOT_FEATURE_DIR, 'workspaces')
}

/** 会话独占 index 路径：同一工作区里的多个会话不得共用私有仓的 `index`。 */
function sessionIndexFile(gitDir: string, sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return join(gitDir, `index.${digest}`)
}

/** 工作区标记文件（代数 + 重建时间的宿主侧真相）；读写两侧必须走同一个拼法。 */
function workspaceMarkerPath(store: SnapshotStore): string {
  return `${store.gitDir}.json`
}

/**
 * 只允许把 `refs/running-changes/*` 或 40/64 位 oid 插值进 git 参数。
 * 账本是从磁盘读的 JSON，被手改/损坏时不能把任意字符串塞进子进程 argv。
 */
function isSafeRef(value: string, prefix = SNAPSHOT_REF_PREFIX): boolean {
  return value.startsWith(prefix) || /^[0-9a-f]{40}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value)
}

function splitNul(value: string): string[] {
  if (value.length === 0)
    return []
  const parts = value.split('\0')
  if (parts.at(-1) === '')
    parts.pop()
  return parts
}

function repoExists(store: SnapshotStore): boolean {
  return existsSync(join(store.gitDir, 'HEAD'))
}

async function readMarker(path: string): Promise<WorkspaceMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<WorkspaceMarker>
    if (typeof parsed.generation === 'string' && parsed.generation.length > 0)
      return { generation: parsed.generation, ...(typeof parsed.rebuiltAt === 'number' ? { rebuiltAt: parsed.rebuiltAt } : {}) }
    return null
  }
  catch {
    return null
  }
}

async function writeMarker(path: string, marker: WorkspaceMarker): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
}

/** 读取当前快照仓代数；标记缺失时按需创建。 */
async function ensureGeneration(store: SnapshotStore): Promise<string> {
  const path = workspaceMarkerPath(store)
  const marker = await readMarker(path)
  if (marker !== null) {
    store.generation = marker.generation
    return marker.generation
  }
  const generation = randomUUID()
  await writeMarker(path, { generation })
  store.generation = generation
  return generation
}

/**
 * 清扫崩溃残骸：私有仓的 `index.lock` 若比 git 的重活预算还旧，说明上一个进程在
 * `git add` 中途死了——不清掉的话之后每次快照都会因锁失败而永久不可用。
 */
function sweepStaleIndexLock(store: SnapshotStore): boolean {
  const lock = store.indexFile === undefined ? join(store.gitDir, 'index.lock') : `${store.indexFile}.lock`
  try {
    const stats = lstatSync(lock)
    if (Date.now() - stats.mtimeMs <= GIT_TIMEOUT_MS)
      return false
  }
  catch {
    return false
  }
  try {
    unlinkSync(lock)
    return true
  }
  catch {
    // 残骸清扫是 best-effort：清不掉就让后续 git 照常报锁冲突。
    return false
  }
}

/** 首次使用时初始化私有快照仓，并把源仓库的换行/属性配置镜像进来。 */
async function ensureSnapshotRepo(store: SnapshotStore): Promise<{ ok: true } | { ok: false, reason: string }> {
  const existed = repoExists(store)
  if (!existed) {
    // `git init <path>.git` 会在 `<path>.git` 里再套一层 `.git`，而 `--git-dir` 需要目录本身
    // 就是 git dir，因此用 `--bare`。父目录必须先存在，否则 execFile ENOENT。
    const parent = dirname(store.gitDir)
    await mkdir(parent, { recursive: true })
    const init = await gitInRepo(parent, ['init', '--bare', '--quiet', store.gitDir])
    if (!init.ok)
      return { ok: false, reason: REASON_SNAPSHOT_FAILED }
    // 仓库不在（首次使用 / 被删 / 被隔离重建）：轮换代数，让旧记录自然过期。
    await snapshot.rotate(store)
  }
  else {
    await ensureGeneration(store)
    sweepStaleIndexLock(store)
  }
  await gitInSnapshot(store, ['config', 'core.bare', 'false'])
  const configured = await gitInSnapshot(store, ['config', 'core.worktree', store.worktree])
  if (!configured.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  // 私有仓不做自动 gc（避免后台回收与快照抢锁）：回收由 retention 的显式 prune 负责。
  await gitInSnapshot(store, ['config', 'gc.auto', '0'])
  // 长路径支持：Windows 上超过 MAX_PATH 的路径会让 add/checkout 直接失败。
  await gitInSnapshot(store, ['config', 'core.longpaths', 'true'])
  for (const key of MIRRORED_CONFIG_KEYS) {
    const value = await gitInRepo(store.worktree, ['config', '--get', key])
    const trimmed = value.ok ? value.out.trim() : ''
    if (trimmed.length > 0)
      await gitInSnapshot(store, ['config', key, trimmed])
  }
  await syncSourceExclude(store)
  return { ok: true }
}

/** 把源仓库 `.git/info/exclude` 的内容同步进私有仓（忽略规则语义对齐，best-effort）。 */
async function syncSourceExclude(store: SnapshotStore): Promise<void> {
  const commonDir = store.commonDir ?? await resolveSourceCommonDir(store.worktree)
  if (commonDir === null)
    return
  const absoluteCommon = isAbsolute(commonDir) ? commonDir : resolve(store.worktree, commonDir)
  const sourceFile = join(absoluteCommon, 'info', 'exclude')
  if (!existsSync(sourceFile))
    return
  // 写的是**私有仓**自己的 info/exclude：私有仓的 GIT_DIR 与源仓库不同，
  // 源仓库的 exclude 不会被自动读取，必须显式镜像过来。
  const target = join(store.gitDir, 'info', 'exclude')
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(sourceFile, 'utf8'), 'utf8')
  }
  catch {
    /* 同步失败不影响快照：只是忽略规则可能少一条 */
  }
}

/** 统计一棵树：文件数、聚合字节、超限条目与 gitlink。 */
async function treeStats(store: SnapshotStore, commitOrTree: string, maxFileBytes: number): Promise<{ ok: true, stats: TreeStats } | { ok: false, reason: string }> {
  const listed = await gitInSnapshot(store, ['ls-tree', '-r', '-l', '-z', commitOrTree])
  if (!listed.ok)
    return { ok: false, reason: listed.error }
  const stats: TreeStats = { files: 0, bytes: 0, oversized: [], gitlinks: [] }
  for (const record of splitNul(listed.out)) {
    const match = /^(\d{6}) (\w+) ([0-9a-f]+)\s+(\d+)\t([\s\S]+)$/.exec(record)
    if (match === null) {
      // 子模块/嵌套仓库（gitlink，无 size 列）：计入文件数，单独记录。
      const gitlink = /^160000 commit [0-9a-f]+\t([\s\S]+)$/.exec(record)
      if (gitlink !== null)
        stats.gitlinks.push(gitlink[1] ?? '')
      stats.files += 1
      continue
    }
    const size = Number(match[4])
    const path = match[5] ?? ''
    stats.files += 1
    stats.bytes += size
    if (size > maxFileBytes)
      stats.oversized.push({ path, size })
  }
  stats.oversized.sort((left, right) => right.size - left.size)
  return { ok: true, stats }
}

/** 把排除路径编译成 git pathspec（目录同时排除自身与内容）。 */
function excludePathspecs(paths: readonly string[], directories: ReadonlySet<string>): string[] {
  const specs: string[] = []
  for (const path of paths) {
    specs.push(`:(exclude)${path}`)
    if (directories.has(path))
      specs.push(`:(exclude,glob)${path}/**`)
  }
  return specs
}

/**
 * 摘掉「已被 git 忽略」的排除路径。
 *
 * `git add --all -- . :(exclude)<ignored>` 会直接失败（`The following paths are ignored
 * by one of your .gitignore files`），而这条错误与「能不能加入」无关。判定必须交给 git
 * 自己（`check-ignore`）而不是自制正则：它和 `git add` 读的是同一份 index 与忽略规则。
 * `check-ignore` 用退出码表达否定答案（exit 1 = 一条都没命中），因此失败分支的 stdout
 * 也要读（见 utils/git.ts）。判定失败时原样保留全部路径：宁可退回改动前的行为。
 */
async function dropIgnoredExclusions(store: SnapshotStore, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0)
    return []
  const listed = await gitInSnapshot(store, ['check-ignore', '-z', '--stdin'], { input: `${paths.join('\0')}\0` })
  if (listed.out.length === 0)
    return [...paths]
  const ignored = new Set(splitNul(listed.out))
  return paths.filter(path => !ignored.has(path))
}

/** 从 git add 的失败信息里解析出「没有提交的嵌套仓库」路径（可能不存在）。 */
function parseNestedRepoPath(error: string): string | null {
  const match = /'([^']+)' does not have a commit checked out/.exec(error)
    ?? /unable to index file '([^']+)'/.exec(error)
  if (match === null)
    return null
  const path = (match[1] ?? '').replace(/[\\/]+$/, '')
  if (path.length === 0 || path.includes('\0') || isAbsolute(path) || path.startsWith('..'))
    return null
  return path
}

/** 有界扫描嵌套 Git 仓库（根 + 两级，跳过噪音目录）。 */
function scanNestedRepos(worktree: string): string[] {
  const found: string[] = []
  let visited = 0
  const walk = (rel: string, depth: number): void => {
    if (depth > NESTED_SCAN_MAX_DEPTH || visited >= NESTED_SCAN_MAX_DIRS)
      return
    const absolute = rel === '' ? worktree : join(worktree, rel)
    let entries
    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    }
    catch {
      return
    }
    for (const entry of entries) {
      if (visited >= NESTED_SCAN_MAX_DIRS)
        return
      if (!entry.isDirectory() || NESTED_SCAN_SKIP.has(entry.name))
        continue
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      visited += 1
      if (existsSync(join(worktree, childRel, '.git'))) {
        found.push(childRel)
        continue
      }
      walk(childRel, depth + 1)
    }
  }
  walk('', 0)
  return found
}

/** 列出某 commit 下的全部路径集合。 */
async function treePaths(store: SnapshotStore, commit: string): Promise<{ ok: true, paths: Set<string> } | { ok: false, reason: string }> {
  const listed = await gitInSnapshot(store, ['ls-tree', '-r', '-z', '--name-only', commit])
  if (!listed.ok)
    return { ok: false, reason: listed.error }
  return { ok: true, paths: new Set(splitNul(listed.out)) }
}
