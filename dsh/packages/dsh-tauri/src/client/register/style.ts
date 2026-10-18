import type { ClientContext } from '../types'
import { defineRegister } from '.'
import { invokeParent } from '../service/invoke-parent'
import { getFrameStyle, getOverlayMarkedStyle, getSidebarStyle } from './style.utils'

export const registerStyle = defineRegister<ClientContext>((controller) => {
  let pendingFrame: number | undefined
  let previous: string | undefined

  function reportSidebarBackground() {
    pendingFrame = undefined
    const message = {
      type: 'dsh://style',
      sidebar: getSidebarStyle(),
      marked: getOverlayMarkedStyle(),
      frame: getFrameStyle(),
      colorScheme: document.documentElement.style.colorScheme,
    } as const
    const serialized = JSON.stringify(message)
    if (serialized === previous)
      return
    if (invokeParent(message).ok)
      previous = serialized
  }

  function scheduleReport() {
    if (pendingFrame === undefined)
      pendingFrame = requestAnimationFrame(reportSidebarBackground)
  }

  // keep:effect 合并流式 DOM 更新的样式读取，并由 controller 回收尚未执行的帧。
  controller.add(() => {
    if (pendingFrame !== undefined)
      cancelAnimationFrame(pendingFrame)
  })
  controller.observe(document.documentElement, scheduleReport, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme'],
  })
  scheduleReport()
})
