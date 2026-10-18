import { cssr } from 'dsh-tauri-ui/client'
import { modelStyles } from './styles'

const { c } = cssr

/**
 * 归档布局所需的本地覆盖。
 *
 * `styles.ts` 逐字对应上游样式，这里只放我们的偏离。
 *
 * 类名重复一次用于提高优先级：css-render 在 `head: true` 挂载时执行
 * `insertBefore(target, parent.querySelector('style, link'))`，后挂载的样式反而排在前面，
 * 同优先级下生成样式会盖掉本文件。重复类名让覆盖不依赖挂载顺序。
 */
export const modelsOverridesNode = c([`
.${modelStyles.modelListHead}.${modelStyles.modelListHead} {
  flex-wrap: wrap;
}

.${modelStyles.modelCatalogHeading}.${modelStyles.modelCatalogHeading} {
  flex: 1 0 auto;
}

.${modelStyles.modelRow}.${modelStyles.modelRow} {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, auto) auto auto;
}

.${modelStyles.modelInputTypes}.${modelStyles.modelInputTypes} {
  grid-column: auto;
  order: 2;
}

.dshp-models-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
`])
