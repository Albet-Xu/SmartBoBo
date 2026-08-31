// BoBo 桌面壳 · preload
// 最小权限桥：不向页面开放 Node 能力，仅提供诊断版本信息，以及主进程推送上来的启动状态。
// splash.html 通过 window.boboDesktop.onStatus 接收主进程的启动进度文字。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boboDesktop', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  onStatus: (cb) => {
    ipcRenderer.on('bobo-status', (_event, text) => {
      if (typeof cb === 'function') cb(text)
    })
  },
})