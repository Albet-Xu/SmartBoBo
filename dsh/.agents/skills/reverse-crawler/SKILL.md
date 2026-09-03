---
name: reverse-crawler
description: 网页逆向模式下复用生成 Python 爬虫脚本的框架与模板：含可复用的 Markdown 保存（按站点归类）、CLI 参数、请求重试、会话管理骨架、内置 camoufox 浏览器渲染与增量采集（manifest）支持，以及逆向生成脚本的 SOP。当用户要求生成/采集/逆向某个网站的爬虫脚本时使用。
disable-model-invocation: false
user-invocable: true
---

# reverse-crawler：爬虫脚本生成模板（网页逆向）

本技能供「逆向模式」复用，核心目标：**少写样板、少费 token、产出结构一致的完整爬虫脚本**。动手前先加载本技能，并按下面的 SOP 生成。

## 配套模板文件

同目录下有一个 `crawl_template.py`，是**可复用的完整骨架**。生成脚本时，直接把该文件作为脚本主体复制/改写，只针对目标网站填充「⛏️ 目标定制区」，不要重新编写保存、请求、CLI 等通用逻辑。

## 站点键与目录约定（必须遵守）

- **站点键 SITE_KEY** = 域名去掉 `www.`（如 `news.qq.com`）。生成脚本时在定制区填 `SITE_KEY = "<域名>"`；不填则由 URL 自动推导。
- **脚本保存**：`{{cwd}}/crawl_script/<站点键>/<脚本名>.py`（不存在则创建）。
- **数据落盘**：`{{cwd}}/data/<站点键>/<文件名>.md`（模板 `save_markdown` 自动创建目录）。
- **登记复用**：生成/修改脚本后，在 `{{cwd}}/crawl_script/index.md` **追加**一行：`<站点键> | <脚本名> | 用途/参数`（不覆盖已有行）。这样后续逆向/工作流按站点键即可复用脚本，不用扫目录。

## 生成脚本的 SOP

1. **确认逆向结果**：已用 js-reverse 等工具拿到目标网址的关键接口（URL、请求头、Cookie、签名/加密参数、返回结构），并确认页面是静态直出还是需要 JS 渲染。
2. **复制模板**：把 `crawl_template.py` 作为生成脚本的骨架，第二行注释如实写明目标网址与用途；保存到 `crawl_script/<站点键>/`，并在 `crawl_script/index.md` 登记一行。
3. **只改「目标定制区」**（文件里用 `# ⛏️ TARGET-CUSTOM` 标记）：
   - `SITE_KEY`：站点键（域名去 www.）；
   - `build_default_url()`：默认目标 URL；
   - `needs_render(url, html)`：是否需要浏览器渲染——默认启发式（空壳/无 body 才渲染）；已知需 JS 渲染的站点直接 `return True`；
   - `list_candidates(session, args)`：从列表页/接口翻页解析出**本次要采集的所有条目** `[(url, 标题), ...]`（列表型站点必改；单页站点保持默认即可）；
   - `parse_data(html_text, session, args)`：把 HTML 规整成 Markdown（含标题、正文、列表、字段提取）。
4. **保留通用骨架**：CLI 参数、`fetch_html`/`render_html`、`save_markdown`、manifest 维护、重试、会话管理均复用模板，不要改动。
5. **可先自测运行**：确认脚本可运行、能输出 Markdown；但**最终交付给用户的是脚本代码**，不是采集到的数据。

## 浏览器默认（重要）

- 模板已内置**双层获取**：默认 `requests` 直取（静态页零开销）；`needs_render` 判定需要渲染、或加 `--browser` 强制时，自动用**内置 camoufox**（抗检测 Firefox）渲染后返回完整 HTML。
- **生成需要浏览器能力的脚本时一律用 camoufox，不要使用 selenium / 原生 playwright / 其它浏览器**。
- 运行含渲染的脚本**必须用 BoBo 的 `.venv/Scripts/python.exe`**（已装 camoufox）；缺库时模板会打印安装命令。

## 增量采集约定（manifest）

- 每次落盘，模板会自动维护 `data/<站点键>/manifest.json`（每条：url、标题、采集时间、`content_hash`(HTML指纹)、`file_hash`(落盘文件指纹)、文件名）。
- 生成的脚本自带 `--incremental`：与 manifest 对比，**只抓新增或内容变化的条目**，跳过未变化的；`--force` 强制重抓，`--limit N` 限制条数。
- 交付时向用户说明增量用法：`python <脚本名>.py --incremental`（增量采集当日新增/变化），以及 `--incremental --limit`、`--force` 等。
- manifest 同时被提取入库脚本复用（见 db-extraction 技能），两脚本共享同一份"状态源"，避免重复读取历史数据。

## 脚本行为约定（写入脚本的注释与默认值）

- 输出数据统一为 **Markdown**，保存到当前工作区 `data/<站点键>/` 目录（不存在则自动创建），文件名默认 `站点_标题_时间戳.md`，也可用 `--output` 覆盖（仅非增量模式）。
- 必需依赖说明：默认 `requests`；需渲染时依赖 `camoufox`（用 `.venv` 运行）。缺依赖时在脚本顶部「依赖」注释写明安装命令。
- 所有可能失败的环节（网络、反爬、字段缺失）都要有 `try/except` 与清晰报错，不能静默失败。

## 减少 token 的要点

- **不要重写通用部分**：`fetch_html`、`render_html`、`save_markdown`、manifest、CLI、重试 全部来自模板。
- **不要贴大段配置**：脚本内注释用短句说明接口与反爬点，不复制页面源码。
- **改动收敛在目标定制区**：生成的脚本与模板的 diff 就是"这个网站特有的采集逻辑"。
- **站点复用**：同站点再次生成/增量时，先读 `crawl_script/index.md` 与 `data/<站点键>/manifest.json`，能复用就复用，不重新逆向。

## 边界

- 用途合规：不生成用于绕过付费墙、损坏他人系统、非法采集的脚本；对登录态、验证码等需用户提供的信息，提示向用户询问，不编造。
- 若目标网站有更合适的既有 skills / 采集引擎（Scrapling、crawl4ai 等），可结合使用，不必强用本模板。