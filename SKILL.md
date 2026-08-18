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
| `logged_in` | 进入步骤 2 |
| `login_done` | 进入步骤 2 |
| `timeout` / `aborted` | 询问用户是否重试登录；重试则再次运行本命令 |
| `error` | 把 `reason` 反馈给用户并终止 |

### 步骤 2 · 双工作流清洗转换（可并行）

```bash
node <skill-root>/script/clear_trans_html.mjs <url>
```

```bash
cd <skill-root> && .venv/bin/python script/clear_trans_html.py <url>
# 若 .venv 不存在（例如环境用 uv 托管）：uv run python script/clear_trans_html.py <url>
```

两条命令互不依赖，可并行执行、独立退出码。

| stdout status | 动作 |
|---|---|
| `ok` | 记录 `sketch` 路径；两个都成功 → 步骤 3 |
| `error`（单个） | 不影响另一条；按实际成功的数量继续（只有一个成功则后续"单选"） |
| 两条都 `error` | 把 reason 反馈给用户并终止 |

产物：`<skill-root>/working/<url-dir>/<node_workflow|python_workflow>/sketch.md` 与 `assets/`。

### 步骤 3 · 你负责转换特殊 DOM 元素

读 `working/<url-dir>/node_workflow/assets/manifest.json` 与 `python_workflow/assets/manifest.json` 中 `status: "pending"` 的条目，按 `type` 分派（两个 workflow 各处理各的）：

| type | 处置 |
|---|---|
| `svg_convert` | 读 `draft` 路径的 HTML（已内联计算样式），生成**语义等价的 SVG**，存到同 workflow 的 `assets/complex/COMPLEX_DIV_n.svg`；把对应 `sketch.md` 中的 `{{COMPLEX_DIV_n}}` 替换为 `![COMPLEX_DIV_n](assets/complex/COMPLEX_DIV_n.svg)`；完成后把 manifest 该条 `status` 改为 `done` |
| `latex` | 读 `draft` 的公式渲染 DOM，反读 LaTeX 源码，把 `sketch.md` 中 `{{COMPLEX_DIV_n}}` 内联替换为 `$$公式$$`；manifest 改 `done` |

`passthrough_svg` / `screenshot` / `mermaid` / 已直出的 `latex` 均为 `status: "done"`，**不经你处理**（脚本已在 sketch.md 中替换完毕）。

### 步骤 4 · 你负责语义去噪

对每份处理完的 sketch.md 使用以下提示词清洗，写入同目录 `result.md`：

> 你是一个网页内容清洗专家。以下是两份网页转换的 Markdown 初稿。请去除其中的广告、推荐阅读、版权声明等无关内容，只保留核心正文。同时，请检查并修复其中的 Markdown 表格格式，确保其符合标准。去除多余的换行，空格。直接输出清洗后的 Markdown。**注意**：不要添加/修改/删除主体文本内容和原义。

清洗时把 `{{IMG_n}}` 替换为 `![IMG_n](assets/images/IMG_n.<ext>)`——扩展名以该 workflow `assets/images/` 下实际文件为准。若只有一个 workflow 产出，则"两份"按一份处理。

### 步骤 5 · 人工选择 Markdown

```bash
node <skill-root>/script/render_markdown.mjs <url-dir> [--timeout 120000]
```

`<url-dir>` 为 `working/` 下的 URL 目录名。浏览器双 Tab 打开，提醒用户人工选择。

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
| 双工作流其一失败 | 用另一份继续步骤 3-5（单选模式） |
