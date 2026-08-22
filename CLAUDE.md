# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 本仓库是什么

一个 Claude Code Skill 的源码：给定 URL，把网页主体内容转换成干净的 Markdown。`SKILL.md` 是技能的操作手册（步骤 0-5）；`script/` 下的 CLI 由遵循该手册的 agent 调用。

## 常用命令

```bash
bash script/init.sh                              # 环境自检与修复（幂等；stdout 输出一行 JSON）
pnpm test                                        # Node 单测（node --test test/unit/*.test.mjs）
pnpm run test:integration                        # Node 集成（真 chromium + 本地夹具服务器）
pnpm test:all                                    # Node 单测 + 集成

# 单文件 / 单用例
node --test test/unit/contract.test.mjs
node --test test/integration/render.test.mjs
npx playwright install chromium                  # 浏览器缓存
```

环境要求：node ≥20（nvm）、pnpm > yarn > npm。未配置 linter。测试以子进程方式启动真实 CLI、对接随机端口的夹具服务器；集成测试需要已安装 chromium。

## 输出契约即产品

每个 CLI（含 init.sh）必须向 stdout 输出**恰好一行 JSON**——失败路径也不例外——日志走 stderr，退出码 0/1/2（usage_error=2）。agent 依据 SKILL.md 的决策表对 `status` 字段分支；破坏这一点就破坏了整个技能。

**emit 延迟退出陷阱**：`script/lib/contract.mjs` 的 `emit()` 先写行、再在**写回调**里 `process.exit`——它本身会同步返回。任何在 `usage()`/`emit()` 之后继续执行的代码都可能输出第二行、或以零行崩溃。所有 CLI 都用 `return usage(...)` / parseArgs 返回 null + 提前 return 防护。改动 CLI 参数处理或新增 emit 路径时必须保持该模式。

## 架构

**共享页面脚本是分类的唯一事实源。** `script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2mXxx(...)`。Node 工作流把它当**文本**读入并注入页面（`readSharedScript` + evaluate）。分类规则、清理、iframe 合并、样式内联、LaTeX 提取、虚拟列表检测（`page-detect.js` / `__u2mDetectVirtualList`）只存在于这些文件——严禁把该逻辑分叉进 `.mjs` 编排层。

**snapshot.mjs 单入口 + lib/ 模块**。步骤 1 合并为单个 CLI `script/snapshot.mjs`，内部按阶段调用四个 lib 模块：`snapshot-login.mjs`（登录检测 + Screencast viewer）、`snapshot-scroll.mjs`（渐进滚动 + DOM 稳定）、`snapshot-detect.mjs`（虚拟列表检测门）、`snapshot-capture.mjs`（全保真快照抓取）。单个 chromium 实例贯穿全流程，避免重复启动开销。各模块不直接 emit——它们抛异常或返回值，由 snapshot.mjs 统一处理 emit 逻辑。

**Playwright 1.62 evaluate 语义**（经源码验证；最初计划写反了，已在代码中修正）：
- 字符串表达式只有完整表达式形式可用：`page.evaluate(`(${src})()`)`。**解析后得到函数值**的字符串永远不会被调用。

**管线顺序（步骤 0-5）**：步骤 0 `init.sh` 环境自检 → 步骤 1 `snapshot.mjs` 合并四阶段（登录检测 `snapshot-login.mjs` → 渐进滚动 `snapshot-scroll.mjs` → 虚拟列表检测 `snapshot-detect.mjs` → 全保真快照 `snapshot-capture.mjs`：注入 page-init.js + page-prepare.js，同源 iframe 合并 + 外部 CSS 内联 + 剥 JS + `<base>` + 资源 src 绝对化 + data-u2m-id，产物 `steps/1_snapshot.html`）→ 步骤 2 `clean_snapshot.mjs` 结构清洗（删 style/link/base、清空 SVG、长文本占位，产物 `steps/2_clean_snapshot.html`）→ 步骤 3 [agent] LLM 读清洗快照识别关键 ID → 步骤 3.1 `extract_styled.mjs` 样式视图裁剪（key 元素子树 + 到 body 的祖先链一字不动，其余 body 元素删除；`<head>` 与全部 `<style>` 保留，body 分支的 `<style>` 挪入 head；产物 `steps/3.1_styled_extract.html`）→ 步骤 3.2 `compute_styles.mjs` 样式内联（juice 级联引擎把 `<style>` 规则内联进 style 属性，浏览器里经 `page-finalize-inline.js` 删噪声声明——font-family/font-style/-webkit- 前缀/值 inherit——并删净 `<style>`/class；产物 `3.2_juice_styles.html`，纯内联）→ 步骤 3.3 `extract_article.mjs` 文章视图（读 3.2 产物 + key_ids：titleIds/descriptionIds 元素本身 + listFlowIds 的子节点（元素与非空白裸文本按文档序交错迁入，纯空白/注释不迁——chunker 的 el.children 语义不含裸文本，两处有意不同），分组顺序，同一元素去重，flow 容器与祖先骨架不入；新 body 带 `max-width:768px; margin:4rem auto` 居中布局；产物 `3.3_article.html`）→ 步骤 3.4 [agent] LLM 读 `3.3_article.html` 产出 markdown 骨架 `3.4_skeleton.json`（数组按文档序、每项单键；key 为语义标签 `h1`-`h6`/`p`/`blockquote`/`ul`/`ol`/`code` 或特殊条目 `img`/`table`/`trans2img`——div 可判成 h2，不必与 DOM 标签一致；长文本只引用 `{{LONG_TEXT_k}}` 编号不带后缀且每个恰用一次（trans 标记子树内的除外，由后续轮还原），短文本/URL 照抄，行内 markdown 由 LLM 写、块级语法归回填脚本，code 条目 value 为 `{lang, content}` 对象（lang 可省略）；`trans2img`=独立复杂视觉模块（背景/边框父元素+多级装饰子元素：卡片组、对比面板、图表、图解、带包装代码块部件，仅裸代码块走 code），标记后由后续步骤截图，步骤 4/5 旧路径暂并行保留）→ 步骤 4 [agent] LLM 生成 classify_plan.json → 步骤 5 `apply_classify_plan.mjs` 执行分派 + Readability + Markdown 转换。后续步骤 6-9（图片下载、复杂元素处理、最终合成）由 `clear_trans_html.mjs` / `render_markdown.mjs` 驱动。

**分派类型与 manifest（步骤 5+）。** 分派由 `classify_plan.json`（v2：`listFlowSelector` + 逐块 `action`）驱动，取代旧 `data-u2m-type` 启发式。`manifest.json` 条目为 `{id, type, status, draft?, final?}`。`screenshot` / `passthrough_svg` / `mermaid` / 可提取 tex 的 latex / `block_screenshot` 为 `done`——转换前已在 DOM 内联替换。`svg_convert` 与无 tex 的 latex 为 `pending`——在 sketch 里留 `{{COMPLEX_DIV_n}}` 占位符（用 `<p>` 包裹，防 Readability 丢弃），交给后续步骤；draft 存 `assets/draft/`。`code_block` 不进 manifest（规范为 `<pre data-u2m-code><code class="language-*">`，语言取 data-lang/class，缺失时 `guessCodeLang` 启发式）。分派产生的 `<img>` 引用带 `data-u2m-asset`，必须持续排除在 `processImages` 之外（否则 IMG 编号错位）。

**工作目录。** 每个 URL 对应 `working/<净化URL>/`，产物分两层：步骤 1-4 中间产物在 `steps/` 子目录（`1_snapshot.html`、`2_clean_snapshot.html`、`classify_plan.json`），最终产物拍平在 `<url-dir>/` 下（sketch.md、assets/、result.md、manifest.json）；净化保留 `[A-Za-z0-9.-]`，超 120 字符截断 + sha256 前 8 位十六进制后缀。`U2M_WORKING_ROOT` 覆盖根目录（所有测试用它隔离）。`working/cookies/storage_state.json` 是唯一全局登录态——仅 `snapshot-login.mjs` 写入（cookie 按 name|domain|path 去重、localStorage 按 origin+name、读取时剔除过期）；转换脚本只读。

**浏览器上下文**：`snapshot.mjs` 启动单个 chromium 实例贯穿步骤 1 全流程。route-abort `resourceType === 'media'`；`bypassCSP: true`（否则严格 CSP 站点会在 addScriptTag 处杀死 Node 工作流）；viewport 1280×3000；`U2M_PROXY` 环境变量控制代理（未设置继承系统代理 / `direct` 绕过 / URL 显式钉住——真实冒烟曾因系统代理隧道失败报 ERR_TUNNEL_CONNECTION_FAILED 而加，实现于 `script/lib/browser.mjs` 的 `proxyLaunchOptions`）。浏览器/viewer 一律在最终 emit **之前**关闭（emit 会退出进程，顺序错了会留孤儿 chromium）。

**登录流程**：`snapshot-login.mjs` 对六个信号计分（全 frames 密码框 / URL 特征 / 标题与正文关键词——标题关键词只匹配 `<title>`、正文关键词只匹配正文 / 认证 cookie 反查 / 重定向 / SPA 等待）；≥2 命中判定需登录。人工登录走 CDP Screencast 中继（`screencast.mjs`：无头 chromium → HTTP+WS viewer，JS/CSS 全内联）。viewer 地址以 `[snapshot] viewer: http://...` 记录到 stderr，测试靠它接入。`render_markdown.mjs` 用两阶段超时（open-timeout 内无请求 → open_failed，随后进入点击窗口）——其 `/select` 端点是文档化的无人值守路径（先 GET 页面取消打开自检，再 POST）。

**虚拟列表检测门**：步骤 1 内的 `snapshot-detect.mjs`（由 `snapshot.mjs` 调用，共享浏览器上下文）复用登录态开页、注入 pageInit、调用共享 `page-detect.js` 的 `__u2mDetectVirtualList`：顶部取正文签名 → 滚到底 → 在底部（回顶之前）检查签名是否仍在 innerText，消失即虚拟列表。命中抛 `{reason: 'virtual_list'}` 异常，`snapshot.mjs` 捕获后 emit `error`（exit 1）并终止，**不写快照、不产 sketch**；否则继续执行快照阶段。

## 测试须知

- 夹具在 `test/fixtures/`；`test/helpers/fixture-server.mjs` 在随机端口提供服务。`runScript`（test/helpers/run-script.mjs）以子进程启动 CLI，支持 `onStderr(line)` 按行回调——viewer 类测试靠它触达 WS/HTTP 接口。
- `test/fixtures/login-wall.html` 的 `?auto=1` 自登录延迟刻意设为 1500ms：400ms 的重定向会落在 goto 的 networkidle 窗口内，使 login_done 路径不可达。慢 CI 上可向 ~1200ms 方向下调以加宽余量。
- `test/smoke/SMOKE.md` 是真实 URL 手动冒烟清单（场景 1 已记录通过）。

## 文档地图

- `docs/design/url-to-markdown-design.md`——权威设计文档（§3 契约、§4 storage/URL 规则、§6 各脚本设计、§8 分派表为规范依据）
- `docs/superpowers/plans/2026-08-18-url-to-markdown.md`——仓库据以构建的 15 任务 TDD 实施计划
- `docs/superpowers/plans/baseline-notes.md`——SKILL.md baseline 测试发现与差距修复
- `README.md`——需求来源（其步骤 4 清洗提示词为逐字规范）与进度表
- `.temp/`——已 gitignore 的原型（login.mjs、is_login_page.py、wait-click.mjs）；仅供参考，禁止导入
- `docs/superpowers/specs/2026-08-19-llm-driven-classification-design.md`——LLM 驱动分类与快照管线设计（含 Python 移除）
- `docs/superpowers/plans/2026-08-19-llm-driven-classification.md`——其实施计划
