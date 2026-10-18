/**
 * client/components/extension-panel.utils.test.ts — 活动标签页必须落在现存标签页上。
 *
 * 守一条事故约束（issue #655）：插件市场点「更新」会重载市场插件的客户端 bundle，
 * 它发布的面板服务随之短暂消失、`rows` 里的 `market` 一并消失。活动页若仍是那个
 * 已不存在的 id，面板过滤后一行都不渲染 —— 插件市场变成空白页，且不会自愈。
 */

import { describe, expect, it } from 'vitest'
import { resolveActiveTab } from './extension-panel.utils'

const WITH_MARKET = [{ id: 'market' }, { id: 'skills' }, { id: 'mcp' }]
const WITHOUT_MARKET = [{ id: 'skills' }, { id: 'mcp' }]

describe('resolveActiveTab', () => {
  it('请求的标签页仍在场：原样保持，不跳回第一页', () => {
    expect(resolveActiveTab(WITH_MARKET, 'mcp')).toBe('mcp')
  })

  it('请求的标签页已消失：回落到首个现存标签页，而不是留一个不存在的活动页', () => {
    expect(resolveActiveTab(WITHOUT_MARKET, 'market')).toBe('skills')
  })

  it('只剩一个标签页时回落到它', () => {
    expect(resolveActiveTab([{ id: 'skills' }], 'market')).toBe('skills')
  })

  it('没有任何标签页：返回请求值，不返回 undefined', () => {
    expect(resolveActiveTab([], 'market')).toBe('market')
  })
})
