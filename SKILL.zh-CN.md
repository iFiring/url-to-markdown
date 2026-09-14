---
name: url-to-markdown-zh
description: "将 URL（网页）的主体内容转换成干净的 Markdown；在需要将 URL、网页或在线文章转为 Markdown 文件时使用——支持登录墙页面、表格、代码块、LaTeX 公式、Mermaid 图表与 SVG。（中文版）"
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
- `<url-name>`：当前 URL 的专属目录名。**占优内容 iframe 页面为特殊名 `redirected_<原名>`**（管线已自动重定向到 frame 真实 URL）
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

纯环境自检（node/pnpm/chromium/字体）。**stdout.status=ok 结构示例**
```json
{ "status": "ok", "skill-root": "/root/path/to/skill", "node": "20.x", "pm": "pnpm", "chromium": true }
```

### 步骤 1 · 快照下载 + 结构清洗

```bash
node <skill-root>/script/snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60] [--table-engine self|turndown]
```

单条命令完成网页抓取与结构清洗：**人机门禁**（登录检测 / 验证码与滑块检测 / 稀薄内容兜底——需要时自动弹出浏览器 viewer 供人工登录、人工验证或确认页面状态，解决后自动回环复检；viewer 超时从你打开它才开始计算）→ 滚动加载 → 重定向处理（占优内容 iframe 自动跳转真实 URL，目标页同样过登录与验证门禁）→ 虚拟列表检测 → 快照抓取 + 结构清洗（表格/代码块预计算 markdown）。

可选参数：
- `--table-engine self|turndown`（或 `U2M_TABLE_ENGINE`，默认 `self`）：表格占位符转换引擎
- `--from-snapshot`：跳过抓取，直接用工作目录已有 `1_snapshot.html` 进清洗（不重新访问网络）

产物（生成后不要擅自读取内容）：
```
<url-working-path>/
  1_snapshot.html               # 全保真快照
  1_clean_snapshot.html         # 结构视图（步骤 2 输入）
  1_clean_style_snapshot.html   # 带样式版（步骤 3 输入）
  1_long_text.json              # 长文本占位符原文映射
  1_tables.json / 1_code.json   # 表格/代码块预计算
```

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 2；`<url-name>`/`<url-working-path>` 以本行 stdout 为准（重定向页是特殊名），`redirect` 字段仅通报（后续步骤仍用原始 `<url>`） |
| `error`（reason=`virtual_list`） | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error`（reason=`login_timeout`/`login_aborted`） | 询问用户是否重试登录；重试则再次运行本命令 |
| `error`（reason=`captcha_timeout`/`captcha_aborted`） | 人机验证 viewer 超时或被关闭：询问用户是否已准备好完成验证，确认后再次运行本命令（验证通过的站点会留下通行 cookie，重跑常可直接通过） |
| `error`（reason=`gate_aborted`/`gate_timeout`） | 页面正文极少（疑似未识别的验证页/访问拦截，也可能本就是空页面）且人工确认窗被弃用：询问用户该 URL 是否确有内容；重试可在窗口点「仍然继续」（将记住该站不再询问） |
| `error`（reason=`http_404`） | 目标页不存在（404 且无正文）：告知用户检查 URL，**勿重试** |
| `error`（reason=`gate_loop_limit`） | 站点连环弹出门禁（3 次人工介入后仍未稳定）：告知用户该 URL 无法自动抓取，建议放弃或改用其他抓取方式 |
| `error`（其他） | 把 `stdout.reason` 反馈给用户并终止；若 `1_snapshot.html` 已落盘，可加 `--from-snapshot` 重试、免重新抓取 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "skill-root": "/root/path/to/skill",
  "url-name": "redirected_www.example.com_article__ai-article_skill",
  "url-working-path": "/root/path/to/skill/working/redirected_www.example.com_article__ai-article_skill",
  "redirect": { "to": "https://www.example.com/article/skill.html" },
  "loginSkippedByMemory": null
}
```

### 步骤 2 · 你负责关键 ID 识别

**可调用子智能体时，优先把任务交给子智能体**

#### 任务（提示词/Prompt）

派发前替换提示词中的 `<skill-root>`、`<url-working-path>` 为步骤 1 stdout 对应字段：

> 你是网页 DOM 分析专家，请按照手册要求，读取 HTML 文件并生成结构化 JSON。
>
> **任务**
>
> 1. 读取任务手册: `<skill-root>/references/analyze_html_guide.md`
> 2. 一次性完整读取并分析: `<url-working-path>/1_clean_snapshot.html`
> 3. 分析后一次性完整写入: `<url-working-path>/2_key_ids.json`
>
> **原则**
> - 不要读取其他文件，和你完全无关
> - 任务期间你只能使用 "Read/Write/Edit" 工具
> - 写入 JSON 后不要总结报告，输出"任务完成"即可

#### 后续

当产物 `<url-working-path>/2_key_ids.json` 完成后，进入步骤 3

### 步骤 3 · 用脚本渲染文章视图

```bash
node <skill-root>/script/render_article.mjs --url <url>
```

依据关键 ID 从带样式版快照渲染出文章视图（裁剪 DOM → 内联样式 → 提取瘦身）。

产物：`<url-working-path>/3_article.html`；超过 60KB 时另产出分块 `3_article_chunk_X_of_N.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 4——`chunks.split=true` 时步骤 4 按 `chunks.files` 并行派发子代理；`false` 时单子代理照旧 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "chunks": { "split": true, "count": 8, "files": ["/path/3_article_chunk_1_of_8.html"] }
}
```

### 步骤 4 · 你负责 markdown 骨架生成

> **可调用子智能体时，优先把任务交给子智能体**

#### 未分割（步骤 3 stdout `chunks.split=false`）

单个子代理，任务提示词（派发前替换其中的 `<skill-root>`、`<url-working-path>` 为步骤 1 stdout 对应字段）：

> 你是 markdown 骨架生成专家，请按照手册要求，读取 HTML 文章视图并生成结构化 JSON。
>
> **任务**
>
> 1. 读取任务手册: `<skill-root>/references/markdown_skeleton_guide.md`
> 2. 一次性完整读取并分析: `<url-working-path>/3_article.html`
> 3. 分析后一次性完整写入: `<url-working-path>/4_skeleton.json`
>
> **原则**
> - 不要读取其他文件，和你完全无关
> - 任务期间你只能使用 "Read/Write/Edit" 工具
> - 写入 JSON 后不要总结报告，输出"任务完成"即可

#### 已分割（步骤 3 stdout `chunks.split=true`）

**单条消息并行派发 `chunks.count` 个子代理**，每个子代理的任务提示词按各自分块文件定制（X 为分块号、N 为总块数；派发前替换其中的 `<skill-root>`、`<url-working-path>` 为步骤 1 stdout 对应字段）：

> 你是 markdown 骨架生成专家，请按照手册要求，读取 HTML 文章视图并生成结构化 JSON。
>
> **任务**
>
> 1. 读取任务手册: `<skill-root>/references/markdown_skeleton_guide.md`
> 2. 一次性完整读取并分析: `<url-working-path>/3_article_chunk_X_of_N.html`
> 3. 分析后一次性完整写入: `<url-working-path>/4_skeleton_chunk_X_of_N.json`
>
> **原则**
> - 不要读取其他文件，和你完全无关
> - 任务期间你只能使用 "Read/Write/Edit" 工具
> - 写入 JSON 后不要总结报告，输出"任务完成"即可

#### 后续

- 未分割：产物 `<url-working-path>/4_skeleton.json` 完成后进入步骤 5
- 已分割：**全部 `chunks.count` 个分片文件都存在**后进入步骤 5（步骤 5 会自动检测并合并分片）；个别分片失败/缺失时重新派发该分片一次，仍失败则把缺失清单反馈用户并终止

### 步骤 5 · 用脚本还原占位符 + 图片下载 + 截图 + 生成 Markdown（终态步骤）

```bash
node <skill-root>/script/render_markdown.mjs --url <url>
```

产物：`<url-working-path>/5_markdown.md`（最终产物，路径见 stdout 的 `markdownPath`；你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，**所有步骤完成**（`skipped: "no_trans2img"` 仅信息通报，无需处理） |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

**stdout.status=ok 结构示例**
```json
{ "status": "ok", "markdownPath": "/path/5_markdown.md" }
```

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `init.sh`(Linux) 报 fontconfig/字体安装失败（需 root/sudo） | 步骤 0 自动修复未成功（无 root 或无包管理器）：请用户以 root 手动安装 fontconfig 与字体（西文如 liberation、中文如 noto-cjk）后重试步骤 0；不装的话 chromium 渲染任何带文字的页面都会 FATAL 崩溃 |
| `snapshot` 判定已登录但页面仍是登录墙 | 请用户手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| `snapshot` 对无需登录的页面弹出登录 viewer | 用户在 viewer 点「⏭️ 跳过登录」并确认即可继续（该站点后续不再弹，emit 以 `loginSkippedByMemory` 通报）；想重置裁决则删除 `working/cookies/login_decisions_skips.json` 对应域名条目后重跑步骤 1（该文件同时存放「稀薄内容仍然继续」的 `content_sparse` 裁决） |
| `snapshot` 弹出人机验证 viewer（滑块/点选） | viewer 支持鼠标拖拽与键盘中继——直接在画面里拖动滑块或点击验证，完成后点「✅ 验证完成」；该窗口没有跳过按钮（跳过只会抓到挑战页），弃窗将报 `captcha_aborted` |
| 人工过了验证但 `snapshot` 仍反复弹验证 viewer | 站点风控可能拒绝无头浏览器痕迹（已知边界，人工轨迹正确也可能被拒）：重跑重试一次，仍失败建议放弃该站 |
| `snapshot` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `snapshot --from-snapshot` 报找不到快照 | 去掉 `--from-snapshot` 重新运行本命令（重新抓取快照） |
| `render_article` 报找不到带样式版快照 | 先运行步骤 1 生成 `1_clean_style_snapshot.html` |
| `render_markdown` 报 code 条目 value 应为 `{lang, content}` 对象 | 步骤 4 引用了未还原的代码占位符（`1_code.json` 中不存在或 failed 的 k）：检查 `4_skeleton.json` 的 code 条目——占位符块用 `{"code": "{{CODE_k}}"}` 引用、live 代码块自转（见骨架指南），修正后重跑步骤 5 |
| `render_article` / `render_markdown` 报找不到 key_ids | 先运行步骤 2 生成 `2_key_ids.json` |
