/**
 * client/utils/style.test.ts — cssr 样式表的挂载与归属契约。
 *
 * 单元车道没有 DOM，这里按 `mountStyle` 真正用到的那一小块表面（`document.head` /
 * `createElement` / `querySelector` / `insertBefore` / `removeChild`）搭一个替身；
 * 断言对象是**文档里有哪些标签、标签带什么属性**，与实现无关。
 *
 * 守 issue #655 的两条链路：
 * - 标签必须自报 `data-plugin` 归属，否则会被宿主的 `claimStyles` 认领给下一个物化的
 *   插件，再被那个插件的重载 `removeOwnedStyles` 一并删除；
 * - 同 id 的旧表必须换成新节点自己的活表，否则旧模块实例卸载时会把新实例刚复用的那张
 *   删掉（css-render 只删「记在自己 `els` 里的表」），而引用计数还停在 >0，样式永不回挂。
 */

import type { CNode } from 'css-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cssr } from './cssr'
import { mountStyle } from './style'

const STYLE_ID = 'dsh-tauri-ui-test-styles'
const OWNER = 'dsh-tauri-ui-test-owner'

class FakeStyleElement {
  textContent = ''
  parentElement: FakeHead | null = null
  private readonly attributes = new Map<string, string>()

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }
}

class FakeHead {
  readonly children: FakeStyleElement[] = []

  create(): FakeStyleElement {
    return new FakeStyleElement()
  }

  querySelector(selector: string): FakeStyleElement | null {
    if (selector === 'style, link')
      return this.children[0] ?? null
    const match = /^style\[cssr-id="(.+)"\]$/.exec(selector)
    if (match === null)
      return null
    return this.children.find(child => child.getAttribute('cssr-id') === match[1]) ?? null
  }

  insertBefore(node: FakeStyleElement, reference: FakeStyleElement | null): void {
    const index = reference === null ? -1 : this.children.indexOf(reference)
    if (index < 0)
      this.children.push(node)
    else
      this.children.splice(index, 0, node)
    node.parentElement = this
  }

  removeChild(node: FakeStyleElement): void {
    const index = this.children.indexOf(node)
    if (index >= 0)
      this.children.splice(index, 1)
    node.parentElement = null
  }
}

function installFakeDocument(): FakeHead {
  const head = new FakeHead()
  vi.stubGlobal('document', {
    head,
    createElement: () => head.create(),
    querySelector: (selector: string) => head.querySelector(selector),
  })
  return head
}

/** 每个用例用独立节点：`mountCounts` 按节点身份记数，模块级状态不跨用例串味。 */
function styleNode(): CNode {
  return cssr.c('div', { color: 'red' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mountStyle', () => {
  it('挂载后样式标签自报 data-plugin 归属，释放时摘掉', () => {
    const head = installFakeDocument()
    const release = mountStyle(styleNode(), STYLE_ID, OWNER)

    expect(head.children).toHaveLength(1)
    expect(head.children[0]?.getAttribute('data-plugin')).toBe(OWNER)

    release()
    expect(head.children).toHaveLength(0)
  })

  it('同一个节点重复挂载只落一张表，最后一个消费者释放时才摘掉', () => {
    const head = installFakeDocument()
    const node = styleNode()
    const first = mountStyle(node, STYLE_ID, OWNER)
    const second = mountStyle(node, STYLE_ID, OWNER)

    expect(head.children).toHaveLength(1)

    first()
    expect(head.children, '还有消费者持有，不得摘表').toHaveLength(1)

    second()
    expect(head.children).toHaveLength(0)
  })

  it('标签被外部删掉后再次挂载会补回来，不留「计数非零但样式缺席」', () => {
    const head = installFakeDocument()
    const node = styleNode()
    mountStyle(node, STYLE_ID, OWNER)
    head.children[0]?.remove()
    expect(head.children).toHaveLength(0)

    mountStyle(node, STYLE_ID, OWNER)

    expect(
      head.querySelector(`style[cssr-id="${STYLE_ID}"]`),
      '样式必须在文档里，而不是只在引用计数里',
    ).not.toBeNull()
  })

  it('插件重载：旧实例遗留的同 id 表被换成新节点的活表，旧实例卸载摘不掉它', () => {
    const head = installFakeDocument()
    const stale = mountStyle(styleNode(), STYLE_ID, OWNER)
    const fresh = mountStyle(styleNode(), STYLE_ID, OWNER)
    expect(head.children).toHaveLength(1)

    // 旧实例的清理晚于新实例的挂载：css-render 只删「记在自己 els 里的那张表」，
    // 新实例必须先把手里的表换成文档里的活表，否则这一删就再也回不来。
    stale()
    expect(
      head.querySelector(`style[cssr-id="${STYLE_ID}"]`),
      '新实例的活表不得被旧实例摘掉',
    ).not.toBeNull()
    expect(head.children[0]?.getAttribute('data-plugin')).toBe(OWNER)

    fresh()
    expect(head.children).toHaveLength(0)
  })
})
