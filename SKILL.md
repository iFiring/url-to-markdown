---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

# url-to-markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

## 何时使用 / 不使用

- 使用：把单个 URL 的正文转为 Markdown 文件
- 不使用：批量爬取、站点镜像；登录态存于 IndexedDB / Service Worker 的站点

## 操作手册（步骤 0-5）

本技能目录为 `<skill-root>`（SKILL.md 所在目录）。以下 `<url>` 均指用户给定的完整 URL。

### 步骤 0 · 初始化环境（仅首次或环境变更时）

```bash
bash <skill-root>/script/init.sh
```

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 1 |
| `error` | **终止全部流程**，把 `reason` 反馈给用户 |

stderr 中的"警告"不阻断，可忽略。

### 步骤 1 · 打开 URL，判断/完成登录

```bash
node <skill-root>/script/login_url.mjs <url> [--timeout 300000]
```

脚本会自动弹出本地 viewer 页面供人工登录（如需要）。

| stdout status | 动作 |
|---|---|
| `logged_in` | 进入步骤 1.5 |
| `login_done` | 进入步骤 1.5 |
| `timeout` / `aborted` | 询问用户是否重试登录；重试则再次运行本命令 |
| `error` | 把 `reason` 反馈给用户并终止 |

### 步骤 1.5 · 检测页面特性

```bash
node <skill-root>/script/detect_page.mjs <url> [--timeout 120000]
```

检测页面是否为虚拟列表（仅渲染可见窗口、滚动回收顶项，无法全文转化）。复用步骤 1 写好的登录态。

| stdout status | 动作 |
|---|---|
| `scrollable` | 进入步骤 2 |
| `virtual_list` | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error` | 把 `reason` 反馈给用户并终止 |

### 步骤 2 · 清洗转换

```bash
node <skill-root>/script/clear_trans_html.mjs <url>
```

| stdout status | 动作 |
|---|---|
| `ok` | 记录 `sketch` 路径，进入步骤 3 |
| `error` | 把 `reason` 反馈给用户并终止 |

产物：`<skill-root>/working/<url-dir>/node_workflow/sketch.md` 与 `assets/`。

### 步骤 3 · 你负责转换特殊 DOM 元素

读 `working/<url-dir>/node_workflow/assets/manifest.json` 中 `status: "pending"` 的条目，按 `type` 分派：

| type | 处置 |
|---|---|
| `svg_convert` | 读 `draft` 路径的 HTML（已内联计算样式），生成**语义等价的 SVG**，存到同 workflow 的 `assets/complex/COMPLEX_DIV_n.svg`；把对应 `sketch.md` 中的 `{{COMPLEX_DIV_n}}` 替换为 `![COMPLEX_DIV_n](assets/complex/COMPLEX_DIV_n.svg)`；完成后把 manifest 该条 `status` 改为 `done` |
| `latex` | 读 `draft` 的公式渲染 DOM，反读 LaTeX 源码，把 `sketch.md` 中 `{{COMPLEX_DIV_n}}` 内联替换为 `$$公式$$`；manifest 改 `done` |

`passthrough_svg` / `screenshot` / `mermaid` / 已直出的 `latex` 均为 `status: "done"`，**不经你处理**（脚本已在 sketch.md 中替换完毕）。

### 步骤 4 · 你负责语义去噪

对 sketch.md 使用以下提示词清洗，写入 `working/<url-dir>/node_workflow/result.md`。

> 你是一个网页内容清洗专家。以下是网页转换的 Markdown 初稿。请去除其中的广告、推荐阅读、版权声明等无关内容，只保留核心正文。同时，请检查并修复其中的 Markdown 表格格式，确保其符合标准。去除多余的换行，空格。直接输出清洗后的 Markdown。**注意**：不要添加/修改/删除主体文本内容和原义。

清洗时把 `{{IMG_n}}` 替换为 `![IMG_n](assets/images/IMG_n.<ext>)`——扩展名以 `node_workflow` `assets/images/` 下实际文件为准。

### 步骤 5 · 人工选择 Markdown

```bash
node <skill-root>/script/render_markdown.mjs <url-dir> [--port 0] [--timeout 120000] [--open-timeout 5000] [--no-open]
```

`<url-dir>` 为 `working/` 下的 URL 目录名。浏览器双 Tab 打开，提醒用户人工选择。参数默认值：`--port` 0（随机端口）、`--open-timeout` 5000ms、`--timeout` 120000ms；另步骤 1 `login_url.mjs` 的 `--timeout` 默认 300000ms。

两个 Tab 分别渲染 `working/<url-dir>/<wf>/result.md`（缺失时降级该 workflow 的 sketch.md）；用户选定后脚本把该文件**复制到上一级** `working/<url-dir>/result.md`（即 stdout `path` 字段所指的最终交付物），复制时 `](assets/...)` 形式的相对资源引用会自动改写为 `](<wf>/assets/...)`，图片在新层级下仍可解析，不需手工修路径。

**无人值守/自动化场景**：加 `--no-open` 不弹浏览器；端口见 stderr `[render] 页面: http://127.0.0.1:<port> ...` 行。对页面地址的**第一个 HTTP 请求**即视为"页面已打开"，会取消打开自检（open-timeout）窗口并启动点击（timeout）窗口；随后可编程完成选择：

```bash
curl -X POST http://127.0.0.1:<port>/select -H 'Content-Type: application/json' -d '{"source":"node_workflow"}'
```

| stdout status | 动作 |
|---|---|
| `selected` | 完成。最终文件在 `path` 字段（`working/<url-dir>/result.md`），报告给用户 |
| `timeout` / `open_failed` | 告知用户可重跑本命令 |
| `error` | 把 `reason` 反馈给用户 |

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `login_url` 判定已登录但页面仍是登录墙 | 手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| 图片下载失败（warnings 中有"保留原 URL"） | 正常降级：Markdown 保留原图链接，不需处理 |
| sketch.md 中残留 `{{COMPLEX_DIV_n}}` 且 manifest 无对应项 | 该元素被当普通 DOM 转成了文本，人工检查是否需要补图 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `detect_page` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
