// BoBo 桌面壳 · 主进程
// 职责：用 Electron 自带 Node 拉起 dsh 后端与 DBX 数据库面板，再开一个原生窗口
// 加载本机 dsh Web（http://127.0.0.1:7070）。关闭窗口时回收全部子进程。
const { app, BrowserWindow } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')

const isDev = !app.isPackaged
// 打包后运行时载荷位于 resources/runtime；开发时直接用仓库根目录。
const projectRoot = isDev
  ? path.resolve(__dirname, '..')
  : path.join(process.resourcesPath, 'runtime')

const dshDir = path.join(projectRoot, 'dsh')
// 打包版把 dbx 装在 runtime/dbx（package.json 的 extraResources 映射），开发版在仓库根 dbx-runtime。
const dbxDir = path.join(projectRoot, isDev ? 'dbx-runtime' : 'dbx')
const dbxBin = path.join(dbxDir, 'dbx-web.exe')
// dsh 需要 Node ^22.19 / >=24；Electron 内置 Node 20 太老，所以后端用随包附带的
// 便携 Node（开发模式下直接用系统 node）。
const nodeBin = isDev
  ? 'node'
  : path.join(projectRoot, 'node', 'node.exe')

// 用户数据根目录：打包版放在安装目录同级（升级/卸载都不受影响，随安装盘走）；
// 开发版放在仓库内 bobo-data。里面是会话记录、设置、API Key、日志与浏览器缓存，
// 统一搬离系统 C 盘用户目录，减轻 C 盘负担。
const dataRoot = path.resolve(isDev
  ? path.join(projectRoot, 'bobo-data')
  : path.join(path.dirname(process.resourcesPath), '..', 'BoBoData'))

/**
 * 把 dsh home（会话/设置/附件等）与 Electron userData（日志/缓存）一并指到
 * 数据根：DSH_HOME 由后端子进程继承，userData 决定本进程的日志与浏览器数据。
 */
function setDataPaths() {
  const dshHome = path.join(dataRoot, 'dsh')
  const electronData = path.join(dataRoot, 'electron')
  fs.mkdirSync(dshHome, { recursive: true })
  fs.mkdirSync(electronData, { recursive: true })
  process.env.DSH_HOME = dshHome
  app.setPath('userData', electronData)
}

/**
 * 首次运行迁移：把旧 <用户主目录>/.dsh 整体复制到新的 DSH_HOME。
 * 仅当新位置尚无 sessions（未迁移过）时执行一次；旧目录保留不删，失败不阻塞启动。
 */
function migrateLegacyDsh() {
  const legacy = path.join(os.homedir(), '.dsh')
  const target = process.env.DSH_HOME
  if (!target || !fs.existsSync(legacy)) return
  if (fs.existsSync(path.join(target, 'sessions'))) return
  try {
    fs.cpSync(legacy, target, { recursive: true })
    console.log(`[migrate] 已将旧数据 ${legacy} 复制到 ${target}`)
  } catch (err) {
    console.warn(`[migrate] 旧数据迁移失败（不影响启动）: ${err.message}`)
  }
}

// 尽早固定数据根路径：任何 getPath('userData') 与后端子进程 env 都基于它。
setDataPaths()
migrateLegacyDsh()

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
  // 打包后 DBX 数据目录由壳统一管理（BoBoData/dbx），注入环境变量，让
  // dbx-mcp（Python 子进程）与 dbx-web 面板都能定位 dbx.db。
  if (!isDev) process.env.DBX_DATA_DIR = path.join(dataRoot, 'dbx')
}

/**
 * 跨机关键：把打包内 .venv 的 pyvenv.cfg `home` 改指到随包捆绑的基础 Python
 * (runtime/python)。否则 venv 会去构建机的 D:\Application\Python 找解释器，
 * 别人机器上没有该路径，采集脚本将无法运行。home 不能用相对路径（相对 CWD 解析），
 * 因此必须在目标机按实际安装位置写绝对路径。
 */
function fixVenvPython() {
  if (isDev) return
  const venv = path.join(projectRoot, '.venv')
  const base = path.join(projectRoot, 'python')
  const cfg = path.join(venv, 'pyvenv.cfg')
  if (!fs.existsSync(cfg) || !fs.existsSync(path.join(base, 'python.exe'))) return
  try {
    const content = [
      `home = ${base}`,
      'implementation = CPython',
      'version_info = 3.13.5',
      'include-system-site-packages = false',
    ].join('\n') + '\n'
    fs.writeFileSync(cfg, content, 'utf8')
  } catch (err) {
    /* 写入失败不影响启动；采集时若 venv 异常会另有提示 */
  }
}

/**
 * 首启把随包内置技能（runtime/skills）按需落到 DSH_HOME/skills。
 * 只补缺、不覆盖：用户自装/自改的技能保留；同名技能目录已存在则跳过。
 */
function seedSkills() {
  const src = path.join(projectRoot, 'skills')
  const targetRoot = path.join(process.env.DSH_HOME || '', 'skills')
  if (!fs.existsSync(src) || !targetRoot) return
  try {
    for (const name of fs.readdirSync(src)) {
      const from = path.join(src, name)
      const to = path.join(targetRoot, name)
      if (!fs.statSync(from).isDirectory()) continue
      if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true })
    }
  } catch (err) {
    console.warn(`[seedSkills] 内置技能复制失败（不影响启动）: ${err.message}`)
  }
}

/**
 * 首启把随包捆绑的 DBX 驱动运行时（runtime/dbx/data/agents：托管 JRE + 内置驱动 agent
 * + state.json）按需落到 $DBX_DATA_DIR/agents，让 Kafka 等内置 agent 数据库在离线机器上
 * 开箱可用。只补缺、不覆盖：用户已装驱动/已连过的目录保留。打包版执行，开发版 DBX
 * 直接用默认数据目录（dbx-runtime/data），无需播种。
 */
function seedDbxDrivers() {
  if (isDev) return
  const src = path.join(dbxDir, 'data', 'agents')
  const dest = path.join(dataRoot, 'dbx', 'agents')
  if (!fs.existsSync(path.join(src, 'state.json'))) return // 无捆绑驱动则不播种
  try {
    if (!fs.existsSync(dest)) fs.cpSync(src, dest, { recursive: true })
  } catch (err) {
    console.warn(`[seedDbxDrivers] 驱动运行时播种失败（不影响启动）: ${err.message}`)
  }
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
  // v1.3.3 起：依赖不再用联网重装，而是把 pnpm store 打进安装包（runtime/dsh/.pnpm-store）。
  // 首启用内置 Node + pnpm 从本地 store 离线重建 node_modules，零联网、不依赖外网镜像，
  // 避免「目标盘无缓存时要整包重新下载依赖导致失败」的问题。开发模式维持原联网逻辑。
  const bundledStore = isDev ? null : path.join(dshDir, '.pnpm-store')
  const baseArgs = isDev
    ? ['--registry=https://registry.npmmirror.com/', '--ignore-scripts', '--reporter=append-only']
    : ['--offline', '--store-dir=' + bundledStore, '--ignore-scripts', '--reporter=append-only']
  const attempt = (extraArgs) => new Promise((resolve) => {
    const depLog = fs.createWriteStream(path.join(app.getPath('userData'), 'bobo-pnpm.log'), { flags: 'a' })
    depLog.write(`\n[first-run] pnpm ${extraArgs.join(' ')} in ${dshDir}\n`)
    const child = spawn(nodeBin, [pnpmScript, ...extraArgs], {
      cwd: dshDir,
      // 关闭 pnpm 的「按 packageManager 字段自切版本」：捆绑的 pnpm 与 store/cache
      // 版本一致，避免目标机离线时为了切到另一版本而去下载。
      env: { ...process.env, BOBO_ROOT: projectRoot, npm_config_manage_package_manager_versions: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.stdout) child.stdout.pipe(depLog)
    if (child.stderr) child.stderr.pipe(depLog)
    child.on('close', (code) => { depLog.end(); resolve(code === 0) })
    child.on('error', () => { depLog.end(); resolve(false) })
  })
  status(isDev ? '首次运行：正在安装依赖（走国内镜像）…' : '首次运行：正在从本地 store 离线重建依赖…')
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
  fs.mkdirSync(path.join(dataRoot, 'dbx'), { recursive: true })
  seedDbxDrivers()
  dbxProc = spawn(dbxBin, [], {
    env: {
      ...process.env,
      DBX_STATIC_DIR: path.join(dbxDir, 'dist'),
      DBX_DATA_DIR: path.join(dataRoot, 'dbx'),
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
  fixVenvPython()
  seedSkills()
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