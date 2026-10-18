# 复制打包内核的同版本运行时依赖到 bobo/node_modules
# command-proxy / ui-settings-* 的裸导入（zod、schemastery 及传递依赖）靠它解析。
# 并给 command-skill-model / tool-acquisition / tool-market 的裸导入建立 junction：
# 这些包要扩展/消费宿主（cordis）的活服务，必须是同一份模块实例，
# 故不做复制而直接指向内核 node_modules（Node 默认把软链接解析到真实路径）。
# dsh 内核升级后重跑本脚本即可对齐版本。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($env:BOBO_ROOT) { $root = $env:BOBO_ROOT }
$kernel = Join-Path $env:APPDATA 'dsh-tauri\dependencies\dsh\node_modules'
if ($env:BOBO_KERNEL_NM) { $kernel = $env:BOBO_KERNEL_NM }
$dest = Join-Path $root 'bobo\node_modules'
$pkgs = @(
  'zod',
  '@deepseek-ai\schemastery',
  '@deepseek-ai\cosmokit',
  '@standard-schema\spec'
)
if (-not (Test-Path $kernel)) { throw "内核 node_modules 不存在: $kernel" }
New-Item -ItemType Directory -Force -Path (Join-Path $dest '@deepseek-ai'), (Join-Path $dest '@standard-schema') | Out-Null
foreach ($p in $pkgs) {
  $src = Join-Path $kernel $p
  $dst = Join-Path $dest $p
  if (-not (Test-Path $src)) { Write-Warning "内核缺少 $p，跳过"; continue }
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  Copy-Item -Recurse -Force $src $dst
  Write-Host "copied $p"
}
# junction 指向内核，绝不递归删除（Remove-Item -Recurse 会连带删掉目标内容）
$junctionPkgs = @(
  '@deepseek-ai\dsh-llm',
  '@deepseek-ai\dsh-tools',
  '@deepseek-ai\dsh-home-paths',
  '@deepseek-ai\dsh-skill'
)
foreach ($p in $junctionPkgs) {
  $src = Join-Path $kernel $p
  $dst = Join-Path $dest $p
  if (-not (Test-Path $src)) { Write-Warning "内核缺少 $p，跳过"; continue }
  if (Test-Path $dst) {
    $item = Get-Item $dst -Force
    if ($item.LinkType -eq 'Junction' -and $item.Target -contains $src) { Write-Host "junction ok $p"; continue }
    if ($item.LinkType) { [System.IO.Directory]::Delete($dst, $false) }
    else { Remove-Item -Recurse -Force $dst }
  }
  New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
  Write-Host "junction $p"
}
Write-Host "done -> $dest"
