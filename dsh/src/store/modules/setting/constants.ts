/** 默认缩放比例（100%），与 Rust `default_zoom_factor` 一致 */
export const ZOOM_FACTOR_DEFAULT = 1
/** 缩放步长，与 Rust `ZOOM_FACTOR_STEP` 一致 */
export const ZOOM_FACTOR_STEP = 0.1
/** 缩放下限，与 Rust `ZOOM_FACTOR_MIN` 一致 */
export const ZOOM_FACTOR_MIN = 0.5
/** 缩放上限，与 Rust `ZOOM_FACTOR_MAX` 一致 */
export const ZOOM_FACTOR_MAX = 2
export const ZOOM_FACTOR_OPTIONS = Array.from(
  { length: Math.round((ZOOM_FACTOR_MAX - ZOOM_FACTOR_MIN) / ZOOM_FACTOR_STEP) + 1 },
  (_, index) => Number((ZOOM_FACTOR_MIN + index * ZOOM_FACTOR_STEP).toFixed(1)),
)
/** 服务内存上限下限（MB），与 Rust `HARNESS_HEAP_MIN_MB` 一致 */
export const HARNESS_HEAP_MIN_MB = 1024
/** 服务内存上限上限（MB），与 Rust `HARNESS_HEAP_MAX_MB` 一致 */
export const HARNESS_HEAP_MAX_MB = 32768
