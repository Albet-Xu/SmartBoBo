import type { CNode } from 'css-render'
import { PLUGIN_ID } from '../../shared/constants'

/**
 * 样式标签的归属者属性。
 *
 * 宿主的客户端模块系统（`@deepseek-ai/dsh-client-modules`）在每个插件 factory 物化后调
 * `claimStyles`：把文档里所有**没有 `data-plugin`** 的 `<style>` 盖上「刚物化的那个插件」
 * 的戳；该插件随后重载时 `removeOwnedStyles` 会把它们一并删掉（0.1.6-alpha.2 起）。css-render
 * 只写 `cssr-id`，不自报归属就会被别的插件收养、再被别人的重载误删（issue #655）。
 */
const OWNER_ATTRIBUTE = 'data-plugin'

const mountCounts = new Map<CNode, number>()

function existingElement(id?: string): HTMLStyleElement | null {
  return id === undefined ? null : document.querySelector<HTMLStyleElement>(`style[cssr-id="${id}"]`)
}

/**
 * 挂载一张 cssr 样式表，返回释放函数；同一个 `CNode` 多次挂载只落一个标签。
 * @param cnode - `.cssr.ts` 导出的样式节点。
 * @param id - 样式标签的 `cssr-id`，也是卸载时的唯一凭据；**必须全文档唯一**——同 id 视为同一张表，
 *   挂载时会摘掉旧表另挂，好让活表记在本次挂载的节点名下（否则旧实例卸载会把它摘掉）。
 * @param owner - 归属插件 id，落进 `data-plugin`；默认本插件（本助手由 `dsh-tauri-ui` 提供）。
 */
export function mountStyle(cnode: CNode, id?: string, owner: string = PLUGIN_ID): () => void {
  const release = (): void => {
    const next = (mountCounts.get(cnode) ?? 1) - 1
    if (next <= 0) {
      mountCounts.delete(cnode)
      cnode.unmount({ id })
    }
    else {
      mountCounts.set(cnode, next)
    }
  }
  if (typeof document === 'undefined')
    return () => {}
  const count = mountCounts.get(cnode) ?? 0
  const existing = existingElement(id)
  // 计数不为零也要确认标签还在：宿主回收、别的插件清理、或插件重载时新旧模块实例短暂并存
  // （css-render 遇到同 id 会直接复用并把它记在**旧**节点名下，旧实例卸载时会把它删掉），
  // 都会让这张表消失而计数仍停在 >0——不重挂它在本页生命周期内不会自己回来（issue #655）。
  if (count === 0 || (id !== undefined && existing === null)) {
    existing?.remove()
    cnode.mount({ id, head: true }).setAttribute(OWNER_ATTRIBUTE, owner)
  }
  mountCounts.set(cnode, count + 1)
  return release
}
