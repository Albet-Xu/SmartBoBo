# 桌面端 UI 组件规范 (Desktop UI Component Protocol)

> **适用范围**：`src/ui/**` 与 `src/components/**` 下的 React 组件（设置面板、对话框、独立视图）。
> 本规范是 [devlopment.md](./devlopment.md) 与 [desktop.baisc.md](./desktop.baisc.md)（§3 前端编码规范）在**组件实现粒度**上的补充：结构性规则看那两份，**组件内部怎么组织**看这份。

---

## 一、 组件内分区与编号注释

组件函数体按**固定顺序**分区，每区以 `// N. 中文标题 (English hint)` 起头：

| 序号 | 分区 | 放什么 |
| :--- | :--- | :--- |
| 1 | `数据查询 (Queries)` | `useQuery` / store 读取等**不依赖本地选择**的数据源 |
| 2 | `本地用户选择状态` | `useState` / `useToggle` 等交互状态 |
| 3 | `<业务>数据 Query` | 依赖上面状态的查询（配 `enabled: Boolean(key)` 开关） |
| 4 | `派生数据提取与 Map 索引构造` | 兜底（`?? []`）、派生布尔、Map 索引表 |
| 5 | `使用 useMutation 封装<动作>流程` | 提交动作 |

```tsx
export function ProfileMigrateDialog(props: PropsWithOverlays) {
  // 1. 数据查询 (Queries)
  const { data: cores } = useQuery({ /* … */ })

  // 2. 本地用户选择状态
  const [pickedSourceId, setPickedSourceId] = useState('')

  // 3. 档案迁移分析数据 Query
  const { data: analysis, isLoading, error } = useQuery({ /* …, enabled: Boolean(pickedSourceId) */ })

  // 4. 派生数据提取与 Map 索引构造 (常数级别 O(1) 查找)
  const installedMap = new Map(manager.installed.map(p => [p.id, p.version]))

  // 5. 使用 useMutation 封装迁移提交流程
  const { mutate: handleMigrate, isPending: busy } = useMutation({ /* … */ })
}
```

* **顺序不可打乱**：查询 → 本地状态 → 依赖查询 → 派生 → 提交。新增逻辑按职责插进对应分区，不另起序号。
* **派生值集中在一处**：`?? []`、`filter`、`find` 只在第 4 区出现；JSX 里写的是"怎么渲染"，不是"怎么算"。
* 分区外只允许两类注释：区块 `{/* … */}`（见 §四）与 `// 阶段 A:` 之类的多阶段标记。

---

## 二、 Map 索引代替线性查找

渲染循环里要按 id / kind 反查时，**先在派生区构造一次 Map**，渲染时 O(1) 取值：

```tsx
const installedMap = new Map(manager.installed.map(p => [p.id, p.version]))
const dataItemMap = new Map(dataItems.map(item => [item.kind, item]))
```

* 禁止在 `map()` / `filter()` 回调里 `list.find(...)`（渲染 N 项就是 O(n²)）。
* 禁止为"只查一次"再抽工具函数或多写一层 hook——索引表就在第 4 区，谁用谁读。

---

## 三、 提交动作一律用 `useMutation` 收敛

```tsx
const { mutate: handleMigrate, isPending: busy } = useMutation({
  mutationFn: async () => {
    // 阶段 A: 迁移档案数据
    // 阶段 B: 安装插件
    return { totalCount, failedCount }
  },
  onSuccess: ({ totalCount, failedCount }) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.plugins })
    // toast 汇总 + 关闭弹窗（disclosure.confirm()）
  },
  onError: (err) => {
    console.error('[ProfileMigrateDialog] migrate failed:', err)
    toast(t('profiles.migrate_failed'), { variant: 'danger', description: String(err) })
  },
})
```

* **busy 直接取 `isPending`**，不得再手写 `useState(false)` + `try / catch / finally`。
* `mutationFn` 只负责副作用与**返回汇总结果**（给 `onSuccess` 用），不弹提示、不动缓存。
* 多阶段副作用逐段标注 `// 阶段 A: …` / `// 阶段 B: …`。
* 提示遵守"**谁执行，谁提示**"：toast 只在 `onSuccess` / `onError` 里发一次，上层不重复。
* 提交按钮：`onPress={() => handleMigrate()}`，禁用条件由派生值算一次（`canSubmit`）。

---

## 四、 注释与文档粒度

* **组件 JSDoc 只留一行定位**：`/** 「迁移档案数据」对话框组件 */`。交互流程、取舍、边界写进 PR 描述，不复制进源码。
* **常量表只留一行用途**：`/** 判定结果 → Chip 颜色与文案 key */`、`/** 数据项的列出顺序：凭据固定最后 */`；不逐字复述字面量。
* **JSX 区块用单行注释**：`{/* 源档案与目标档案选择 */}`、`{/* 插件列表面板 */}`；块内不再加注释。
* 除上述三类与 `// 阶段 X:` / `ponytail:` 外，**不新增注释**（与 `AGENTS.md` 的 0 注释原则一致）。

---

## 五、 自检清单

* [ ] **分区**：五个分区是否齐全、顺序是否固定？
* [ ] **派生**：渲染循环里是否还有 `Array.find`？索引表是否在第 4 区一次构造？
* [ ] **提交**：是否走 `useMutation`？busy 是否直接用 `isPending`？toast 是否只发一次？
* [ ] **注释**：JSDoc 是否只有一行？JSX 区块是否单行注释、块内无冗余注释？
* [ ] **主题**：HeroUI 组件上是否没有再叠 `rounded*` 工具类？（圆角由主题负责，`test/shell-heroui-theme.test.ts` 会拦）
* [ ] **工程校验**：`eslint` 零 error、`tsc -p tsconfig.typecheck.json` 零错误、相关 `vitest run --project unit` 通过。
