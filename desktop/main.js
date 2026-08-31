// BoBo 桌面壳 · 主进程
// 职责：用 Electron 自带 Node 拉起 dsh 后端与 DBX 数据库面板，再开一个原生窗口
// 加载本机 dsh Web（http://127.0.0.1:7070）。关闭窗口时回收全部子进程。
const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')

const isDev = !app.isPackaged
// 打包后运行时载荷位于 resources/runtime；开发时直接用仓库根目录。
const projectRoot = isDev
  ? path.resolve(__dirname, '..')
  : path.join(process.resourcesPath, 'runtime')

const dshDir = path.join(projectRoot, 'dsh')
const dbxDir = path.join(projectRoot, 'dbx-runtime')
const dbxBin = path.join(dbxDir, 'dbx-web.exe')
// dsh 需要 Node ^22.19 / >=24；Electron 内置 Node 20 太老，所以后端用随包附带的
// 便携 Node（开发模式下直接用系统 node）。
const nodeBin = isDev
  ? 'node'
  : path.join(process.resourcesPath, 'node', 'node.exe')

let backendProc = null
let dbxProc = null
let win = null

/** 向启动窗口推送进度文字（splash.html 通过 preload 的 onStatus 接收）。 */
function status(text) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send('bobo-status', text)
  } catch {
    /* 窗口尚未就绪时忽略 */
  }
}

function setEnv() {
  process.env.BOBO_ROOT = projectRoot
  const venv = path.join(projectRoot, isDev ? '.venv' : '.venv')
  if (isDev) process.env.PYTHON = path.join(venv, 'Scripts', 'python.exe')
  // 打包后 camoufox 用 platformdirs.user_cache_dir("camoufox") 定位内核，
  // 它读取 %LOCALAPPDATA%\camoufox；把 LOCALAPPDATA 指到 payload 根部即可命中
  // 随包带上的 runtime/camoufox。开发模式不覆盖，继续用系统真实的缓存。
  if (!isDev) process.env.LOCALAPPDATA = projectRoot
}

/**
 * 首次运行策略：安装包不带 node_modules 以瘦身，改用内置 Node+pnpm 就地重建。
 * pnpm 在没有符号链接权限的机器上会退回使用目录 junction（无需任何权限）。
 * 关键健壮性：
 *  - 走国内镜像 `registry.npmmirror.com`：默认 npmjs 源在国内常超时/被墙导致安装失败；
 *  - `--ignore-scripts`：跳过 esbuild/lefthook 等需联网下二进制的 postinstall，
 *    运行时已验证无需这些脚本产物也能正常起服务；
 *  - 失败自动用 `--no-frozen-lockfile` 重试一次。
 * 已装好（存在 node_modules/.pnpm）则直接返回；否则执行 pnpm install。
 * @returns whether dependencies are present（或已成功安装）。
 */
function ensureDeps() {
  const nm = path.join(dshDir, 'node_modules')
  if (fs.existsSync(path.join(nm, '.pnpm'))) {
    status('依赖已就绪')
    return Promise.resolve(true)
  }
  const pnpmScript = isDev
    ? 'pnpm'
    : path.join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const baseArgs = ['--registry=https://registry.npmmirror.com/', '--ignore-scripts', '--reporter=append-only']
  const attempt = (extraArgs) => new Promise((resolve) => {
    const depLog = fs.createWriteStream(path.join(app.getPath('userData'), 'bobo-pnpm.log'), { flags: 'a' })
    depLog.write(`\n[first-run] pnpm ${extraArgs.join(' ')} in ${dshDir}\n`)
    const child = spawn(nodeBin, [pnpmScript, ...extraArgs], {
      cwd: dshDir,
      env: { ...process.env, BOBO_ROOT: projectRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.stdout) child.stdout.pipe(depLog)
    if (child.stderr) child.stderr.pipe(depLog)
    child.on('close', (code) => { depLog.end(); resolve(code === 0) })
    child.on('error', () => { depLog.end(); resolve(false) })
  })
  status('首次运行：正在安装依赖（走国内镜像，约 1–3 分钟）…')
  return attempt(['install', '--frozen-lockfile', ...baseArgs])
    .then((ok) => (ok ? true : attempt(['install', ...baseArgs])))
    .then((ok) => {
      status(ok ? '依赖安装完成' : '依赖安装失败：请检查网络后重试（详见日志 bobo-pnpm.log）')
      return ok
    })
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const probe = () => {
      const req = http.request({ host, port, path: '/', timeout: 800 }, () => {
        req.destroy()
        resolve(true)
      })
      req.on('error', () => {
        req.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error(`后端 ${host}:${port} 启动超时`))
        else setTimeout(probe, 500)
      })
      req.on('timeout', () => req.destroy())
      req.end()
    }
    probe()
  })
}

async function launchBackend() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  const logFile = fs.createWriteStream(path.join(app.getPath('userData'), 'bobo-backend.log'), { flags: 'a' })
  const depsOk = await ensureDeps()
  if (!depsOk) {
    logFile.write('[backend] 依赖就绪失败（pnpm install 未成功）\n')
    return
  }
  // 用随包附带的便携 Node 直接拉起 dsh Web（不依赖 pnpm，接收者无需装 Node）
  const env = { ...process.env, BOBO_ROOT: projectRoot }
  const args = [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web',
    '--patch', 'packages/bobo/cordis.patch.yml',
    '--patch', 'patch/web-acquisition.yml',
  ]
  backendProc = spawn(nodeBin, args, {
    cwd: dshDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (backendProc.stdout) backendProc.stdout.pipe(logFile)
  if (backendProc.stderr) backendProc.stderr.pipe(logFile)
  backendProc.on('error', (err) => {
    logFile.write(`[spawn error] ${err.message}\n`)
  })
}

function launchDbx() {
  if (!fs.existsSync(dbxBin)) {
    console.error(`[dbx] 未找到 ${dbxBin}，数据库面板不可用`)
    return
  }
  fs.mkdirSync(path.join(dbxDir, 'data'), { recursive: true })
  dbxProc = spawn(dbxBin, [], {
    env: {
      ...process.env,
      DBX_STATIC_DIR: path.join(dbxDir, 'dist'),
      DBX_DATA_DIR: path.join(dbxDir, 'data'),
      DBX_PORT: '4224',
      DBX_DISABLE_PASSWORD: '1',
    },
    windowsHide: false,
    stdio: 'ignore',
  })
}

function killChildren() {
  for (const p of [backendProc, dbxProc]) {
    if (p && !p.killed) {
      try {
        p.kill()
      } catch {
        /* 进程已退出则忽略 */
      }
    }
  }
}

app.whenReady().then(async () => {
  setEnv()

  // 1) 立即显示启动进度窗口：双击图标马上有反馈，不再“无反应”。
  win = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    center: true,
    autoHideMenuBar: true,
    title: 'BoBo 启动中',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'splash.html'))

  launchDbx()
  status('正在准备后端环境…')
  const depsOk = await ensureDeps()
  if (!depsOk) return // 失败时启动窗口停留并显示错误文字

  status('正在启动服务…')
  launchBackend()
  try {
    await waitForPort('127.0.0.1', 7070, 600000)
  } catch (err) {
    console.error(`[backend] ${err.message}`)
    status('服务启动超时，请查看日志 bobo-backend.log')
    return
  }
  status('启动完成')

  // 2) 用主窗口替换启动窗口
  const splash = win
  const mainWin = new BrowserWindow({
    width: 1360,
    height: 860,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWin.setMenuBarVisibility(false)
  mainWin.loadURL('http://127.0.0.1:7070')
  win = mainWin
  if (splash && !splash.isDestroyed()) splash.close()
})

app.on('window-all-closed', () => {
  killChildren()
  app.quit()
})