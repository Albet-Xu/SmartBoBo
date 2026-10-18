---
name: hatch-dsh-pet
description: Hatch a custom desktop pet for the dsh-tauri-pet plugin by following the upstream dsh-pet generation flow — prompt recipe → 10-second green-screen AI video → keying and normalization → transparent animation — then baking the result into a pet folder (pet.json plus an 8-column sprite atlas) under the DSH data directory and validating it against the host contract so it shows up in Settings → 宠物. Use when the user asks to create, hatch, import, replace or repair a custom pet, wants it generated the way upstream PC2005-cloud/dsh-pet describes, or when a pet folder they added does not appear in the pet list.
metadata:
  author: Hairyf
  version: "2026.10.03"
---

# Hatch DSH Pet

把一只自定义宠物养进 `dsh-tauri-pet`：**素材按上游 [`PC2005-cloud/dsh-pet`](https://github.com/PC2005-cloud/dsh-pet) 的生成流程产出，落点用本机认的图集**。

| 阶段 | 做什么 | 产物 |
| --- | --- | --- |
| ① | 提示词 → 源视频 | `video/<动作>.mp4`（10 秒绿幕，一个动作一段） |
| ② | 源视频 → 透明动画 | `step02/` 抠像 → `step03/` 归一化 → `step04/` 播放变体（透明 webm） |
| ③ | 动画 → 宠物 | 本机落点：`spritesheet.png/webp` + `pet.json` → `<DSH_HOME>/pets/<petId>/` |

上游的 ③ 是把 webm `cp` 进它自己的插件包（`dsh-pet/assets/webm/`）；本仓的 ③ 换成把透明帧**烘焙成 8 列 × 11 行图集**，因为本机只认图集。①② 完全照上游走：配方、命令与约束见 `references/dsh-pet-video-flow.md`（上游 `README.md:430-528` 的逐条转述），烘焙命令见 `references/atlas-compose.md`。

## 两条产线，先分清

| | 上游插件 `PC2005-cloud/dsh-pet` | 本机 `dsh-tauri-pet` |
| --- | --- | --- |
| 宠物形态 | `$DSH_HOME/dsh-pet/` 下的 webm/mov 视频包（`main-animation/`、`pet/<种类>-animation/`） | `<DSH_HOME>/pets/<petId>/pet.json` + 8 列静态图集（PNG/WebP） |
| 谁加载 | 上游插件自己的宿主路由 | 主程序 `src-tauri/src/bridge/pet.rs:629` 扫 `pets/` 的**直接子目录** |
| 能否本地注册视频宠物 | 能（「方式四 pet pack」，自动扫描） | **不能**：视频宠物只能来自 `src-tauri/resources/manifest.jsonc` 的 `pets.built-in` 远端 https 资产，`src-tauri/src/bridge/preset_pet.rs` 的出厂校验强制这一点 |

结论：**素材链照搬上游，落点换成本机图集**。把 `$DSH_HOME/dsh-pet/` 那套视频包原样搬到本机，设置页不会出现这只宠物。

## 何时使用

- 用户说「养一只宠物」「创建宠物」「做一个自定义桌宠」「换成我自己的形象」。
- 用户想按上游 dsh-pet 的方式生成宠物（写提示词 → 出绿幕视频 → 抠像 → 变成桌宠动画）。
- 用户已经把素材放进 `pets/` 目录，但设置页的宠物列表里看不到它。
- 用户想替换、修复或重新烘焙一只已有自定义宠物。
- 用户的宠物在列表里可见但选中后桌宠窗口不显示（通常是图集尺寸或格式不合约）。

不要用于：Codex 宠物的 `.zip` 导入（走设置页 Codex 标签页的「导入」按钮，落点在 `~/.codex/pets`）；也不要用于修改内置预设宠物（在 `src-tauri/resources/manifest.jsonc` 里，由主程序提供，且必须是远端资产）。

## 落点

DSH 数据目录按以下顺序确定，先取用户环境里已有的值再动手：

1. 非空环境变量 `DSH_HOME`（主程序为内核注入的就是它）。
2. 否则 `~/.dsh`（发行版默认）。
3. 调试构建固定用 `~/.dsh.dev`，不看 `DSH_HOME`。

宠物根目录 = `<DSH_HOME>/pets`，每只宠物一个**直接子目录**：`<DSH_HOME>/pets/<petId>/`。宿主只枚举直接子目录，不递归、不跟随符号链接，所以不要套一层 `my-pet/pet/`；目录名与 `pet.json` 里的 `id` 不必一致，`id` 才是标识。

`<petId>` 规则：1~64 个字符，只允许 ASCII 字母、数字、`-`、`_`。列表里展示的 id 是 `chat:<petId>`。

宠物文件夹至少两个文件：

```
<DSH_HOME>/pets/<petId>/
├── pet.json
└── spritesheet.webp        # 文件名任意，PNG 或 WebP 都行
```

## pet.json

camelCase 字段，只有 `id` 与 `spritesheetPath` 必填；`pet.json` 本身不得超过 64 KiB。

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "在会话里陪我的桌宠",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

- `displayName` 省略时列表回落到 `id`；`description` 可选。
- `spriteVersionNumber` 只能是 `1` 或 `2`，其他值会让这只宠物被整个跳过。`2` 表示 11 行图集（含两个朝向行），`1` 表示 9 行图集。**新宠物一律写 `2`。**
- `spritesheetPath` 必须是相对路径、使用正斜杠，且不含 `..`、不绝对、不含 `\`、不含 `:`。

## 图集契约

宿主按固定网格切帧，**不看像素内容，只校验头部尺寸**：

- 格式：PNG 或 WebP，透明背景。
- 列数固定 8；行数 9（v1）或 11（v2）。
- 宽必须是 8 的倍数；高必须是 9 的倍数或 11 的倍数。
- 单边不超过 16384 像素，总像素不超过 64 Mi；图集文件不超过 8 MiB。
- 推荐规格：8 列 × 11 行，每格 192×208，整图 **1536×2288**，`spriteVersionNumber: 2`。

行序、每行动作帧数与逐帧时长见 `references/atlas-layout.md`，导出素材时按那张表对齐。行的用途由宿主固定：第 0 行是待机，第 1/2 行是移动，其后各行分别对应挥手、跳跃、失败、等待、运行、复查，最后两行是按角度采样朝向的 look 行。

标准动作行只用到左侧若干格，**末帧之后的格子必须完全透明**，否则会露出脏像素。look 行则要填满 8 格。

## 阶段

### 0. 准备

1. 确认落点与 id，检查 `<DSH_HOME>/pets/<petId>/` 是否已存在（已存在就先和用户确认是覆盖还是换 id）。
2. 取上游配方。`web_fetch` 在部分网络环境会被拒（DNS 落到代理段，报 `non-public IP address`），用 git 拿：
   `git clone --depth 1 https://github.com/PC2005-cloud/dsh-pet`
   需要的是 `prompts/桌面宠物 10 秒动作提示词.md`（通用前缀 + 每个动作的按秒分解）与 `scripts/` 素材链，细节见 `references/dsh-pet-video-flow.md`。
3. 清点工具链：① 需要用户自己的 AI 视频生成工具（可灵 / Runway / 豆包等，上游素材即由豆包生成）；② 需要 Python 3 + ffmpeg + numpy + scipy；③ 只需要 ffmpeg（或 Node 内置模块）拼图集。**缺哪一环就直说缺哪一环，不要用「让生图模型画一版图集」冒充视频流程。**
4. 版权约束：上游素材（动画 / 提示词 / 源视频）允许开源使用但**禁止商用**；基于上游的二创作品必须在**任何介绍、展示、分发该作品的地方**附上 <https://github.com/PC2005-cloud/dsh-pet>。这一条要写进交付说明。

### 1. 提示词 → 源视频

按 `prompts/桌面宠物 10 秒动作提示词.md` 的配方，**一个动作生成一段 10 秒绿幕视频**：

- 比例 16:9，背景纯绿 `#00FF00`，无阴影杂物，各段绿幕色值完全一致。
- 人物位置/大小固定：头顶 ≈ 20% 高度、脚底 ≈ 85% 高度、左右边缘 ≈ 25% / 75%，画幅四边留 10% 安全缓冲；双脚落点恒定在画面正中，禁止整体平移。
- 动作全程在画幅内；**首帧与第 10 秒末帧都必须是同一张标准正面站立**（动作闭环，便于循环与取帧）。
- 大物件与道具遵守「无 → 有 → 无」闭环；需要侧身互动时只允许原地轴转。
- 每段按秒分解（0~3s / 3~7s / 7~10s 各阶段），配方文件里每个动作都有现成的分段描述，直接引用即可。

结果按动作名各存一个 mp4 放进工作目录的 `video/`。上游为了控制仓库体积不把 `video/` 入库，Release 提供 `assets-videos.zip`，我们本地工作目录同样不要提交源视频。

### 2. 源视频 → 透明动画

在 `scripts/` 下跑素材链，两条路线二选一，产出同级 `step02/`：

```sh
cd scripts
# 路线 A（默认，全自动可复现）：绿幕抠像
python watermark_step01.py   # 水印遮罩填充 → step01/
python chroma_step02.py      # HSV 绿幕抠像转透明 → step02/

# 路线 B（可选，上游自己的全部动作都用这条）：PR 手工抠像
#   1. 在 PR 里手工抠像，导出带 alpha 的透明 .mov（如 ProRes 4444 with Alpha）
#   2. 放入 pr/，文件名与动作名一致（如 吃白饭.mov）
python pr_import_step02.py   # pr/*.mov → step02/，覆盖该动作的自动抠像结果

# 两条路线共用：
python normalize_step03.py   # 归一化 2160×1215、统一站立居中 → step03/
python encode_thumbs.py      # 转码 640×360 播放变体 → step04/
```

含第三方物品、透明边缘复杂的动作，自动 HSV 抠像容易残边或误抠，用路线 B 手工遮罩；`chroma_step02.py` 作为自动化兜底随时保留。中间产物 `step01~04/` 不入库。

### ① 与 ② 之间：不要做 macOS HEVC mov

上游 ②.5 讲的是 VP9-alpha webm 在 Safari/WKWebView 黑底，所以给**它自己的插件**准备了 HEVC-with-Alpha `.mov` 并把 `ANIMATION_EXT` 改成 `.mov`。本机图集是 PNG/WebP，双端一致，**这一步与本技能无关，不要为它折腾 mov**。

### 3. 透明动画 → 本机图集

1. 读 `references/atlas-layout.md`（行序 / 每行帧数 / 逐帧时长）与 `references/atlas-compose.md`（上游动作 → 本机行的映射 + 取帧烘焙命令）。
2. 从 `step03/<动作>.webm`（2160×1215，质量最高）取帧；`step04/` 是 640×360 播放变体，只用于兜底。
3. 取帧数必须**正好等于**该行的帧数（多出来的格子必须完全透明）：逐帧时长写死在 `dsh-pet-component` 里，改图集不会改节奏，多给的帧会被当成动作的一部分播出来。
4. 所有动作、所有帧共用一个裁切框，再等比缩放进 192×208 的格子并统一脚底基线，否则宠物会在换行时忽大忽小、上下跳。
5. 第 2 行（向左移动）可以直接用第 1 行的水平镜像，不必单独生成素材。
6. look 行（第 9、10 行）要填满 8 格、共 16 个朝向，素材取自上游 `animations.turn` 的动作（如 `东张西望`）。两行各拿 8 档：行 9 是 `000°~157.5°`、行 10 是 `180°~337.5°`；**行 10 必须另取一条扫视程，别用行 9 的水平镜像顶替**——镜像给不出 `180°` 那一档。
7. 按行优先顺序拼成 1536×2288 的整图，导出 PNG 或 WebP。
8. 如果用户机器上 ffmpeg 实在不可用，可以用 Node 内置模块（`node:zlib` 足以手写 PNG、`node:fs` 足以拼接 WebP 分块）拼图集；**不要依赖 PIL、sharp、ImageMagick，宿主和内核都不保证它们在场。** 宠物文件夹本身（交付物）只含 `pet.json` + 图集，运行时不需要任何外部工具。

### 4. 写 pet.json 并校验

1. 写好 `pet.json`，把图集放进同一个目录。
2. 用本技能自带的校验脚本核对契约：

   ```bash
   node "<skill 基目录>/references/validate-pet.mjs" "<DSH_HOME>/pets/<petId>"
   ```

   脚本会按宿主同一套规则报错：id 非法、路径不可移植、清单超限、格式不可解析、宽高不整除、尺寸超限、声明版本与尺寸推定不一致。全部通过时打印解析出的网格（版本 / 列 / 行）。
3. 让用户确认：打开 设置 → 宠物，新宠物出现在 Pets 列表里；点「选择」即可启用。列表是在设置页挂载时重新枚举的，无需重启主程序。

## 失效时的表现

- **完全不在列表里**：`pet.json` 读不出、id 非法、或目录不是 `pets/` 的直接子目录。宿主会静默跳过读不出清单的目录，不报错。
- **在列表里但缩略图是占位方块**：图集读不出或格式/尺寸不合约，列表项仍会保留，缩略图生成失败。
- **能选中但桌宠窗口不显示**：`get_pet_asset` 校验失败的典型症状，多半是宽不是 8 的倍数，或高既不是 9 的倍数也不是 11 的倍数。行数由**图集高度**推定，不看你写的 `spriteVersionNumber`：1536×2288 只会解析成 11 行，声明成 `1` 不会让它变成 9 行图集，只会被校验脚本记为一条 note。
- **选择后状态回落到预设宠物**：写入的 active id 不是合法限定 id；自定义宠物必须是 `chat:<petId>`。
- **动作播完闪出残帧**：该行末帧之后的格子没清空，留了旧像素。

## 边界

- 不要把上游 `$DSH_HOME/dsh-pet/` 那套视频包（`main-config.jsonc` + `main-animation/`、`pet/<种类>-animation/`）当成本机宠物的产物交付——本机读不到它。
- 不要动 `~/.codex/pets`，那是 Codex 宠物的落点，由导入流程管理。
- 不要在宠物目录里放符号链接；宿主拒绝跟随。
- 不要为了「让它显示」去改宿主的 Rust 代码或 patch `src-tauri`：契约已经支持任意数量的自定义宠物目录。
- 交付前必须跑校验脚本，并把真实输出贴给用户；不要凭肉眼断言尺寸。素材链没跑通就如实说停在哪一步，不要声称「视频已生成」而实际只给了图集。
