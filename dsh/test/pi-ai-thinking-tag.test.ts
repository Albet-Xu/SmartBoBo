// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Codex「思考即文字」补丁的标签扫描器契约。
 *
 * 补丁把扫描器内联进活动核心的 pi-ai 产物，而 pi-ai 不在本仓依赖树里，跑不到真实模块；
 * 于是这里从 `pi_ai_thinking.rs` 的 `LOOP_PATCHED` 常量里取出**同一份**注入源码，
 * 用 pi-ai 同形的 content block 辅助函数喂它，断言事件流与最终 block。
 *
 * 契约：一条助手消息最开头的 `<thinking>…</thinking>` 进 thinking_delta，其后进
 * text_delta；标签允许被流式增量切开；正文里提到标签（标签不在消息最开头）保持文本。
 */

const RUST_PATH = new URL('../src-tauri/src/service/patch/pi_ai_thinking.rs', import.meta.url)
const LOOP_ANCHOR = 'for await (const chunk of openaiStream) {'
const PATCH_MARKER = 'dsh-tauri-desktop: Codex thinking-as-text'

interface TextBlock { type: 'text', text: string }
interface ThinkingBlock { type: 'thinking', thinking: string }
type Block = TextBlock | ThinkingBlock
interface ContentEvent {
  type: 'text_delta' | 'thinking_delta'
  delta: string
  contentIndex: number
  partial: { content: Block[] }
}
interface ScannerDeps {
  stream: { push: (event: ContentEvent) => void }
  output: { content: Block[] }
}
interface Scanner {
  feed: (chunk: string) => void
  flush: () => void
}

/** 从 Rust 常量取出注入源码，与真实产物里跑的是同一段文本。 */
function loadInjectedSource(): string {
  const rust = readFileSync(RUST_PATH, 'utf8')
  const match = /const LOOP_PATCHED: &str = r#"([\s\S]*?)"#;/.exec(rust)
  if (!match)
    throw new Error('pi_ai_thinking.rs：未能从 LOOP_PATCHED 取出注入源码')

  const injected = match[1]
  expect(injected, '注入源码必须带幂等标记').toContain(PATCH_MARKER)

  const bodyEnd = injected.lastIndexOf(LOOP_ANCHOR)
  if (bodyEnd <= 0)
    throw new Error('pi_ai_thinking.rs：注入源码未以流式循环锚点收尾')
  return injected.slice(0, bodyEnd)
}

function createScanner(deps: ScannerDeps, ensureTextBlock: () => TextBlock, ensureThinkingBlock: () => ThinkingBlock, getContentIndex: (block: Block) => number): Scanner {
  // 被测对象是注入进 pi-ai 产物的**源码文本**，只能按源码执行；仓内没有该依赖可导入。
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'ensureTextBlock',
    'ensureThinkingBlock',
    'getContentIndex',
    'stream',
    'output',
    `${loadInjectedSource()}
return { feed: feedThinkingAwareContent, flush: flushThinkingAwareContent }`,
  )
  return factory(ensureTextBlock, ensureThinkingBlock, getContentIndex, deps.stream, deps.output) as Scanner
}

/** pi-ai 产物的同形运行时：单一 text/thinking block + contentIndex = blocks.indexOf。 */
function runtime() {
  const blocks: Block[] = []
  const events: ContentEvent[] = []
  let textBlock: TextBlock | undefined
  let thinkingBlock: ThinkingBlock | undefined

  const scanner = createScanner(
    { stream: { push: event => void events.push(event) }, output: { content: blocks } },
    () => {
      textBlock ??= { type: 'text', text: '' }
      if (!blocks.includes(textBlock))
        blocks.push(textBlock)
      return textBlock
    },
    () => {
      thinkingBlock ??= { type: 'thinking', thinking: '' }
      if (!blocks.includes(thinkingBlock))
        blocks.push(thinkingBlock)
      return thinkingBlock
    },
    block => blocks.indexOf(block),
  )

  return {
    feedAll: (chunks: string[]) => chunks.forEach(scanner.feed),
    flush: scanner.flush,
    blocks,
    deltas: () => events.map(({ type, delta }) => ({ type, delta })),
    contentIndexes: () => events.map(({ contentIndex }) => contentIndex),
  }
}

describe('pi-ai thinking tag scanner', () => {
  it('routes a leading fence split across chunks into thinking, then the answer into text', () => {
    const run = runtime()
    run.feedAll(['<thin', 'king>reaso', 'ning</thin', 'king>the ', 'answer'])
    run.flush()

    expect(run.deltas()).toEqual([
      { type: 'thinking_delta', delta: 'reaso' },
      { type: 'thinking_delta', delta: 'ning' },
      { type: 'text_delta', delta: 'the ' },
      { type: 'text_delta', delta: 'answer' },
    ])
    // 事件索引与 block 顺序一致：思考块 0、正文块 1。
    expect(run.contentIndexes()).toEqual([0, 0, 1, 1])
    expect(run.blocks).toEqual([
      { type: 'thinking', thinking: 'reasoning' },
      { type: 'text', text: 'the answer' },
    ])
  })

  it('leaves a message without a fence as a single text block', () => {
    const run = runtime()
    run.feedAll(['just ', 'an answer'])
    run.flush()

    expect(run.deltas()).toEqual([
      { type: 'text_delta', delta: 'just ' },
      { type: 'text_delta', delta: 'an answer' },
    ])
    expect(run.blocks).toEqual([{ type: 'text', text: 'just an answer' }])
  })

  it('keeps a fence mentioned after the message head as literal text', () => {
    const run = runtime()
    run.feedAll(['write ', '<thinking>', ' to open', '</thinking>', ' a block'])
    run.flush()

    expect(run.deltas()).toEqual([
      { type: 'text_delta', delta: 'write ' },
      { type: 'text_delta', delta: '<thinking>' },
      { type: 'text_delta', delta: ' to open' },
      { type: 'text_delta', delta: '</thinking>' },
      { type: 'text_delta', delta: ' a block' },
    ])
    expect(run.blocks).toEqual([{ type: 'text', text: 'write <thinking> to open</thinking> a block' }])
  })

  it('keeps a code fence at the message head as literal text', () => {
    const run = runtime()
    run.feedAll(['```xml\n', '<thinking>', 'x</thinking>\n```'])
    run.flush()

    expect(run.deltas()).toEqual([
      { type: 'text_delta', delta: '```xml\n' },
      { type: 'text_delta', delta: '<thinking>' },
      { type: 'text_delta', delta: 'x</thinking>\n```' },
    ])
    expect(run.blocks).toEqual([{ type: 'text', text: '```xml\n<thinking>x</thinking>\n```' }])
  })

  it('accepts leading whitespace before the opening tag and drops it', () => {
    const run = runtime()
    run.feedAll(['\n\n', '<thinking>', 'reasoned'])
    run.flush()

    expect(run.deltas()).toEqual([{ type: 'thinking_delta', delta: 'reasoned' }])
    expect(run.blocks).toEqual([{ type: 'thinking', thinking: 'reasoned' }])
  })

  it('flushes an unclosed fence as thinking at stream end', () => {
    const run = runtime()
    run.feedAll(['<thinking>', 'half a thought'])
    run.flush()

    // 尾缓冲最多留 10 个字符（`</thinking>` 长度减一），因此末尾增量可能被切成两段。
    expect(run.deltas()).toEqual([
      { type: 'thinking_delta', delta: 'half' },
      { type: 'thinking_delta', delta: ' a thought' },
    ])
    expect(run.blocks).toEqual([{ type: 'thinking', thinking: 'half a thought' }])
  })

  it('emits nothing for an empty stream', () => {
    const run = runtime()
    run.flush()

    expect(run.deltas()).toEqual([])
    expect(run.blocks).toEqual([])
  })
})
