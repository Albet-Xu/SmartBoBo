/**
 * use-bubble-tracker.test.ts — 桌宠气泡层单测（文案纯函数 + 会话快照 → pet.bubble 映射）。
 *
 * 气泡自身的叠加、原地更新、定时收起与多会话动作聚合由 `dsh-pet-component` 负责，
 * 这里锁两件事：文案选句（同 seed 恒定、分组回落、任务句式）与宿主侧剩下的契约
 * （档位推导、子代理静默、终态只下发一次、挂载前被丢弃的气泡能靠 flush 补齐）。
 */
import type { PetBubbleHandle, PetBubbleOptions } from 'dsh-pet-component'
import { describe, expect, it } from 'vitest'
import { createBubbleTracker } from './use-bubble-tracker'
import { UNTITLED_SESSION_TITLE } from './use-bubble-tracker.constants'
import {
  activityCopy,
  seedNumber,
  sessionTitle,
  statusCopy,
  taskCopy,
  toolActivityGroup,
} from './use-bubble-tracker.helpers'

describe('seedNumber', () => {
  it('numeric strings resolve to the absolute truncated integer', () => {
    expect(seedNumber('12.9')).toBe(12)
    expect(seedNumber('-7')).toBe(7)
    expect(seedNumber(5)).toBe(5)
  })

  it('non-numeric strings sum char code points (stable per string)', () => {
    expect(seedNumber('abc')).toBe(294)
    expect(seedNumber('abd')).toBe(295)
    expect(seedNumber(undefined)).toBe(0)
    expect(seedNumber('')).toBe(0)
  })
})

describe('statusCopy', () => {
  it('returns the literal sentence selected by the seed within a group', () => {
    expect(statusCopy('thinking', 'session-1')).toBe('整理结果中')
    expect(statusCopy('thinking', 0)).toBe('正在分析')
  })

  it('picks from known groups only', () => {
    const variants = new Set(['正在分析', '思考中', '整理结果中'])
    expect(variants.has(statusCopy('thinking', 0))).toBe(true)
    expect(variants.has(statusCopy('thinking', 1))).toBe(true)
  })

  it('falls back to the working group for unknown groups', () => {
    expect(['正在处理任务', '步骤正在进行中', '系统运行中']).toContain(statusCopy('unknown-group', 0))
  })
})

describe('activityCopy', () => {
  it('maps activity categories to their copy groups', () => {
    expect(['正在检索', '正在项目中进行全面搜索', '正在调阅相关文件']).toContain(activityCopy('searching', 0))
    expect(['正在修改', '正在写入变更内容', '正在调整代码实现']).toContain(activityCopy('editing', 1))
    expect(['正在检验', '正在运行测试集进行确认', '正在验证变更有效性']).toContain(activityCopy('testing', 2))
    expect(['正在执行', '正在启动项目服务', '正在监控指令执行状态']).toContain(activityCopy('commanding', 3))
  })

  it('falls back to the working group for missing activity categories', () => {
    expect(['正在处理任务', '步骤正在进行中', '系统运行中']).toContain(activityCopy('weird', 0))
  })
})

describe('toolActivityGroup', () => {
  it('classifies search/read/fetch tools as searching', () => {
    expect(toolActivityGroup('grep')).toBe('searching')
    expect(toolActivityGroup('read')).toBe('searching')
    expect(toolActivityGroup('web_fetch')).toBe('searching')
  })

  it('classifies write/edit tools as editing', () => {
    expect(toolActivityGroup('write')).toBe('editing')
    expect(toolActivityGroup('str_replace_editor')).toBe('editing')
  })

  it('classifies test/lint/build tools as testing', () => {
    expect(toolActivityGroup('run_test')).toBe('testing')
    expect(toolActivityGroup('lint')).toBe('testing')
  })

  it('classifies shell/terminal tools as commanding', () => {
    expect(toolActivityGroup('pwsh')).toBe('commanding')
    expect(toolActivityGroup('bash')).toBe('commanding')
  })

  it('returns working for unmatched tools', () => {
    expect(toolActivityGroup('think')).toBe('working')
    expect(toolActivityGroup(undefined)).toBe('working')
  })
})

describe('taskCopy', () => {
  it('strips trailing punctuation and keeps 正在/继续-prefixed tasks as-is', () => {
    expect(taskCopy('正在写测试。')).toBe('正在写测试')
    expect(taskCopy('继续修改文档')).toBe('继续修改文档')
  })

  it('prefixes action-verb tasks with 正在 (dsh-dafeiyu 句式：正在 + 原文)', () => {
    expect(taskCopy('修改 bug')).toBe('正在修改 bug')
    expect(taskCopy('搜索相关代码')).toBe('正在搜索相关代码')
    expect(taskCopy('整理文档')).toBe('正在整理文档')
  })

  it('wraps other tasks in 正在处理「…」', () => {
    expect(taskCopy('把动画接到气泡')).toBe('正在处理「把动画接到气泡」')
  })

  it('never appends the dsh-dafeiyu sentence-final particle 呢', () => {
    for (const task of ['正在写测试', '继续修改文档', '修改 bug', '把动画接到气泡'])
      expect(taskCopy(task)).not.toContain('呢')
  })

  it('returns undefined for empty/whitespace tasks', () => {
    expect(taskCopy(undefined)).toBeUndefined()
    expect(taskCopy('   ')).toBeUndefined()
    expect(taskCopy('')).toBeUndefined()
  })
})

describe('sessionTitle', () => {
  it('prefers title/displayTitle/name as the base', () => {
    expect(sessionTitle({ title: '修复宠物' })).toBe('修复宠物')
    expect(sessionTitle({ displayTitle: '修复宠物' })).toBe('修复宠物')
    expect(sessionTitle({ name: '修复宠物' })).toBe('修复宠物')
  })

  it('falls back to the untitled label instead of leaking the internal session id', () => {
    const title = sessionTitle({ id: 'session-2a2abd15-b0d4-499c-aed1-dd1424003bb3' })
    expect(title).toBe(UNTITLED_SESSION_TITLE)
    expect(title).not.toContain('session-')
    // 空白标题与缺失标题同档：都不得回落到 id。
    expect(sessionTitle({ title: '   ', displayTitle: '' })).toBe(UNTITLED_SESSION_TITLE)
  })

  it('keeps the attention prefixes on top of the untitled fallback', () => {
    for (const phase of ['approval', 'user-question', 'blocked']) {
      const expected = phase === 'approval' ? '需授权 · 会话' : '需选择 · 会话'
      expect(sessionTitle({ phase, title: '会话' })).toBe(expected)
    }
    expect(sessionTitle({ phase: 'approval' })).toContain(UNTITLED_SESSION_TITLE)
    expect(sessionTitle({ origin: 'subagent' })).toContain(UNTITLED_SESSION_TITLE)
  })
})

type Call
  = | { type: 'show', options: PetBubbleOptions }
    | { type: 'close', id: string | undefined }
    | { type: 'clear' }

/** 假命令面：`mounted` 控制 `pet.bubble` 返回 key 还是空串（组件未挂载）。 */
function createFakeBubble(initiallyMounted = true) {
  const calls: Call[] = []
  const state = { mounted: initiallyMounted }
  const bubble = ((options: PetBubbleOptions) => {
    calls.push({ type: 'show', options })
    return state.mounted ? options.id ?? `auto-${calls.length}` : ''
  }) as PetBubbleHandle
  bubble.close = (id?: string) => {
    calls.push({ type: 'close', id })
  }
  bubble.clear = () => {
    calls.push({ type: 'clear' })
  }
  return { bubble, calls, state }
}

function shows(calls: Call[]): PetBubbleOptions[] {
  return calls.filter(call => call.type === 'show').map(call => call.options)
}

describe('createBubbleTracker', () => {
  it('maps a session snapshot to a bubble carrying its own motion', () => {
    const { bubble, calls } = createFakeBubble()
    createBubbleTracker(bubble).apply({ id: 's1', title: '会话一', workStatus: 'working', task: '修复登录' }, 'create')

    expect(shows(calls)).toEqual([
      { id: 's1', title: '会话一', description: '正在修复登录', loading: true, motion: 'working' },
    ])
  })

  it('prefers the fine-grained workStatus over the coarse status', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', status: 'running', workStatus: 'waiting' }, 'update')

    expect(shows(calls)[0]?.motion).toBe('waiting')
    expect(shows(calls)[0]?.loading).toBe(false)
  })

  it('keeps every subagent session silent', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 'a1', origin: 'subagent', title: '子代理', workStatus: 'working' }, 'create')
    tracker.apply({ id: 'a1', origin: 'subagent', title: '子代理', workStatus: 'result' }, 'update')

    expect(calls).toEqual([])
  })

  it('closes the bubble when the session is removed or falls back to no motion', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', workStatus: 'thinking' }, 'create')
    tracker.apply({ id: 's1' }, 'update')
    tracker.apply({ id: 's2', workStatus: 'thinking' }, 'create')
    tracker.apply({ id: 's2' }, 'remove')

    expect(calls.filter(call => call.type === 'close')).toEqual([
      { type: 'close', id: 's1' },
      { type: 'close', id: 's2' },
    ])
  })

  it('shows a terminal motion only once until the session leaves it', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', workStatus: 'success' }, 'update')
    tracker.apply({ id: 's1', workStatus: 'success' }, 'update')
    expect(shows(calls)).toHaveLength(1)

    tracker.apply({ id: 's1', workStatus: 'thinking' }, 'update')
    tracker.apply({ id: 's1', workStatus: 'success' }, 'update')
    expect(shows(calls)).toHaveLength(3)
  })

  it('flushes bubbles dropped while <Pet> was not mounted', () => {
    const { bubble, calls, state } = createFakeBubble(false)
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', workStatus: 'success' }, 'create')
    expect(shows(calls)).toHaveLength(1)

    state.mounted = true
    tracker.flush()
    expect(shows(calls)).toHaveLength(2)
    expect(shows(calls)[1]?.motion).toBe('success')
  })

  it('appends a one-shot done bubble when a running turn ends without a work status', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', title: '会话一', status: 'running' }, 'create')
    tracker.apply({ id: 's1', title: '会话一' }, 'update')

    expect(shows(calls).at(-1)).toEqual({
      id: 's1:done',
      title: '会话一',
      description: '已完成',
      variant: 'success',
      timeout: 3000,
    })
  })

  it('clears every tracked session and the component bubbles without forgetting future updates', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', workStatus: 'working' }, 'create')
    tracker.apply({ id: 's2', workStatus: 'success' }, 'create')

    tracker.clear()
    expect(calls.at(-1)).toEqual({ type: 'clear' })

    // clear 只作废已追踪的会话：清空后同一 id 再来事件仍要正常上气泡。
    tracker.apply({ id: 's1', workStatus: 'thinking' }, 'create')
    expect(shows(calls).at(-1)?.motion).toBe('thinking')
  })

  it('drops host state and clears the component bubbles on dispose', () => {
    const { bubble, calls } = createFakeBubble()
    const tracker = createBubbleTracker(bubble)
    tracker.apply({ id: 's1', workStatus: 'working' }, 'create')
    tracker.dispose()
    tracker.flush()

    expect(calls.at(-1)).toEqual({ type: 'clear' })
    expect(shows(calls)).toHaveLength(1)
  })
})
