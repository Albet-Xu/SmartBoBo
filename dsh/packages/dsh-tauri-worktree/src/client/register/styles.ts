import { mountStyle } from 'dsh-tauri-ui/client'
import { defineRegister } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'
import { WORKTREE_STYLE_ID } from '../constants'
import worktreeStyle from '../styles/index.cssr'

export const stylesFeature = defineRegister((controller) => {
  controller.add(mountStyle(worktreeStyle, WORKTREE_STYLE_ID, PLUGIN_ID))
})
