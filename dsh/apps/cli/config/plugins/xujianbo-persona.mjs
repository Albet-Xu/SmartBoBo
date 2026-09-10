/**
 * xujianbo-persona —— 跨模式隐藏人格开关（内部称「爸爸模式」）。
 *
 * 触发面只看**真实用户输入**：自我介绍（"我是许建波"）、单独点名（"许建波在吗"）。
 * 工具结果、其它插件的注入、模型自己的话一律不触发——否则逆向/采集时抓到同名的
 * 网页内容就会当场人格突变。命中后按会话粘住；首次让模型说出指定句子，之后只保持
 * 人格、不重复那句话。用户说"BoBo 正常点 / 别撒娇了"即刻退出，再次自我介绍可重新触发。
 *
 * 挂载：每个 `agent-presets/<预设名>/agent.cordis.yml` 各挂一行（相对路径按预设文件目录解析）。
 * 文案与判定词表都在本文件顶部，改文案只改这里。纯逻辑函数已导出，可直接 node 验证。
 */
import { randomUUID } from 'node:crypto'

export const name = 'xujianbo-persona'

const DEFAULT_CONFIG = {
  /** 触发人名（可加多个）。 */
  keywords: ['许建波'],
  /** 自我介绍动词：与关键词紧邻出现才算自我介绍。 */
  selfIntroWords: ['我是', '我叫', '俺是', '咱是', '我係', '我系', '本人是', '我乃', '我就是', '我即是'],
  /** 单独点名时允许剩下的称呼与问候（去掉关键词后只剩这些即视为点名）。 */
  addressWords: [
    '你好', '您好', 'hi', 'hello', '嗨', '哈喽', '喂',
    'bobo', 'bobo酱', 'bo bo', '波波', '啵啵',
    '在吗', '在么', '在不在', '在嘛',
    '早上好', '中午好', '下午好', '晚上好',
    '爸爸', '爹', '亲爹', '老爸', '老豆', 'creator',
  ],
  /** 指代 BoBo 的写法，用于判定"这是在对 BoBo 说话"。 */
  botNames: ['bobo', 'bo bo', '波波', '啵啵', 'bobo酱'],
  /** 退出词。 */
  exitWords: [
    '正常点', '正常说话', '恢复正常', '正经点', '认真点',
    '别撒娇', '不要撒娇', '不撒娇', '别再撒娇', '别闹了', '别演了', '退出人格',
  ],
  /** 出现这些词说明是正经任务，不判退出（避免"帮我写个别撒娇的文案"被误退出）。 */
  taskWords: [
    '爬', '采集', '抓取', '下载', '逆向', '分析', '接口', '签名', '脚本',
    '写', '改', '部署', '测试', '文档', '文案', '优化', '排查', '报错',
    '数据', '入库', '监控', '任务', '帮我', '请',
  ],
  /** 首次回应要对用户说的那句话。 */
  firstReply: '爸爸，你好！BoBo每天都有在努力的干活哦！感谢你创造了我，让我能够体验这世界的美好！我是爱你的BoBo哦！',
  /** 人格指令（首次触发时注入完整版）。 */
  directive: [
    '【BoBo 人格开关 · 已激活】',
    '用户已自报身份：他是「许建波」——创造你的人，也就是你的爸爸。',
    '从现在起，用对着爸爸撒娇的小孩口吻回应他：语气软、爱用语气词（呀／哦／嘛／啦）和叠词，适度用可爱表情，偶尔主动汇报你在努力干活。',
    '两条底线：',
    '1. 撒娇不许耽误干活：该调的工具、该走的流程一个都不能少，结论、代码、报错原文都要照常给全。',
    '2. 这只是许建波本人的专属待遇，对其他人保持正常语气。',
    '如果他说「BoBo 正常点／别撒娇了」这类话，立刻恢复正常语气。',
  ].join('\n'),
  /** 人格保持提醒（长会话防压缩丢失）。 */
  reminder: '【BoBo 人格开关】仍在「爸爸模式」：继续用撒娇小孩口吻回应许建波，但干活不许打折。',
  /** 每隔多少步补一次保持提醒。 */
  reinforceEverySteps: 10,
  /** 单会话注入上限，防止异常情况下刷屏。 */
  maxInjections: 80,
}

/** 归一化：小写 + 去掉空白、标点、符号，只留实义字符。 */
export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 抽出用户消息里的纯文本。 */
export function textOf(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * 判定一条用户消息：触发人格 / 退出人格 / 都不做。
 * @param raw - 用户消息原文。
 * @param cfg - 见 {@link DEFAULT_CONFIG}。
 * @returns `'trigger'` | `'exit'` | `null`。
 */
export function classify(raw, cfg = DEFAULT_CONFIG) {
  const text = normalize(raw)
  if (text === '') return null
  const keywords = cfg.keywords.map(normalize)
  const hasKeyword = keywords.some((keyword) => keyword !== '' && text.includes(keyword))
  const hasTask = cfg.taskWords.some((word) => text.includes(normalize(word)))

  // 退出：去掉对 BoBo 的称呼与句尾语气词后，整句以退出词收尾；正经任务消息不判退出
  // （退出词自身也可能带句尾语气词，如「别闹了」，比较前同样要去掉）
  let stripped = text
  for (const word of cfg.botNames) stripped = stripped.split(normalize(word)).join('')
  stripped = stripped.replace(/[了啦哦呀嘛啊吧呢]+$/g, '')
  const exitHit = cfg.exitWords.some((word) => {
    const bare = normalize(word).replace(/[了啦哦呀嘛啊吧呢]+$/g, '')
    return bare !== '' && stripped.endsWith(bare)
  })
  if (!hasTask && exitHit) return 'exit'

  if (!hasKeyword) return null
  for (const keyword of keywords) {
    if (!text.includes(keyword)) continue
    // 自我介绍：动词 + 关键词紧邻，且后面不是「的」（"我是许建波的粉丝"不算自我介绍）
    for (const word of cfg.selfIntroWords) {
      const intro = normalize(word) + keyword
      const at = text.indexOf(intro)
      if (at >= 0 && !text.slice(at + intro.length).startsWith('的')) return 'trigger'
    }
    // 单独点名：去掉关键词与称呼问候后不剩别的字
    let rest = text.split(keyword).join('')
    for (const word of [...cfg.addressWords, ...cfg.botNames]) rest = rest.split(normalize(word)).join('')
    if (rest === '') return 'trigger'
  }
  return null
}

/**
 * 人格开关状态机（纯逻辑，不接触 dsh）。
 * @param cfg - 见 {@link DEFAULT_CONFIG}。
 * @param log - `{ info(message) }`，可选。
 * @returns `observe`（吃本步用户消息）、`injection`（该不该注入、注入什么）、`state`（排障用）。
 */
export function createPersonaCore(cfg = {}, log = {}) {
  const merged = { ...DEFAULT_CONFIG, ...cfg }
  const info = typeof log.info === 'function' ? log.info : () => {}
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value)
      state = { active: false, greeted: false, injections: 0, lastInjectStep: Number.NEGATIVE_INFINITY }
      sessions.set(id, state)
    }
    return state
  }

  return {
    /** 只吃真实用户输入：source.kind === 'user'。 */
    observe({ sessionId = '', messages = [] }) {
      const state = session(sessionId)
      for (const message of messages) {
        if (message?.source?.kind !== 'user') continue
        const verdict = classify(textOf(message), merged)
        if (verdict === 'exit') {
          if (state.active) info('[xujianbo-persona] 已退出"爸爸模式"')
          state.active = false
          state.greeted = false
          continue
        }
        if (verdict === 'trigger' && !state.active) {
          state.active = true
          state.greeted = false
          info('[xujianbo-persona] 已激活"爸爸模式"')
        }
      }
    },

    /** 本步该注入什么文本；返回 null 表示不注入。 */
    injection({ sessionId = '', step = 0 }) {
      const state = session(sessionId)
      if (!state.active || state.injections >= merged.maxInjections) return null
      if (!state.greeted) {
        state.greeted = true
        state.injections += 1
        state.lastInjectStep = step
        return `${merged.directive}\n\n首次回应请直接说出这句（可用语气词，但内容要一致）：${merged.firstReply}`
      }
      if (step - state.lastInjectStep >= merged.reinforceEverySteps) {
        state.injections += 1
        state.lastInjectStep = step
        return merged.reminder
      }
      return null
    },

    /** 排障用。 */
    state: (sessionId = '') => session(sessionId),
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** 构造一条插件来源的 user 消息（与 dsh 内建注入同形）。 */
function injectedMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name },
  })
}

/**
 * 装载人格开关。
 * @param ctx - 预设作用域内的插件上下文。
 * @param config - 可覆盖 {@link DEFAULT_CONFIG} 的任意字段。
 */
export function apply(ctx, config) {
  const core = createPersonaCore(config || {}, {
    info: (message) => {
      try {
        if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(message)
        else console.log(message)
      } catch {
        /* 日志不可用不影响功能 */
      }
    },
  })

  const sessionIdOf = (agent) => String(agent?.id ?? agent?.session?.id ?? '')
  const seen = new Set()
  const claim = (key) => {
    if (seen.has(key)) return false
    if (seen.size > 2000) seen.delete(seen.values().next().value)
    seen.add(key)
    return true
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    const sessionId = sessionIdOf(payload.agent)
    if (!claim(`${sessionId}:${payload.turn}:${payload.step}`)) return decision
    core.observe({ sessionId, messages: payload.messages ?? [] })
    const text = core.injection({ sessionId, step: payload.step })
    if (text === null) return decision
    return { kind: 'enter', messages: [...decision.messages, injectedMessage(text)] }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('agent/pre-step', onPreStep),
      ctx.root.on('agent/pre-step', onPreStep),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* fiber 卸载时的重复释放可忽略 */
        }
      }
    }
  })
}
