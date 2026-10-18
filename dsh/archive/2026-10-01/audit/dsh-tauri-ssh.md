# ponytail-audit · dsh-tauri-ssh

初审范围：`packages/dsh-tauri-ssh`，121 个 Git 跟踪文件（client 40、host 72、入口/共享/配置等 9；含 32 个测试文件）。以下建议中的行号为初审位置；16 项现已实施，处理与验证结果见末节。未运行插件构建，未读 archive。

口径：逐文件阅读并核对仓内调用方、字符串协议及现有测试；按保守净删减行数排序，计入必要 import、调用点和 mock 改动，不重复计数。保留插件规范要求的分层、公开协议/生成 API、宽容 wire 校验、0600/0700 原子持久化、runtime generation/reconnect 守卫及测试断言。不沿用旧报告中已实施或已撤回的 SSH 建议。

- delete: 关闭状态下的 draft 预填没有消费者：删除 initialized、首次全量 hydration effect、取消后的已保存行回填、添加成功后的 draft 回填；openEditor 始终先复制当前行，保持打开中的编辑缓冲和 secret 清理不变。[machines-section.tsx:652](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L652>)、[machines-section.tsx:682–744](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L682-L744>)。(-13 LOC)
- shrink: 五个 progress 文案分支收为 ``if (progress !== undefined) return t(`progress.${progress.phase}`).replace('{attempt}', String(progress.attempt ?? '?')).replace('{total}', String(progress.total ?? '?'))``；按链式格式占四行，保留闭集 phase 校验、缺失数字的 `?` 和后续重试倒计时。[machines-section.tsx:499–516](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L499-L516>)。(-12 LOC)
- shrink: 两份真实 POSIX sh 测试 runner 只差 async 修饰与临时脚本名；将现有 runCommand 提到文件作用域，删除另一份，保持 sandbox HOME、stdout/stderr/退出码归一化和全部用例断言。[bootstrap.test.ts:557–566](<packages/dsh-tauri-ssh/src/host/service/bootstrap.test.ts#L557-L566>)、[bootstrap.test.ts:807–816](<packages/dsh-tauri-ssh/src/host/service/bootstrap.test.ts#L807-L816>)。(-9 LOC)
- shrink: SecretField 不需要复合字符串键字典、固定 span 配置和第二份 label JSX；直接传当前已保存行的 hasPassword/hasPassphrase 布尔值，使用 `placeholder={hasSecret ? t('secret.set') : t('secret.unset')}` 与已有 `<Field label={label}>`，删除 secretFlagsOf；保留秘密输入缓冲与实时已设置标记的区别。[machines-section.tsx:155–198](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L155-L198>)、[machines-section.tsx:418–448](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L418-L448>)、[machines-section.tsx:901](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L901>)。(-8 LOC)
- stdlib: rowsOf 的循环累积改为 `return entriesOf(value).map(machineRowOf).filter((row): row is MachineRow => row !== undefined)`；保留 entriesOf/machineRowOf 的全部信任边界校验、容错及默认值，不删解析器。[parsers.ts:174–182](<packages/dsh-tauri-ssh/src/client/apis/parsers.ts#L174-L182>)。(-6 LOC)
- delete: Tailwind 迁移后 uiMock 的 cssr import/export 和 mountStyle 空实现已无调用方；直接删除，保留实际使用的 Button/Pill 等 mock，不减少测试场景。[ui-mock.ts:3](<packages/dsh-tauri-ssh/src/client/test-utils/ui-mock.ts#L3>)、[ui-mock.ts:66–80](<packages/dsh-tauri-ssh/src/client/test-utils/ui-mock.ts#L66-L80>)。(-6 LOC)
- yagni: connectedMachinesOf 只是单调用点的拼接过滤包装；在原调用处直接用 `[...machinesState.machines, ...machinesState.discovered].filter(machine => machinesState.statuses[machine.id]?.state === 'connected')`，删除 helper 及不再需要的 MachineRow 类型导入。[sync-panel.tsx:60](<packages/dsh-tauri-ssh/src/client/components/sync-panel.tsx#L60>)、[sync-panel.tsx:385–391](<packages/dsh-tauri-ssh/src/client/components/sync-panel.tsx#L385-L391>)。(-6 LOC)
- shrink: 自绘 tintBorder 开关和 SWITCH/SWITCH_ON CSS 改用 dsh-tauri-ui/client 已导出的 Switch，传 checked、disabled、label 和 onChange；同时补等价 Switch mock，保持现有颜色/开关测试有意义，净值已扣除 mock 增量。[machines-section.tsx:60–61](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L60-L61>)、[machines-section.tsx:402–412](<packages/dsh-tauri-ssh/src/client/components/machines-section.tsx#L402-L412>)、[共享 Switch 出口:54](<packages/dsh-tauri-ui/src/client/components/official.tsx#L54>)。(-4 LOC)
- shrink: grantBuildKeys 重复远端白名单读取、合并、按需写回；保留 parseBuildAllowKeys 和空 keys 守卫，改为 `return carryWorkspaceAllowlist(session, profileName, { allowBuilds: Object.fromEntries(keys.map(key => [key, true])), onlyBuiltDependencies: [] })`，复用已存在的 helper。[sync.ts:101–113](<packages/dsh-tauri-ssh/src/host/service/sync.ts#L101-L113>)、[allowlist.ts:158–169](<packages/dsh-tauri-ssh/src/host/utils/allowlist.ts#L158-L169>)。(-4 LOC)
- stdlib: buildPluginsBundle 手包 execFile Promise 改用 `promisify(execFile)`，保存返回的 pending，执行 `pending.child.stdin?.end()` 后 `const { stdout: tar } = await pending`；保留 encoding buffer、64 MiB maxBuffer、错误传播及 finally 清理，不直接丢掉 stdin EOF。[plugins-sync.ts:94–116](<packages/dsh-tauri-ssh/src/host/utils/plugins-sync.ts#L94-L116>)。(-4 LOC)
- shrink: commitEnabled 与 setEnabled 重复写同样两个状态字段；调用方改用 `setEnabled(enabled, null)`，删除 commitEnabled，测试改调现有 action 而不删断言，保留 beginEnable/endEnable 和 service/store 分层。[machines store:69–80](<packages/dsh-tauri-ssh/src/client/store/modules/machines.ts#L69-L80>)、[machines service:55](<packages/dsh-tauri-ssh/src/client/service/machines.ts#L55>)、[machines store test:119](<packages/dsh-tauri-ssh/src/client/store/modules/machines.test.ts#L119>)。(-4 LOC)
- shrink: mergeSyncResults 的新增/覆盖分支改为 `const key = syncKeyOf(item); const index = at.get(key) ?? merged.length; at.set(key, index); merged[index] = item`；保留索引 Map、root-aware key、原顺序及重复 previous 项行为，不采用会折叠 previous 重复项的整表 Map 替换。[sync.utils.ts:16–30](<packages/dsh-tauri-ssh/src/client/store/modules/sync.utils.ts#L16-L30>)。(-3 LOC)
- shrink: planRemoteInstall 已调用 assetMatrixFor 并取得已校验 nodeFilename；删除第二次 nodeFilenameFor 和 undefined 检查，直接用 `filename: matrix.nodeFilename, version: NODE_VERSION`，不删除共享平台校验或资产矩阵。[bootstrap.utils.ts:90–117](<packages/dsh-tauri-ssh/src/host/service/bootstrap.utils.ts#L90-L117>)、[assets.ts:42–58](<packages/dsh-tauri-ssh/src/host/utils/assets.ts#L42-L58>)。(-3 LOC)
- shrink: withinButton 手工 querySelectorAll/find/throw 改为已安装且已导入的 Testing Library：`return within(container).getByRole('button', { name: text }) as HTMLButtonElement`；保持同一容器、唯一精确按钮名和所有断言。[machines-section.test.tsx:597–602](<packages/dsh-tauri-ssh/src/client/components/machines-section.test.tsx#L597-L602>)。(-3 LOC)
- yagni: tarPacker 是没有闭包配置的工厂；改为直接 `async function packSkills(dir: string, names: readonly string[]): Promise<Buffer>`，apply 注入函数而不是调用工厂，保留 maxBuffer、windowsHide、buffer 输出和空归档检查；有配置捕获的其他 reader/scanner 工厂不动。[local.ts:90–102](<packages/dsh-tauri-ssh/src/host/utils/local.ts#L90-L102>)、[apply.ts:35](<packages/dsh-tauri-ssh/src/host/apply.ts#L35>)。(-2 LOC)
- shrink: describeError 与共享 messageOf 实现完全相同；两个 host 消费模块直接 import messageOf，删除内部重复 helper，不加兼容转发；净值已扣除两个 import，不把 route 中另加 import 的同式替换计为收益。[bootstrap.utils.ts:503–505](<packages/dsh-tauri-ssh/src/host/service/bootstrap.utils.ts#L503-L505>)、[machine.ts:17](<packages/dsh-tauri-ssh/src/host/service/machine.ts#L17>)、[error.ts:1–3](<packages/dsh-tauri-ssh/src/shared/error.ts#L1-L3>)。(-1 LOC)

核实：只读 Node assert 检查通过——merge 分支简化 30 组（含 previous 重复项）、中英 progress 文案 30 组、promisify 的 Buffer 输出与显式 stdin EOF。初审时未运行测试套件；以上净值为建议估算，不是最终 diff。未证明任何运行时依赖可安全移除。没有把大组件机械拆文件、可选 JSX assembler、重写单编辑器状态或删除 snapshot clone 计入净值。

初审估算：net: -88 lines, -0 deps possible.

## 处理结果

- 16/16 项实施，无撤回。保留架构分层、wire 校验、秘密输入/已保存标记区分、快照克隆、权限模式和 runtime cancellation 守卫。
- 按追加要求，将 SSH 的 61 个命名 Tailwind 字符串和 span 样式表内联到 JSX；保留业务/协议/校验常量，不改其他插件。其他插件多数直接写 className，少数旧组件的样式别名不作为继续保留的理由。
- 当前 SSH 跟踪 diff：287 行新增、353 行删除；非 `.test.*` 文件净减少 126 行。新增 60 行归档回归测试后，SSH 实际合计净减少 6 行；无依赖变更。净值含共享 Switch mock 和新增断言，不以删测试换收益。
- Testing Library 的角色查询 `name: string` 已精确匹配；没有 `exact` 选项，最终实现移除该非法选项。
- 客户端整套：13 文件 / 156 测试通过；父级解析/合并相关 71 测试连续 5 个乱序 seed 通过；组件机器/同步 56 测试连续 5 个乱序 seed 通过，最终 3 组件文件 61 测试通过。
- Host 便携回归 68/68、完整 machine 92/92 通过。新增归档测试验证 Buffer 输出、64 MiB 上限、stdin EOF 和失败清理；白名单测试保留已有项且避免无效写回。
- 变异验证：错误 merge 索引使回归变红；改用 draft 的 secret flags 使刷新编辑回归变红，均已恢复。
- SSH 整包：560 通过、11 失败、4 既有跳过；失败身份与改前 Windows 基线一致（10 个真实 POSIX sh / chmod / GNU tar 场景，1 个部署路径分隔符断言）。未增加跳过、放宽断言或构建插件。
- 整仓 TypeScript 与 SSH ESLint 通过，diff whitespace 检查通过。

## 追加：壳转发与 React Query

- [请求层](<src/apis/http.ts>) 只将生成 API 的 method/path/payload 转为 `invoke('remote', { method, payload })`；生成 API/类型保留，不再从前端读取 serviceURL 或直接 HTTP 请求 SSH 插件。
- [Rust remote](<src-tauri/src/bridge/remote.rs>) 严格放行 13 个生成端点，使用当前配置的 loopback 端口，禁用代理与重定向；GET 查询参数/其他方法 JSON body，404/405 与不可达错误区分。注册命令并删除旧 loopback HTTP capability，桌宠 HTTP 不受影响。
- [useRemote](<src/hooks/use-remote.ts>) 由切换器挂载一次并在内部渲染连接弹窗；只向父层回报隧道 URL 和描边颜色。切换器在安装/恢复页保持挂载但隐藏 UI，保留启动寻址和轮询。查询、轮询、单飞、缓存和失效由 React Query 管理，连接/断开用 mutation；只保留窗口选择、粘性 URL、取消代次和弹窗交互状态。
- 删除旧 remote store、SshApiClient、refreshing、booted、手写 timer 和测试注入层；既有切换/解析/界面/降级日志断言迁移，不删用例。查询失败保留缓存、缺 API 清空视图、迟到连接不抢切换。
- Rust：`cargo check --locked --offline` 通过；remote 隔离 loopback 测试 15/15 通过，rustfmt 检查通过。前端相关 7 文件 / 58 测试连续 5 个乱序 seed（301–305）全部通过；变异缺 API 判定时 404/405 回归均失败，恢复后 seed 306 的 58 测试再通过。TypeScript/ESLint 通过。
- 转发/查询首次实现时全仓 unit 实跑：227 文件通过，3 失败，2 既有跳过；2262 测试通过、13 失败、4 既有跳过。失败为上述 11 个 Windows SSH 基线，加 2 个未构建插件资源闭包用例（缺部署树中的 notification 包）；没有新的失败身份。

## 追加：remote 精简复核

- [切换器](<src/layout/components/remote-switcher.tsx#L30-L55>) 直接调用 useRemote 并渲染连接弹窗；Webview/导航栏不再传递整包 Remote。隐藏 UI 不卸载查询，保留远端窗口启动寻址。
- 删除重复 retry/可见性监听、cancelConnect 包装、未消费 wire 字段和单调用点 helper，保留实际字段校验、取消代次、粘性 URL 及窗口 focus 刷新；生产代码与配置净减少 68 行。
- 原 14 个切换器用例迁移为真实 hook/QueryClient/弹窗与 native invoke 边界验证，新增 3 个集成回归；原 helper 的色点/描边断言迁入 UI，未弱化。相关 9 文件 / 68 测试在最终恢复后连续 5 个乱序 seed（511–515）通过；TypeScript、范围 ESLint 与 whitespace 检查通过。
- 变异验证：重新搬运 remotePort 导致解析回归失败；忽略 tintBorder 导致 2 个 UI 回归失败，均已恢复并重验。新增原生 visibilitychange 回归证明 React Query 自带恢复刷新。
- 本轮全仓 unit：229 文件通过、3 失败、2 既有跳过；2289 测试通过、13 失败、4 既有跳过。失败身份仍为同一 Windows/未构建资源基线；未构建插件、未增加跳过、未改无关 UI 样式。
