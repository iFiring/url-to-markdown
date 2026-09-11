---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

# url-to-markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

## 何时使用

- 把单个 URL 的正文转为 Markdown 文件

## 工作原则

- 没有明确要求或流程需要的话，你**不要去读脚本的产物及其内容**，仅需确认执行了命令，产物存在即可
- 你自己负责 "步骤 2" 和 "步骤 4" 的语义化操作：当你有权限调用子智能体（Sub-Agent）时，**优先把任务交给子智能体**

## 核心参数

- `<url>`：指用户给定的完整 URL；所有 CLI 的必填参数

> 以下参数由步骤 1 输出，全局使用
- `<skill-root>`：本技能 SKILL.md 所在目录（**绝对路径**）
- `<url-name>`：当前 URL 的专属目录名；`replace(/[^A-Za-z0-9.-]/g, '_')` 生成（剥去 `http(s)://` 前缀）。**内嵌占优内容 iframe 的页面为特殊名 `redirected_<原名>`**（管线已自动重定向到 frame 真实 URL 转换）
- `<url-working-path>`：当前 URL 的专属目录 `<skill-root>/working/<url-name>`；其后产物都存放在此目录下

本技能目录结构：

```
SKILL.md                 # Skill 主体文件
script/                  # 脚本
references/              # 步骤 2/4 的任务说明（渐进披露）
package.json

working/                 # 工作目录
  cookies/               # 所有访问过 URL 的 cookie 公共存储目录；由步骤 1 生成
  <url-name>/            # 当前 URL 的专属目录 `<skill-root>/working/<url-name>`
  redirected_<url-name>/ # iframe 重定向页的专属目录（内含 redirect_to.yaml 标记）
    assets/
      images/
      trans/
    1_snapshot.html
    ...
    5_markdown.md
```

## 操作手册（步骤 0-5）

### 步骤 0 · 初始化执行环境

```bash
bash <skill-root>/script/init.sh
```

| stdout.status | 动作 |
|---|---|
| `ok` | 环境就绪，进入步骤 1 |
| `error` | **终止全部流程**，把 `stdout.reason` 反馈给用户 |

纯环境自检（node/pnpm/chromium/字体），不产出 URL 相关参数。**stdout.status=ok 结构示例**
```json
{ "status": "ok", "skill-root": "/root/path/to/skill", "node": "20.x", "pm": "pnpm", "chromium": true }
```

### 步骤 1 · 快照下载 + 结构清洗

```bash
node <skill-root>/script/snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60] [--table-engine self|turndown]
```

单条命令一气呵成（原步骤 1/2 合并，单 chromium 实例贯穿）：登录检测（需要时自动打开浏览器弹出 Screencast viewer 供人工登录）→ 渐进滚动 → **重定向门**（占优内容 iframe → 自动跳转 frame 真实 URL 续跑）→ 虚拟列表检测 → 全保真快照抓取，随后同一浏览器对快照做两趟结构清洗（带样式版供步骤 3 裁剪、清洗版供步骤 2 判读；表格/代码块预计算 markdown）。

可选参数：
- `--table-engine self|turndown`（或 `U2M_TABLE_ENGINE`，默认 `self`）：表格占位符转换引擎
- `--from-snapshot`：跳过抓取五阶段，直接读工作目录已有 `1_snapshot.html` 进清洗——换表格引擎重跑、清洗逻辑升级后的重放用（不重新访问网络）

产物（生成后不要擅自读取内容）：
```
<url-working-path>/
  1_snapshot.html               # 全保真快照
  1_clean_snapshot.html         # 结构视图（步骤 2 输入）
  1_clean_style_snapshot.html   # 带样式版（步骤 3 输入）
  1_long_text.json              # 占位符原文映射（texts 散文本 + runs 行内 run 规范化 HTML）
  1_tables.json / 1_code.json   # 表格/代码块预计算
```

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 2。`redirect` 字段仅信息通报（管线内部已消化），步骤 2 起仍以原始 `<url>` 调用各脚本；`<url-name>`/`<url-working-path>` 以本行 stdout 为准（重定向页是特殊名）；`tables.failed`/`codes.failed` 是合法分支（下游 LLM 兜底），无需处理 |
| `error`（reason=`virtual_list`） | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error`（reason=`login_timeout`/`login_aborted`） | 询问用户是否重试登录；重试则再次运行本命令 |
| `error`（其他） | 把 `stdout.reason` 反馈给用户并终止；若 `1_snapshot.html` 已落盘（错误发生在清洗阶段），可加 `--from-snapshot` 重试、免重新抓取 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "snapshot": "/path/1_snapshot.html",
  "elements": 123,
  "skill-root": "/root/path/to/skill",
  "url-name": "redirected_www.example.com_article__ai-article_skill",
  "url-working-path": "/root/path/to/skill/working/redirected_www.example.com_article__ai-article_skill",
  "redirect": { "to": "https://www.example.com/article/skill.html" },
  "loginSkippedByMemory": null,
  "cleanedSnapshot": "/path/1_clean_snapshot.html",
  "styledSnapshot": "/path/1_clean_style_snapshot.html",
  "longText": "/path/1_long_text.json",
  "longTextCount": { "texts": 12, "runs": 8, "total": 20 },
  "tables": { "total": 3, "ok": 3, "failed": 0 },
  "tablesJson": "/path/1_tables.json",
  "codes": { "total": 2, "ok": 2, "failed": 0 },
  "codeJson": "/path/1_code.json",
  "viewText": { "count": 5 },
  "chrome": { "removed": 9, "cssHiddenFolded": 1, "dialogFolded": 0, "overlayFolded": 2, "commentsRemoved": 14 }
}
```

### 步骤 2 · 你负责关键 ID 识别

**可调用子智能体时，优先把任务交给子智能体**

#### 任务（提示词/Prompt）

- 必须严格按照手册 `<skill-root>/references/analyze_html_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write/Edit" 工具（**完整读取** `1_clean_snapshot.html`，写入 `2_key_ids.json`），其他文件和你完全无关
- 当前工作路径: `/path/to/xxx`（取步骤 1 stdout 的 `url-working-path`）
- 不要总结报告，只需产出 `2_key_ids.json` 即可

#### 后续

当产物 `<url-working-path>/2_key_ids.json` 完成后，进入步骤 3

### 步骤 3 · 用脚本渲染文章视图

```bash
node <skill-root>/script/render_article.mjs --url <url>
```

单个 chromium 实例三轮处理一气呵成（裁剪 DOM → 内联样式 → 提取文章视图 + 瘦身 + 分块，原步骤 4/5/6 合并）。

产物：`<url-working-path>/3_article.html`（始终产出）；超过 60KB 时另产出分块 `3_article_chunk_X_of_N.html`（主内容 ≤40KB、只读上下文侧不计，每块带 ✅/❌ 转换边界标记——首块 ✅ 在 body 开头、末块 ❌ 在 body 末尾）（你自己不要去读脚本的产物内容，确认有即可）；调试中间产物 `3_extract.html` / `3_juice.html` 同轮落盘

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 4——`chunks.split=true` 时步骤 4 按 `chunks.files` 并行派发子代理；`false` 时单子代理照旧 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "article": "/path/3_article.html",
  "elementCount": 509,
  "removedCount": 123,
  "keptCount": 45,
  "dumpCollapsedCount": 2,
  "styledCount": 2632,
  "slim": {},
  "chunks": { "split": true, "count": 8, "files": ["/path/3_article_chunk_1_of_8.html"] }
}
```

### 步骤 4 · 你负责 markdown 骨架生成

> **可调用子智能体时，优先把任务交给子智能体**

#### 未分割（步骤 3 stdout `chunks.split=false`）

单个子代理，任务提示词：

- 必须严格按照手册 `<skill-root>/references/markdown_skeleton_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write/Edit" 工具（**完整读取** `3_article.html`，一次性写入 `4_skeleton.json`），其他文件和你完全无关
- 当前工作路径: `/path/to/xxx`（取步骤 1 stdout 的 `url-working-path`）
- 不要总结报告，只需产出 `4_skeleton.json` 即可

#### 已分割（步骤 3 stdout `chunks.split=true`）

**单条消息并行派发 `chunks.count` 个子代理**，每个子代理的任务提示词按各自分块文件定制（X 为分块号、N 为总块数）：

- 必须严格按照手册 `<skill-root>/references/markdown_skeleton_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write/Edit" 工具（**完整读取** `3_article_chunk_X_of_N.html`，一次性写入 `4_skeleton_chunk_X_of_N.json`），其他文件和你完全无关
- 当前工作路径: `/path/to/xxx`（取步骤 1 stdout 的 `url-working-path`）
- 不要总结报告，只需产出 `4_skeleton_chunk_X_of_N.json` 即可

#### 后续

- 未分割：产物 `<url-working-path>/4_skeleton.json` 完成后进入步骤 5
- 已分割：**全部 `chunks.count` 个分片文件都存在**后进入步骤 5（步骤 5 会自动检测并合并分片）；个别分片失败/缺失时重新派发该分片一次，仍失败则把缺失清单反馈用户并终止

### 步骤 5 · 用脚本还原占位符 + 图片下载 + 截图 + 生成 Markdown（终态步骤）

```bash
node <skill-root>/script/render_markdown.mjs --url <url>
```

产物：`<url-working-path>/5_markdown.md`（最终产物，路径见 stdout 的 `markdownPath`；你自己不要去读脚本的产物内容，确认有即可）；中间产物 `5_resolved_skeleton.json` 与 `assets/` 同轮落盘

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，**所有步骤完成**（`skipped: "no_trans2img"` 仅信息通报，无需处理） |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `init.sh`(Linux) 报 fontconfig/字体安装失败（需 root/sudo） | 步骤 0 自动修复未成功（无 root 或无包管理器）：请用户以 root 手动安装 fontconfig 与字体（西文如 liberation、中文如 noto-cjk）后重试步骤 0；不装的话 chromium 渲染任何带文字的页面都会 FATAL 崩溃 |
| `snapshot` 判定已登录但页面仍是登录墙 | 请用户手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| `snapshot` 对无需登录的页面弹出登录 viewer | 用户在 viewer 点「⏭️ 跳过登录」并确认即可继续，本次命中的弱信号按站点记入 `working/cookies/login_decisions_skips.json`（后续命中全在记忆内不再弹 viewer，emit 以 `loginSkippedByMemory` 通报；强信号不记忆、跳过仅本次生效）；想重置裁决则删除该文件对应域名条目后重跑步骤 1 |
| `snapshot` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `snapshot --from-snapshot` 报找不到快照 | 去掉 `--from-snapshot` 重新运行本命令（重新抓取快照） |
| `render_article` 报找不到带样式版快照 | 先运行步骤 1 生成 `1_clean_style_snapshot.html` |
| `render_markdown` 报 code 条目 value 应为 `{lang, content}` 对象 | 步骤 4 引用了未还原的代码占位符（`1_code.json` 中不存在或 failed 的 k）：检查 `4_skeleton.json` 的 code 条目——占位符块用 `{"code": "{{CODE_k}}"}` 引用、live 代码块自转（见骨架指南），修正后重跑步骤 5 |
| `render_article` / `render_markdown` 报找不到 key_ids | 先运行步骤 2 生成 `2_key_ids.json` |
