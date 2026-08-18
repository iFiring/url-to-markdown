# url-to-markdown 设计文档

- 日期：2026-08-18
- 状态：已经用户确认（三节设计均获批准）
- 来源：README.md（项目需求）+ brainstorming 会话澄清

## 1. 目标与非目标

### 目标

构建一个 Claude Code Skill：给定 URL，打开网页（处理登录墙），将主体内容转换为干净的 Markdown 文件。特殊元素（图表/公式等）由 LLM 转成 SVG，语义去噪由 LLM 完成，最终双稿由人工择优。

### 非目标

- 不做批量爬取、站点镜像
- 不覆盖把登录态存于 IndexedDB / Service Worker 的站点（storage_state 不含二者，见已知限制）

## 2. 总体架构

**代码组织：共享库 + 薄入口（方案 A）**——逻辑集中于可单测模块，入口脚本只做参数解析与编排；统一输出契约。

```text
script/
  init.sh                    # 环境自检与修复
  login_url.mjs              # 登录态检测与人工登录（薄入口）
  clear_trans_html.mjs       # Node 工作流（薄入口）
  clear_trans_html.py        # Python 工作流（薄入口）
  render_markdown.mjs        # 双稿人工择优（薄入口）
  lib/                       # Node 共享模块
    contract.mjs             # 输出契约：单行 JSON→stdout、日志→stderr、退出码
    env.mjs                  # URL→工作目录名、路径解析
    browser.mjs              # Playwright 上下文 + storageState 注入 + 媒体拦截
    detector.mjs             # 登录态六策略计分检测（移植 .temp/is_login_page.py）
    placeholder.mjs          # 占位符协议与复杂元素判定
  pylib/                     # Python 对应模块
    env.py / browser.py / placeholder.py
```

依赖：

- Node（package.json）：`playwright`、`ws`、`@mozilla/readability`、`turndown`、`@joplin/turndown-plugin-gfm`、`markdown-it`（render_markdown 用）；测试用内置 `node --test`
- Python（pyproject.toml，uv 管理）：`playwright`、`readability-lxml`、`markdownify`；dev：`pytest`
- `package.json` 预置 `pnpm.onlyBuiltDependencies: ["playwright"]`

## 3. 统一脚本契约

所有脚本对 Agent 的接口一致（沿用 `.temp/wait-click.mjs` 模式）：

| 通道 | 约定 |
|---|---|
| stdout | 有且仅有一行 JSON 结果（失败路径也输出后再退出） |
| stderr | 人类可读进度/诊断日志 |
| 退出码 | `0` 成功；`1` 失败/超时；`2` 参数错误 |

Agent 按 stdout JSON 的 `status` 字段分支决策。

## 4. 工作目录结构

每个 URL 一个目录，双工作流各自独立自包含（对 README 目录树的缩进歧义的裁决）：

```text
working/
  cookies/
    storage_state.json         # 单一全局登录态（cookie + localStorage 同文件）
  <url-dir>/                   # URL 特殊字符→下划线
    node_workflow/
      assets/
        draft/COMPLEX_DIV_1.html   # 复杂元素 HTML+内联CSS（脚本产物，待 LLM 转 SVG）
        complex/COMPLEX_DIV_1.svg  # LLM 转化产物（步骤3）
        images/IMG_1.png           # 下载的正文图片
      sketch.md                    # 脚本初清洗转换产物（含占位符）
      result.md                    # LLM 优化后的产物（步骤4）
    python_workflow/               # 与 node_workflow 同构
    result.md                      # 最终选定产物（步骤5 复制生成）
```

### 关键规则

- **URL → 目录名**：完整 URL（含协议与查询串）中所有非 `[A-Za-z0-9.-]` 字符替换为 `_`；超过 120 字符则截断到 120 并追加内容 8 位 hash 后缀
- **登录态存储**：`working/cookies/storage_state.json` 单一全局文件（Playwright `storage_state` 格式）。理由：SSO 跨域登录时一个上下文会累积多个域的 cookie，按域分文件会丢；全量注入时 Playwright 只发送匹配域的 cookie，多带无害
  - 写入：仅 `login_url.mjs` 写（登录完成后合并回写）；`clear_trans_html.*` 只读——并行无写冲突
  - 合并：cookie 按 `(name, domain, path)` 去重、新覆盖旧；localStorage 按 `origin + name` 去重覆盖
  - 加载时剔除 `expires < now` 的过期 cookie
- **媒体拦截**：所有 Playwright 上下文 route-block `video/audio` 等媒体类型请求

## 5. 端到端数据流

```text
init.sh（环境自检/修复，仅首次）
   │
login_url.mjs <url>          → {status: logged_in | login_done | timeout | aborted | error}
   │
clear_trans_html.mjs <url> ──┐ 并行、互不依赖、独立退出码
clear_trans_html.py  <url> ──┘ → 各自 workflow/sketch.md + assets/
   │
【步骤3 · LLM】draft/*.html → complex/*.svg，替换 sketch.md 占位符
【步骤4 · LLM】语义去噪 → 各 workflow/result.md
   │
render_markdown.mjs <url-dir> → 双 Tab 渲染两份 result.md，人工选择
   → {status: selected, source: ..., path: working/<url-dir>/result.md}
```

## 6. 脚本设计

### 6.1 `init.sh`

顺序自检与修复，**只修复缺失，不重复安装**：

1. Node ≥ 20：缺失/版本低 → nvm 安装；nvm 不存在或失败 → 报错退出
2. Python3 ≥ 3.11：缺失/版本低 → `uv python install`（有 uv 优先）否则 `brew install python@3.12`；都失败 → 报错退出
3. 包管理器探测：pnpm > yarn > npm；全无 → 报错退出（不自行安装）
4. Node 依赖：按探测结果安装（有 lock 文件走 frozen/CI 模式）
5. Python 依赖：uv 优先 `uv sync`；无 uv → `python3 -m venv .venv` + pip
6. chromium：已装（Playwright 缓存/executablePath 存在）则跳过；否则 `npx playwright install chromium`
7. 输出：成功 `{"status":"ok","node":"...","python":"...","pm":"pnpm","chromium":true}`；失败 `{"status":"error","reason":"..."}` 退出 1；降级等**警告走 stderr 不阻断**

### 6.2 `login_url.mjs`

CLI：`login_url.mjs <url> [--timeout 300000] [--port 0]`（port 0 = 随机可用端口，实际地址回显 stderr 并自动打开）

1. 无头 + 注入全局 storageState 打开 URL（`networkidle` 或 5s 兜底）
2. 六策略计分检测（`lib/detector.mjs`）：密码框 / URL 特征 / 内容关键词 / 认证 cookie 反查 / 重定向 / SPA 等待。**≥2 项命中判定需登录**；遍历全部 frames 检测 iframe 内登录表单
3. 已登录 → 刷新合并 storageState（续期）→ `{"status":"logged_in"}` 退出 0
4. 未登录 → Screencast 登录模式（复用 `.temp/login.mjs` 架构）：
   - 无头 chromium + CDP Screencast → 本地 HTTP+WS viewer 页面（自动 `open` 打开用户默认浏览器），用户在 viewer 中以鼠标/键盘/滚轮操控远程页面完成登录
   - viewer 提供 **"✅ 登录完成"按钮** → 脚本重新检测：通过 → 保存合并 storageState → `{"status":"login_done"}` 退出 0；不通过 → viewer 提示"仍未检测到登录态"，继续等待
   - 整体超时 → `{"status":"timeout"}` 退出 1
   - 用户关闭 viewer（WS 断开）→ 复检一次，未登录则 `{"status":"aborted"}` 退出 1

### 6.3 `clear_trans_html.mjs` / `clear_trans_html.py`

CLI：`clear_trans_html.mjs <url>` → `working/<url-dir>/node_workflow/`；`clear_trans_html.py <url>` → `working/<url-dir>/python_workflow/`。逻辑对称、产物隔离、可并行。

1. 注入 storageState 打开（`networkidle` / 5s 兜底）
2. **完整性保证（清理的前置条件）**：
   - 懒加载：渐进滚动到底再回顶；启动用超高 viewport（3000px）；**劫持 `IntersectionObserver`**——注入脚本使 callback 立即以 `isIntersecting=true` 触发
   - 虚拟 DOM：不移除任何元素，等待 DOM 稳定（节点数连续 1s 不变）
   - iframe 正文：主文档文本极少而某 iframe 文本量大 → 进入该 iframe 处理其 DOM
3. **占位符提取（转换前置）**：
   - 图片：并发下载（限 4）到 `assets/images/IMG_n.<ext>`（扩展名按响应 content-type；失败保留原 URL + stderr 警告）；DOM 替换为文本 `{{IMG_n}}`
   - 复杂元素：提取 outerHTML + 计算样式内联（遍历 computedStyle 写入 style 属性）→ `assets/draft/COMPLEX_DIV_n.html`；DOM 替换为 `{{COMPLEX_DIV_n}}`
4. 清理：Node `@mozilla/readability` / Python `readability-lxml`；额外移除 `video/audio/button`；保留主体 + CSS
5. 转换：Node `turndown` + `@joplin/turndown-plugin-gfm` / Python `markdownify` → `sketch.md`
6. 输出：`{"status":"ok","sketch":"<路径>","images":<n>,"complex":<n>,"warnings":[...]}`

**复杂元素判定**（`lib/placeholder.mjs` / `pylib/placeholder.py` 共享规则）：

- 命中即复杂：`canvas`、大尺寸内嵌 `svg`（>24×24 非图标）、`video`、内容型 `iframe`、`[role="img"]`、公式容器（`.MathJax`/`.katex`）、图表容器（`.chart`/`.echarts`/`.highcharts`/`[data-chart]`）
- 启发式：可见面积大 + 文本密度（字符数/面积）极低 + 非文本子元素 ≥3
- 父子都命中只取最外层

**占位符语义**：README 的 `{{COMPLEX_DIV_1,2,3}}` 解读为编号占位符族——每个元素独立占位（`{{COMPLEX_DIV_1}}`、`{{COMPLEX_DIV_2}}`…），图片同理 `{{IMG_1}}`。不存在一符多引用语法。

### 6.4 `render_markdown.mjs`

CLI：`render_markdown.mjs <url-dir> [--port 0] [--timeout 120000]`

1. 读两份 `result.md`（缺失降级读 `sketch.md`，页面标注"⚠️ 初稿"）
2. viewer 页面：两个 Tab（Node 版 / Python 版），`markdown-it` 本地渲染（无 CDN），`{{IMG_n}}` 还原为本地图片显示
3. 每 Tab 一个"✅ 选这个"按钮 → 提交后复制所选到 `<url-dir>/result.md` → `{"status":"selected","source":"node_workflow|python_workflow","path":"..."}` 退出 0
4. 两阶段超时对齐 `wait-click.mjs`：`open_failed`（open-timeout 内无请求）/ `timeout`（点击窗口超时）均退出 1

## 7. 错误处理总则

- 失败也守契约：先输出单行 JSON 再以对应退出码结束
- `init.sh` 失败 → Agent 终止全流程并把 reason 反馈用户
- 页面 `goto` 失败重试 1 次；Playwright 异常统一捕获为 `{"status":"error","reason":...}`
- 双工作流容错：独立退出码，一个失败不影响另一个；Agent 按实际产出的 sketch.md 数量决定步骤 4 是"择优"还是"单选"
- 登录 `timeout`/`aborted` → Agent 询问用户是否重试

## 8. 测试策略（本地夹具 + 冒烟）

```text
test/
  fixtures/
    static-article.html      # 标题/段落/图片/表格/代码块
    login-wall.html          # 密码框+"登录"关键词+跳转参数
    logged-in.html           # 模拟已登录（配合 cookie 检测）
    lazy-load.html           # IntersectionObserver 懒加载图片
    iframe-content.html      # 主文档近乎空、正文在 iframe
    complex-elements.html    # canvas/大 svg/图表容器/公式
    nav-noise.html           # nav/footer/aside/广告位噪声
  helpers/                   # 夹具 HTTP 服务器（随机端口）
  unit/                      # node --test + pytest
  integration/               # 起夹具服务→跑真脚本→断言产物与 stdout 契约
  smoke/SMOKE.md             # 真实 URL 手动冒烟清单（不入自动测试）
```

- 单测：URL→目录名、占位符编号、storageState 合并/过期清理、检测器各策略、复杂元素判定
- 集成：每脚本对夹具全流程，断言 stdout 单行 JSON、产物、退出码
- 冒烟：真实静态文章页 + 真实登录墙页各 1，手动
- 全程 TDD：先写测试看失败，再实现

## 9. SKILL.md 设计

- 中文；frontmatter 沿用 README：`name: url-to-markdown`、`description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"`
- 结构：Overview → 何时使用/不用 → 步骤 0-5 操作手册（每步：命令、产物路径、status 分支决策表）→ 步骤 3 SVG 转化指导（读 `draft/COMPLEX_DIV_n.html` → 语义等价 SVG 存 `complex/` → 将 sketch.md 中 `{{COMPLEX_DIV_n}}` 替换为 `![COMPLEX_DIV_n](assets/complex/COMPLEX_DIV_n.svg)`）→ 步骤 4 清洗提示词（README 原文）→ 常见错误处理表
- 按 writing-skills 的 TDD：完成后做 baseline 测试——子代理不带 SKILL.md 执行"把这个 URL 转成 Markdown"记录失败模式；带 SKILL.md 复测验证

## 10. 开发阶段（连续执行，随阶段更新 README 进度表）

| # | 阶段 | 内容 |
|---|---|---|
| 1 | 项目结构 | git init、package.json/pyproject.toml、lib/pylib/测试骨架、依赖锁定 |
| 2 | init.sh | 环境自检修复 |
| 3 | 共享库 | contract/env/browser（+pylib）TDD |
| 4 | login_url.mjs | detector + Screencast viewer |
| 5 | clear_trans_html.mjs | placeholder + readability + turndown |
| 6 | clear_trans_html.py | readability-lxml + markdownify |
| 7 | render_markdown.mjs | 双 Tab 择优 |
| 8 | SKILL.md | 编写 + baseline 测试 |
| 9 | 收尾 | 真实冒烟、按 Skill 文件夹结构整理交付物 |

执行方式：subagent-driven-development 连续执行，每阶段 code review 检查点，README 进度表随阶段更新，最后统一验收。

## 11. 验收标准

1. 全部单测/集成测试绿
2. 冒烟：真实静态页 + 登录墙页端到端各 1 次成功
3. SKILL.md baseline 测试通过（子代理按手册正确走完 0-5 步）

## 12. 已知限制

- storage_state 不含 IndexedDB / Service Worker——登录态存于二者的站点无法保持登录
- Screencast 为 JPEG 流级别操控（非 DOM 级），极端复杂交互（如拖拽滑块验证码）可能不顺
- 复杂元素判定为启发式，可能漏判/误判——LLM 步骤 3 可人工纠偏（漏判的元素已作为普通 DOM 转成文本）
