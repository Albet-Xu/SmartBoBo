import { ZOOM_FACTOR_DEFAULT, ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN, ZOOM_FACTOR_STEP } from '../constants'

export function normalizeZoomFactor(value: number): number {
  if (!Number.isFinite(value))
    return ZOOM_FACTOR_DEFAULT
  const grid = 1 / ZOOM_FACTOR_STEP
  const clamped = Math.min(Math.max(value, ZOOM_FACTOR_MIN), ZOOM_FACTOR_MAX)
  return Math.round(clamped * grid) / grid
}
