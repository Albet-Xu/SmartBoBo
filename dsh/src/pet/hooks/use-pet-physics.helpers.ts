import type { PetGeometry, PetVelocity, PhysicsParams } from 'dsh-pet-component'

/**
 * 宿主侧甩动物理：松手估速、边界换算与飞行积分（纯函数，窗口移动在 `use-pet-physics.ts`）。
 *
 * dsh-pet-component 只负责「请求甩出 + 即时几何 + 参数校验」，物理全在宿主（见组件
 * `docs/spec/pet-interactions.md` 的职责划分）。这里逐条对齐组件参考实现的
 * `playground/src/physics.ts`，单位与组件一致：**CSS px 与 CSS px/s**；桌宠宿主把舞台
 * 换成显示器工作区（见 `use-pet-physics.ts` 的坐标换算）。
 */

/** 一次拖拽采样：`t` 是 `performance.now()` 毫秒，`x`/`y` 是窗口的 CSS px 位置。 */
export interface DragSample {
  t: number
  x: number
  y: number
}

/** 飞行状态：位置 + 速度（`PetVelocity` 是组件协议里的最终绝对速度）。 */
export interface ThrowState extends PetVelocity {
  x: number
  y: number
}

/** 飞行边界（舞台坐标系的左上/右下 AABB）。 */
export interface ThrowBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 一帧积分结果：`landed`/`impactSpeed` 用来触发落地 Q 弹（`pet.squash`）。 */
export interface ThrowStep extends ThrowState {
  atRest: boolean
  landed: boolean
  impactSpeed: number
}

/**
 * 松手估速：端点均速与分段峰值各占一半，末段加速再给最多 60% 增益，最后指数软限速
 * 并乘 `throwPower`。轨迹太旧（末尾样本早于 150ms 前）、跨度不足 20ms、或结果低于
 * 500 CSS px/s 时返回 null —— 宿主据此判断「这一下不甩」，组件侧没有补偿逻辑。
 */
export function estimateReleaseVelocity(trail: readonly DragSample[], now: number, throwPower: number): PetVelocity | null {
  const recent = trail.filter(sample => sample.t >= now - 150)
  const first = recent[0]
  const last = recent.at(-1)
  if (!first || !last || now - last.t > 150 || last.t - first.t < 20)
    return null

  const dt = (last.t - first.t) / 1000
  const vx = (last.x - first.x) / dt
  const vy = (last.y - first.y) / dt
  const baseSpeed = Math.hypot(vx, vy)
  if (baseSpeed < 1e-6)
    return null

  // 相邻样本间隔够大才算一段：端点均速会把「拖到一半突然甩出去」摊平，分段峰值补回来。
  const segments: { speed: number, end: number }[] = []
  let previous = first
  for (const sample of recent.slice(1)) {
    if (sample.t - previous.t >= 8) {
      segments.push({
        speed: Math.hypot(sample.x - previous.x, sample.y - previous.y) / (sample.t - previous.t) * 1000,
        end: sample.t,
      })
      previous = sample
    }
  }

  const peak = segments.length > 0 ? Math.max(...segments.map(segment => segment.speed)) : baseSpeed
  const startSegment = segments[0]
  const endSegment = segments.at(-1)
  // 末段相对首段加速得越猛，甩得越远（8000 px/s² 及以上给满增益，上限 +60%）。
  const acceleration = startSegment && endSegment && segments.length >= 2
    ? (endSegment.speed - startSegment.speed) / Math.max((endSegment.end - startSegment.end) / 1000, 0.02)
    : 0
  const beforeClamp = (baseSpeed * 0.5 + peak * 0.5) * (1 + Math.min(1, Math.max(0, acceleration) / 8000) * 0.6)
  const speed = 3600 * (1 - Math.exp(-beforeClamp / 3600)) * throwPower
  if (speed < 500)
    return null

  return { vx: vx / baseSpeed * speed, vy: vy / baseSpeed * speed }
}

/**
 * 把组件给的几何换算成飞行边界（舞台本地坐标）。
 *
 * 横向按真实 hitbox（`geometry.body`）算：透明边可以出界，宠物本体不出界。纵向的
 * 「脚底」按渲染器分：dsh 的 video 高 360 里只有 330 是本体，底部 30 是留白，贴地
 * 用几何高度而不是 hitbox；codex 的 hitbox 底边就是脚底。
 */
export function bodyBounds(geometry: PetGeometry, width: number, height: number, dsh: boolean): ThrowBounds {
  const feet = dsh ? geometry.height * 330 / 360 : geometry.body.bottom - geometry.y
  return {
    minX: -(geometry.body.left - geometry.x),
    maxX: width - (geometry.body.right - geometry.x),
    minY: 0,
    maxY: height - feet,
  }
}

/**
 * 推进一帧飞行：重力 + 位移 + 左右墙（与可选天花板）反弹 + 落地与地面摩擦。
 *
 * `dt` 夹在 50ms 以内：窗口最小化、系统卡顿后 `delta` 可能是一大跳，按真实间隔积分
 * 会直接穿墙。落地判定要看**积分前**的 `state.y`（这一帧是否跨过地面），`impactSpeed`
 * 也取积分前的下坠速度 —— 落地 Q 弹的力度是撞击瞬间的，不是衰减后的。
 */
export function stepThrow(state: ThrowState, delta: number, bounds: ThrowBounds, physics: PhysicsParams): ThrowStep {
  const dt = Math.min(0.05, Math.max(0, delta))
  const maxX = Math.max(bounds.minX, bounds.maxX)
  const maxY = Math.max(bounds.minY, bounds.maxY)
  let { x, y, vx, vy } = state
  let bounced = false

  vy += physics.gravity * dt
  x += vx * dt
  y += vy * dt

  if (maxX === bounds.minX) {
    // 舞台比宠物本体还窄（畸形几何）：横向钉住，别让它左右抖。
    x = maxX
    vx = 0
  }
  else if (x < bounds.minX) {
    x = bounds.minX
    vx = Math.abs(vx) * physics.restitution
    bounced = true
  }
  else if (x > maxX) {
    x = maxX
    vx = -Math.abs(vx) * physics.restitution
    bounced = true
  }

  // 天花板默认反弹；`ceilingBounce: false` 时不夹顶，让宠物自然划过屏幕上方。
  if (y < bounds.minY && physics.ceilingBounce) {
    y = bounds.minY
    vy = Math.abs(vy) * physics.restitution
    bounced = true
  }

  const landed = state.y < maxY - 1 && y >= maxY
  const impactSpeed = Math.abs(state.vy)

  if (y >= maxY) {
    y = maxY
    // 竖直速度太小直接停住：否则会在地面上无限微弹。
    vy = Math.abs(vy) < 40 ? 0 : -Math.abs(vy) * physics.restitution
    // 地面摩擦只削横向速度，且按帧长换算（帧率无关）。
    vx *= Math.max(0, 1 - physics.groundFriction * dt)
    bounced = true
  }

  if (maxY === bounds.minY) {
    // 舞台比宠物还矮：贴地且不弹。
    y = maxY
    vy = 0
  }

  const atRest = (y >= maxY - 1 && Math.abs(vx) < 15 && Math.abs(vy) < 1)
    || (bounced && Math.hypot(vx, vy) < 40 && Math.abs(vy) < 1)

  return { x, y, vx, vy, atRest, landed, impactSpeed }
}
