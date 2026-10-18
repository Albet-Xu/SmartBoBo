import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showNativeNotification } from './native'

/** 一次 `new Notification(...)` 的构造参数（宿主补丁就是从这两个参数取值发给壳层的）。 */
interface Construction {
  title: string
  options: Record<string, unknown>
}

const constructions: Construction[] = []
const instances: FakeNotification[] = []

interface FakeActionEvent {
  action?: string
  inputValue?: string | null
}

/** 宿主补丁替换过的 `window.Notification` 替身：记录构造参数并暴露点击/按钮回灌钩子。 */
class FakeNotification {
  static permission = 'granted'
  static requestPermission = () => Promise.resolve('granted')
  readonly tag = ''
  onclick: ((event: Event) => void) | null = null
  onaction: ((event: FakeActionEvent) => void) | null = null

  constructor(title: string, options?: Record<string, unknown>) {
    constructions.push({ title, options: options ?? {} })
    instances.push(this)
  }
}

beforeEach(() => {
  constructions.length = 0
  instances.length = 0
  vi.stubGlobal('Notification', FakeNotification)
})

describe('showNativeNotification', () => {
  it('把通知描述透传成宿主补丁的 options（默认不静音）', () => {
    showNativeNotification({ title: '标题', body: '正文', tag: 'tag-1', sessionId: 's-1' })

    expect(constructions).toEqual([{
      title: '标题',
      options: {
        body: '正文',
        tag: 'tag-1',
        sessionId: 's-1',
        requireInteraction: false,
        silent: false,
      },
    }])
  })

  it('透传 requireInteraction 与 silent', () => {
    showNativeNotification({ title: '标题', body: '正文', tag: 'tag-1', sessionId: 's-1', requireInteraction: true, silent: true })

    expect(constructions[0].options).toMatchObject({ requireInteraction: true, silent: true })
  })

  it('actions 只补写按钮带输入框时才需要的字段', () => {
    showNativeNotification({
      title: '标题',
      body: '正文',
      tag: 'tag-1',
      sessionId: 's-1',
      actions: [
        { id: 'approve', title: '批准' },
        { id: 'reply', title: '回复', input: true, inputPlaceholder: '输入回复内容', inputButtonTitle: '发送' },
      ],
    })

    expect(constructions[0].options.actions).toEqual([
      { action: 'approve', title: '批准' },
      { action: 'reply', title: '回复', input: true, inputPlaceholder: '输入回复内容', inputButtonTitle: '发送' },
    ])
  })

  it('点通知本体回调 onClick', () => {
    const onClick = vi.fn()
    showNativeNotification({ title: '标题', body: '正文', tag: 'tag-1', sessionId: 's-1', onClick })

    instances[0].onclick?.(new Event('click'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('按钮回灌：把空输入折成 null，有文本则原样回传 action id', () => {
    const onAction = vi.fn()
    showNativeNotification({ title: '标题', body: '正文', tag: 'tag-1', sessionId: 's-1', onAction })

    instances[0].onaction?.({ action: 'approve', inputValue: '' })
    instances[0].onaction?.({ action: 'reply', inputValue: '就这样' })

    expect(onAction.mock.calls).toEqual([
      ['approve', null],
      ['reply', '就这样'],
    ])
  })
})
