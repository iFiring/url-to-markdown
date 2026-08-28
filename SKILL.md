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
- 你自己负责 "步骤 3" 和 "步骤 7" 的语义化操作：当你有权限调用子智能体（Sub-Agent）时，**优先把任务交给子智能体**

## 核心参数

- `<url>`：指用户给定的完整 URL；步骤 0 的必填参数
- `<skill-root>`：本技能 SKILL.md 所在目录（**绝对路径**）；由步骤 0 生成
- `<url-name>`：由步骤 0 通过 `replace(/[^A-Za-z0-9.-]/g, '_')` 生成（剥去 `http(s)://` 前缀）
- `<url-working-path>`：当前 URL 的专属目录 `<skill-root>/working/<url-name>`；由步骤 0 生成；步骤 0 之后的产物都存放在此目录下

本技能目录结构：

```
SKILL.md                 # Skill 主体文件
script/                  # 脚本
references/              # 步骤 3/7 的任务说明（渐进披露）
package.json

working/                 # 工作目录
  cookies/               # 所有访问过 URL 的 cookie 公共存储目录；由步骤 1 生成
  <url-name>/            # 当前 URL 的专属目录 `<skill-root>/working/<url-name>`
    assets/
      images/
      trans/
    1_snapshot.html
    ...
    9_markdown.md 
``` 

## 操作手册（步骤 0-9）

### 步骤 0 · 初始化执行环境和参数

```bash
bash <skill-root>/script/init.sh --url <url>
```

| stdout.status | 动作 |
|---|---|
| `ok` | 拿到 `stdout`的 `skill-root` / `url-name` / `<url-working-path>`，作为**核心参数**，进入步骤 1 |
| `error` | **终止全部流程**，把 `stdout.reason` 反馈给用户 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "skill-root": "/root/path/to/skill",
  "url-name": "_name_",
  "url-working-path": "/root/path/to/skill/working/_name_"
}
```

### 步骤 1 · 快照下载

```bash
node <skill-root>/script/snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60]
```

单条命令依次完成登录检测（需要时弹出 Screencast viewer 供人工登录）、渐进滚动、虚拟列表检测、全保真快照抓取。

产物：`<url-working-path>/1_snapshot.html`（产物生成后，不要擅自读取内容）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 2 |
| `error`（reason=`virtual_list`） | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error`（reason=`login_timeout`/`login_aborted`） | 询问用户是否重试登录；重试则再次运行本命令 |
| `error`（其他） | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 2 · 用脚本清洗结构

```bash
node <skill-root>/script/clean_snapshot.mjs --url <url>
```

产物：
```
<url-working-path>/
  2_clean_snapshot.html        # 结构视图
  2_clean_style_snapshot.html  # 结构视图（带样式版）
  2_long_text.json             # 占位符原文映射
``` 

产物生成后，不要擅自读取内容

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 3 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 3 · 你负责关键 ID 识别

**可调用子智能体时，优先把任务交给子智能体**

#### 任务（提示词/Prompt）

- 必须严格按照手册 `<skill-root>/references/analyze_html_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write" 工具（读取 `2_clean_snapshot.html`，写入 `3_key_ids.json`），其他文件和你完全无关
- 当前工作路径(<url-working-path>): `/path/to/XXX`

#### 后续

当产物 `<url-working-path>/3_key_ids.json` 完成后，进入步骤 4

### 步骤 4 · 用脚本裁剪 DOM

```bash
node <skill-root>/script/extract_styled.mjs --url <url>
```

产物：`<url-working-path>/4_styled_extract.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 5。 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 5 · 用脚本计算内联样式

```bash
node <skill-root>/script/compute_styles.mjs --url <url>
```

产物：`<url-working-path>/5_juice_styles.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 6。 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 6 · 用脚本提取视图

```bash
node <skill-root>/script/extract_article.mjs --url <url>
```

产物：`<url-working-path>/6_article.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 7。|
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 7 · 你负责 markdown 骨架生成

> **可调用子智能体时，优先把任务交给子智能体**

#### 任务（提示词/Prompt）

- 必须严格按照手册 `<skill-root>/references/markdown_skeleton_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write" 工具（读取 `6_article.html`，写入 `7_skeleton.json`），其他文件和你完全无关
- 当前工作路径(<url-working-path>): `/path/to/XXX`

#### 后续

当产物 `<url-working-path>/7_skeleton.json` 完成后，进入步骤 8

### 步骤 8 · 用脚本还原占位符 + 图片下载

```bash
node <skill-root>/script/screenshot_trans.mjs --url <url>
```

产物：`<url-working-path>/8_resolved_skeleton.json`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 9。 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 9 · 用脚本将骨架转换为 Markdown

```bash
node <skill-root>/script/render_skeleton.mjs --url <url>
```

产物：`<url-working-path>/9_markdown.md`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，所有步骤完成 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `init.sh`(Linux) 报 fontconfig/字体安装失败（需 root/sudo） | 步骤 0 自动修复未成功（无 root 或无包管理器）：请用户以 root 手动安装 fontconfig 与字体（西文如 liberation、中文如 noto-cjk）后重试步骤 0；不装的话 chromium 渲染任何带文字的页面都会 FATAL 崩溃 |
| `snapshot` 判定已登录但页面仍是登录墙 | 请用户手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| `snapshot` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `clean_snapshot` 报找不到快照 | 先运行步骤 1 生成 `1_snapshot.html` |
| `extract_article` 报找不到纯内联视图 | 先运行步骤 5 生成 `5_juice_styles.html` |
| `extract_styled` / `extract_article` 报找不到 key_ids | 先运行步骤 3 生成 `3_key_ids.json` |
