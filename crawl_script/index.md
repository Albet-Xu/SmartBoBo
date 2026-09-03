# crawl_script 站点索引（站点键 → 脚本）

> 由逆向模式在生成/修改脚本时**追加**登记（不覆盖已有行），工作流/逆向按站点键复用。
> 站点键 = 域名去掉 `www.`（如 `news.qq.com`）。

| 站点键 | 脚本 | 用途 / 参数 |
|---|---|---|
| news.qq.com | news_qq_article.py | 腾讯新闻 /rain/a/ 文章页转 Markdown（SSR 直出，requests 即可） |