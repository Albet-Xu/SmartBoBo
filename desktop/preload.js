// BoBo 桌面壳 · preload
// 最小权限桥：目前不向页面开放任何 Node 能力，仅暴露版本信息供诊断。
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('boboDesktop', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
})