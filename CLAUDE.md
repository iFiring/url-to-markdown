# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 本仓库是什么

一个 Claude Code Skill 的源码：给定 URL，把网页主体内容转换成干净的 Markdown。`SKILL.md` 是技能的操作手册（步骤 0-5）；`script/` 下的 CLI 由遵循该手册的 agent 调用。仓库天然是双语言的——Node 工作流与 Python 工作流跑同一条管线，产出两份平行初稿供人工择优。

## 常用命令

```bash
bash script/init.sh                              # 环境自检与修复（幂等；stdout 输出一行 JSON）
pnpm test                                        # Node 单测（node --test test/unit/*.test.mjs）
pnpm run test:integration                        # Node 集成（真 chromium + 本地夹具服务器）
pnpm test:all                                    # 两者都跑
uv run pytest test/unit test/integration         # Python 测试（裸 `uv run pytest` 只跑 UNIT——testpaths 所限）

# 单文件 / 单用例
node --test test/unit/contract.test.mjs
node --test test/integration/render.test.mjs
uv run pytest test/integration/test_clear_py.py::test_mermaid

uv sync                                          # Python 依赖装入 .venv（uv 管理，package=false——纯脚本项目）
npx playwright install chromium                  # 双运行时共用的浏览器缓存
```

环境要求：node ≥20（nvm）、python ≥3.11、pnpm > yarn > npm、uv。未配置 linter。测试以子进程方式启动真实 CLI、对接随机端口的夹具服务器；集成测试需要已安装 chromium。

## 输出契约即产品

每个 CLI（含 init.sh）必须向 stdout 输出**恰好一行 JSON**——失败路径也不例外——日志走 stderr，退出码 0/1/2（usage_error=2）。agent 依据 SKILL.md 的决策表对 `status` 字段分支；破坏这一点就破坏了整个技能。

**emit 延迟退出陷阱**：`script/lib/contract.mjs` 的 `emit()` 先写行、再在**写回调**里 `process.exit`——它本身会同步返回。任何在 `usage()`/`emit()` 之后继续执行的代码都可能输出第二行、或以零行崩溃。所有 CLI 都用 `return usage(...)` / parseArgs 返回 null + 提前 return 防护。改动 CLI 参数处理或新增 emit 路径时必须保持该模式。

## 架构

**共享页面脚本是分类的唯一事实源。** `script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2mXxx(...)`。双运行度都把它们当**文本**读入并注入页面（Node：`readSharedScript` + evaluate；Python：`read_shared_script` + `page.evaluate`）。分类规则、清理、iframe 合并、样式内联、LaTeX 提取只存在于这些文件——严禁把该逻辑分叉进 `.py` 或 `.mjs`。

**Playwright 1.62 evaluate 语义**（经源码验证；最初计划写反了，已在代码中修正）：
- 字符串表达式只有完整表达式形式可用：`page.evaluate(`(${src})()`)`。**解析后得到函数值**的字符串永远不会被调用。
- 需要元素实参的共享脚本走适配器：`callOnElement`（placeholder.mjs）/ `_call_on_element`（placeholder.py）——先 eval `'(' + src + ')'` 再把元素句柄作为实参调用。改任一侧都要同步镜像另一侧。
- Python 同步 Playwright 受 greenlet 线程绑定：禁止从其他 OS 线程访问 page/context（Python 图片下载串行即因此——不要重新引入 ThreadPoolExecutor）。

**双工作流镜像。** `script/lib/*.mjs` ↔ `script/pylib/*.py` 必须行为一致：`urlToDirName`/`url_to_dir_name` 对同一 URL 产出字节级一致的目录名（两语言单测用同一组向量）；manifest 结构与分派行为一致；complex-elements 夹具断言两运行时 manifest 相同。改分类 → 只改 `page-*.js`；改编排 → 双侧镜像同改。

**管线顺序（spec 规定）**：打开页面（initScripts 注入 page-init.js——IO 劫持 + mermaid 源码快照）→ 渐进滚动 → DOM 稳定等待 → 同源 iframe 合并 → mermaid 源码直出 → 特殊元素分派 → 图片下载 → 页面清理 → Readability（Node 在页面内 addScriptTag；Python 进程内 readability-lxml）→ Markdown 转换 → sketch.md + manifest.json。

**分派类型与 manifest。** `manifest.json` 条目为 `{id, type, status, draft?, final?}`。`screenshot` / `passthrough_svg` / `mermaid` / 可提取 tex 的 latex 为 `done`——转换前已在 DOM 内联替换。`svg_convert` 与无 tex 的 latex 为 `pending`——在 sketch 里留 `{{COMPLEX_DIV_n}}` 占位符（用 `<p>` 包裹，防 Readability 丢弃），交给 LLM 步骤 3；draft 存 `assets/draft/`。分派产生的 `<img>` 引用带 `data-u2m-asset`，必须持续排除在 `processImages` 之外（否则 IMG 编号错位）。

**启发式护栏（真实 URL 冒烟教训）**：svg_convert 启发式仅在元素总文本 < 500 字符时触发（page-classify.js 的 `maxHeuristicText`，可由 cfg 覆盖）——超长真实页面会把文本密度稀释到比值阈值以下，不加此上限会吞掉整个正文列。选择器命中（`.chart`/`.echarts` 等）不受该上限约束。

**工作目录。** 每个 URL 对应 `working/<净化URL>/<node_workflow|python_workflow>/`；净化保留 `[A-Za-z0-9.-]`，超 120 字符截断 + sha256 前 8 位十六进制后缀。`U2M_WORKING_ROOT` 覆盖根目录（所有测试用它隔离）。`working/cookies/storage_state.json` 是唯一全局登录态——仅 `login_url.mjs` 写入（cookie 按 name|domain|path 去重、localStorage 按 origin+name、读取时剔除过期）；转换脚本只读。

**浏览器上下文（双语言）**：route-abort `resourceType === 'media'`；`bypassCSP: true`（否则严格 CSP 站点会在 addScriptTag 处杀死 Node 工作流）；转换运行 viewport 1280×3000。浏览器/viewer 一律在最终 emit **之前**关闭（emit 会退出进程，顺序错了会留孤儿 chromium）。

**登录流程**：`detector.mjs` 对六个信号计分（全 frames 密码框 / URL 特征 / 标题与正文关键词——标题关键词只匹配 `<title>`、正文关键词只匹配正文 / 认证 cookie 反查 / 重定向 / SPA 等待）；≥2 命中判定需登录。人工登录走 CDP Screencast 中继（`screencast.mjs`：无头 chromium → HTTP+WS viewer，JS/CSS 全内联）。viewer 地址以 `[login_url] viewer: http://...` 记录到 stderr，测试靠它接入。`render_markdown.mjs` 用两阶段超时（open-timeout 内无请求 → open_failed，随后进入点击窗口）——其 `/select` 端点是文档化的无人值守路径（先 GET 页面取消打开自检，再 POST）。

## 测试须知

- 夹具在 `test/fixtures/`；`test/helpers/fixture-server.mjs` 与 conftest 的 `fixture_server` 在随机端口提供服��。`runScript`（test/helpers/run-script.mjs）以子进程启动 CLI，支持 `onStderr(line)` 按行回调——viewer 类测试靠它触达 WS/HTTP 接口。
- `test/fixtures/login-wall.html` 的 `?auto=1` 自登录延迟刻意设为 1500ms：400ms 的重定向会落在 goto 的 networkidle 窗口内，使 login_done 路径不可达。慢 CI 上可向 ~1200ms 方向下调以加宽余量。
- Python 子进程测试必须继承 `os.environ`（playwright 需要 HOME 定位浏览器缓存），只覆盖 `U2M_WORKING_ROOT`。
- Python 侧已被设计吸收的怪癖：readability-lxml 拍平标题层级、短页面保留更多导航噪声（双稿择优是吸收器）；`min_text_length=10` 保住 @mozilla/readability 会保留的短表格/代码块；markdownify 围栏语言来自 `code_language_callback`。
- `test/smoke/SMOKE.md` 是真实 URL 手动冒烟清单（场景 1 已记录通过）。

## 文档地图

- `docs/design/url-to-markdown-design.md`——权威设计文档（§3 契约、§4 storage/URL 规则、§6 各脚本设计、§8 分派表为规范依据）
- `docs/superpowers/plans/2026-08-18-url-to-markdown.md`——仓库据以构建的 15 任务 TDD 实施计划
- `docs/superpowers/plans/baseline-notes.md`——SKILL.md baseline 测试发现与差距修复
- `README.md`——需求来源（其步骤 4 清洗提示词为逐字规范）与进度表
- `.temp/`——已 gitignore 的原型（login.mjs、is_login_page.py、wait-click.mjs）；仅供参考，禁止导入
