import type { PhysicsParams } from 'dsh-pet-component'
import type { DragSample } from './use-pet-physics.helpers'
import { describe, expect, it } from 'vitest'
import { bodyBounds, estimateReleaseVelocity, stepThrow } from './use-pet-physics.helpers'

/** 组件默认参数（`dsh-pet-component` 的 `PhysicsParams` 默认值）。 */
const PHYSICS: PhysicsParams = {
  gravity: 1400,
  restitution: 0.78,
  groundFriction: 2.5,
  ceilingBounce: true,
  throwPower: 1,
  petCollision: false,
}

/** 无重力无摩擦的参数：把「位移/边界」与「重力/摩擦」分开验证。 */
const FREE: PhysicsParams = { ...PHYSICS, gravity: 0, groundFriction: 0 }

/** 足够大的舞台：不触发任何边界分支。 */
const OPEN = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }

/** 按端点均速/峰值各半后指数软限速算出的期望速度（与实现同式，用来锚定量级）。 */
function softCapped(speed: number): number {
  return 3600 * (1 - Math.exp(-speed / 3600))
}

describe('estimateReleaseVelocity', () => {
  it('向右甩的松手给出正 vx，方向按位移归一化', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 100 },
      { t: 40, x: 200, y: 100 },
      { t: 80, x: 400, y: 100 },
      { t: 120, x: 600, y: 100 },
    ]

    const velocity = estimateReleaseVelocity(trail, 140, 1)

    // 端点均速 5000 px/s，分段峰值同为 5000，软限速后约 2702 px/s（上限 3600）。
    expect(velocity?.vx).toBeCloseTo(softCapped(5000), 4)
    expect(velocity?.vy).toBe(0)
  })

  it('向左甩的松手给出负 vx', () => {
    const trail: DragSample[] = [
      { t: 0, x: 1000, y: 100 },
      { t: 100, x: 0, y: 100 },
    ]

    expect(estimateReleaseVelocity(trail, 110, 1)?.vx).toBeLessThan(0)
  })

  it('低于 500 CSS px/s 的松手不甩（返回 null）', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 100 },
      { t: 100, x: 10, y: 100 },
    ]

    expect(estimateReleaseVelocity(trail, 110, 1)).toBeNull()
  })

  it('末尾样本早于 150ms 前时返回 null（松手时刻已经过时）', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 2000, y: 0 },
    ]

    expect(estimateReleaseVelocity(trail, 400, 1)).toBeNull()
  })

  it('轨迹跨度不足 20ms 时返回 null（采不出方向）', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 100, y: 0 },
    ]

    expect(estimateReleaseVelocity(trail, 15, 1)).toBeNull()
  })

  it('速度有硬上限：再快的甩动也不会超过 3600 CSS px/s', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 25, x: 10000, y: 0 },
    ]

    const velocity = estimateReleaseVelocity(trail, 30, 1)

    expect(Math.hypot(velocity?.vx ?? 0, velocity?.vy ?? 0)).toBeLessThanOrEqual(3600)
    expect(Math.hypot(velocity?.vx ?? 0, velocity?.vy ?? 0)).toBeGreaterThan(3500)
  })

  it('throwPower 线性缩放最终速度', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 100 },
      { t: 100, x: 1000, y: 100 },
    ]

    const half = estimateReleaseVelocity(trail, 110, 0.5)
    const full = estimateReleaseVelocity(trail, 110, 1)

    expect(half?.vx).toBeCloseTo((full?.vx ?? 0) / 2, 6)
  })

  it('完全静止的轨迹返回 null（拖到一半停住再松手不甩）', () => {
    const trail: DragSample[] = [
      { t: 0, x: 300, y: 100 },
      { t: 50, x: 300, y: 100 },
      { t: 100, x: 300, y: 100 },
    ]

    expect(estimateReleaseVelocity(trail, 110, 1)).toBeNull()
  })
})

describe('bodyBounds', () => {
  it('dsh 用几何高度里 330/360 的贴地锚点算脚底（video 底部 30 是留白）', () => {
    const bounds = bodyBounds(
      { x: 0, y: 0, width: 100, height: 360, body: { left: 10, top: 0, right: 90, bottom: 360 } },
      800,
      1000,
      true,
    )

    expect(bounds).toEqual({ minX: -10, maxX: 710, minY: 0, maxY: 1000 - 330 })
  })

  it('codex 用真实 hitbox 的底边算脚底', () => {
    const bounds = bodyBounds(
      { x: 5, y: 20, width: 100, height: 300, body: { left: 15, top: 20, right: 95, bottom: 300 } },
      800,
      1000,
      false,
    )

    expect(bounds).toEqual({ minX: -10, maxX: 710, minY: 0, maxY: 1000 - 280 })
  })
})

describe('stepThrow', () => {
  it('重力让下坠速度逐帧增大，水平速度不受影响', () => {
    const next = stepThrow({ x: 0, y: 0, vx: 100, vy: 0 }, 0.016, OPEN, PHYSICS)

    expect(next.vy).toBeCloseTo(1400 * 0.016, 6)
    expect(next.vx).toBeCloseTo(100, 6)
    expect(next.x).toBeCloseTo(100 * 0.016, 6)
  })

  it('左墙夹回边界并反向衰减横向速度', () => {
    const next = stepThrow({ x: 0, y: 500, vx: -1000, vy: 0 }, 0.016, { ...OPEN, minX: 0, maxY: 900 }, FREE)

    expect(next.x).toBe(0)
    expect(next.vx).toBeCloseTo(1000 * 0.78, 6)
  })

  it('右墙夹回边界并反向衰减横向速度', () => {
    const next = stepThrow({ x: 100, y: 500, vx: 1000, vy: 0 }, 0.016, { ...OPEN, maxX: 100, maxY: 900 }, FREE)

    expect(next.x).toBe(100)
    expect(next.vx).toBeCloseTo(-1000 * 0.78, 6)
  })

  it('ceilingBounce 关闭时不夹天花板，宠物可以划过屏幕上方', () => {
    const next = stepThrow({ x: 0, y: 10, vx: 0, vy: -1000 }, 0.016, { ...OPEN, minY: 0 }, { ...FREE, ceilingBounce: false })

    expect(next.y).toBeCloseTo(10 - 16, 6)
    expect(next.vy).toBeCloseTo(-1000, 6)
  })

  it('ceilingBounce 开启时天花板反弹', () => {
    const next = stepThrow({ x: 0, y: 10, vx: 0, vy: -1000 }, 0.016, { ...OPEN, minY: 0 }, FREE)

    expect(next.y).toBe(0)
    expect(next.vy).toBeCloseTo(1000 * 0.78, 6)
  })

  it('跨过地面的那一帧才算落地，撞击速度取积分前的下坠速度', () => {
    const next = stepThrow({ x: 0, y: 90, vx: 0, vy: 1000 }, 0.016, { ...OPEN, maxY: 100 }, FREE)

    expect(next.landed).toBe(true)
    expect(next.impactSpeed).toBe(1000)
    expect(next.y).toBe(100)
    expect(next.vy).toBeCloseTo(-1000 * 0.78, 6)
  })

  it('已经贴地滑动的一帧不算落地（不会连续触发 Q 弹）', () => {
    const next = stepThrow({ x: 0, y: 100, vx: 500, vy: 0 }, 0.016, { ...OPEN, maxY: 100 }, FREE)

    expect(next.landed).toBe(false)
  })

  it('下坠速度小于 40 px/s 时贴地停住，不再弹', () => {
    const next = stepThrow({ x: 0, y: 99.5, vx: 0, vy: 10 }, 0.05, { ...OPEN, maxY: 100 }, FREE)

    expect(next.y).toBe(100)
    expect(next.vy).toBe(0)
  })

  it('地面摩擦按帧长削减横向速度', () => {
    const next = stepThrow({ x: 0, y: 100, vx: 1000, vy: 0 }, 0.05, { ...OPEN, maxY: 100 }, { ...FREE, groundFriction: 2.5 })

    expect(next.vx).toBeCloseTo(1000 * (1 - 2.5 * 0.05), 6)
  })

  it('贴地且速度极小时进入静止态（宿主据此停掉飞行循环）', () => {
    const next = stepThrow({ x: 0, y: 100, vx: 1, vy: 0 }, 0.016, { ...OPEN, maxY: 100 }, FREE)

    expect(next.atRest).toBe(true)
  })

  it('单帧步长上限 50ms：切回前台的一大跳不会穿墙', () => {
    const next = stepThrow({ x: 0, y: 0, vx: 100, vy: 0 }, 5, OPEN, FREE)

    expect(next.x).toBeCloseTo(100 * 0.05, 6)
  })

  it('舞台比宠物本体还窄时横向钉住（畸形几何不抖）', () => {
    const next = stepThrow({ x: 0, y: 500, vx: 800, vy: 0 }, 0.016, { minX: 50, minY: 0, maxX: 50, maxY: 900 }, FREE)

    expect(next.x).toBe(50)
    expect(next.vx).toBe(0)
  })
})
