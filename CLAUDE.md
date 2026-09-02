# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 本仓库是什么

一个 Claude Code Skill 的源码：给定 URL，把网页主体内容转换成干净的 Markdown。`SKILL.md` 是技能的操作手册（步骤 0-5）；`script/` 下的 CLI 由遵循该手册的 agent 调用。

## 常用命令

```bash
bash script/init.sh --url <url>                  # 环境自检与修复 + 核心参数输出（幂等；stdout 输出一行 JSON）
pnpm test                                        # Node 单测（node --test test/unit/*.test.mjs）
pnpm run test:integration                        # Node 集成（真 chromium + 本地夹具服务器）
pnpm test:all                                    # Node 单测 + 集成

# 单文件 / 单用例
node --test test/unit/contract.test.mjs
node --test test/integration/render.test.mjs
npx playwright install chromium                  # 浏览器缓存

# 本地调试日志：U2M_DEBUG=1 时各 CLI 向 stderr 输出 [dbg +N.NNs] 前缀的
# 调试行（阶段耗时、输入输出字节数、登录检测六信号命中、滚动轮次、逐图下载、
# [net] 打开页面（主 frame document 导航，含重定向/登录跳转每一跳）的请求头与
# 响应头（裸行无前缀；子资源不记），反爬诊断用，见 lib/browser.mjs），
# 不设则静默——stdout 单行 JSON 契约不受影响
U2M_DEBUG=1 node script/snapshot.mjs --url <url>
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

**管线顺序（步骤 0-9）**：步骤 0 `init.sh --url` 环境自检 + 核心参数输出（`skill-root`/`url-name`/`url-working-path`，url-name 经脚本内 `lib/env.mjs urlToDirName` 派生，与步骤 1 的工作目录派生同一事实源；仅 Linux 自检修复 fontconfig/字体——缺失会让 chromium 渲染即 FATAL 崩溃，核心包（fontconfig+西文字体）装不上报 error；CJK 字体独立检查（`fc-list :lang=zh`，无 fc-list 按文件名粗判）——西文健康但缺中文也补装，装不上仅警告不阻断——中文 trans2img 截图会豆腐块；探测路径可被 `U2M_FONTCONFIG_CONF`/`U2M_FONT_DIR` 覆盖，测试模拟用）→ 步骤 1 `snapshot.mjs` 合并四阶段（登录检测 `snapshot-login.mjs` → 渐进滚动 `snapshot-scroll.mjs` → 虚拟列表检测 `snapshot-detect.mjs` → 全保真快照 `snapshot-capture.mjs`：注入 page-init.js + page-prepare.js，同源 iframe 合并 + 外部 CSS 内联 + 剥 JS + `<base>` + 资源 src 绝对化 + data-idx，产物 `1_snapshot.html`）→ 步骤 2 `clean_snapshot.mjs` 结构清洗（单页两趟、零样式计算：共享段 = 结构删除 + astro 解包（`astro-` 前缀框架脚手架标签子元素上提、包装弃置——两趟一致，步骤 3 引用集来自清洗版从不引用包装 id，两版 id 集对齐）+ **长文本占位（两趟共享段同位执行、编号逐一对应**——超阈值 16 汉字/12 词的**单个文本节点**折叠为 `{{LONG_TEXT_k|n_chars}}`/`{{LONG_TEXT_k|n_words}}`，行内结构 a/code/strong 混排保真，K8 行内 run 整段折叠已废除；**H1/H2/H3 整子树豁免——标题是层级锚点，占位会让步骤 3 看不到真实标题文本，与 `<title>` 不占位同款 rationale（H4/H5/H6 仍按阈值占位，字面取 H1/H2/H3）**；原文进 `2_long_text.json`）+ **aria-label 值首末句截断（两趟共享同位执行——按完整句末标点 `。！？；`/`.!?;` 切句、不含逗号/顿号，≥3 句保留首句+`…`+末句、≤2 句原样；元数据不进恢复清单）**+ 折叠统计预计算（hidden 规模与 pre 行数在占位**前**量原文挂 expando——量占位符语法串会虚高、换行被吞会塌缩为 1 行）；趟 1 styled = SVG 瘦身 + 属性白名单（22 静态属性 = clean K2 九属性 + style/href/src/width/height + 内容信号 colspan/rowspan/start/data-src/srcset/datetime/open/lang，外加 `<style>` 选择器引用的动态属性集——删属性即断 juice 级联，`<style>` 标签豁免；target/rel/tabindex/loading/未被引用的 data-* 等脚手架属性不流进步骤 4-7）+ meta charset 注入；趟 2 clean = K1-K7/K9/K10 机械规则——class 语义过滤、属性白名单（class/id/data-idx/data-language/hidden/type/role/alt/aria-label，href/src/aria（aria-label 除外）全删）、SVG 清空、hidden 裸属性折叠 `{{HIDDEN_TAG|n_chars;构成}}`（规模按占位前原文预计算）、table/pre 折叠 `{{TABLE_TAG|n_rows|m_cols}}`/`{{PRE_CODE_TAG|n_lines}}`（行列/行数规模信号——表格形状在 K2 剥 colspan 前预计算挂 expando；pre 行数取换行切分与 div 行块数的较大者、占位前预计算）、空白压缩、K10 空壳 span 拆包（clean 趟末段——仅 data-idx 一个属性的 span 迭代解包，子节点并入父、内容不丢只粒度变粗，省 step 3 输入字节；仅 clean 趟——styled 趟保留这些 span 的 style 供步骤 5-7 判粗体/颜色，孪生 id 集由此放宽为 clean⊆styled）；**清洗版携带与带样式版编号一致的 LONG_TEXT 占位**——唯一消费者是步骤 3，还原链不变、一切还原仍走带样式版（步骤 7 引用来自 styled 路径的文章视图、步骤 8 从恢复清单回填），见 docs/superpowers/specs/2026-08-27-clean-snapshot-simplify-design.md 及其 2026-08-31 修订记录；产物 `2_clean_snapshot.html`/`2_clean_style_snapshot.html`/`2_long_text.json`）→ 步骤 3 [agent] LLM 读清洗快照识别关键 ID → 步骤 4 `extract_styled.mjs` 样式视图裁剪（四键契约：titleId/descriptionIds/paragraphIds 标量块——paragraphIds 嵌套（数组=子段落流）经共享 `lib/key-ids.mjs` 校验并展开为扁平块清单传页面函数（步骤 4/6/8 同一校验事实源）——的子树 + 到 body 的祖先链一字不动，其余 body 元素删除；dumpIds 流内噪音折叠为空元素——清空全部子节点、属性仅留 id/class/data-idx，壳占住流内兄弟位置（步骤 5 juice 求值 nth-child/相邻选择器不失真；步骤 6 适配后迁移块、壳不在清单自然不入文章），落在保留区外的 dump 随分支删除不计错；CLI 前置校验——四键互不相交（含段落块重复列举）、dump 是 key 祖先（折叠会摧毁 key 子树）均报 error，emit 增 dumpCollapsedCount；`<head>` 与全部 `<style>` 保留，删除或折叠分支的 `<style>` 挪入 head；产物 `4_styled_extract.html`）→ 步骤 5 `compute_styles.mjs` 样式内联（**前置隐藏声明剥离**——浏览器侧 `page-strip-hidden.js`：收起元素展开为可见，CSSOM 删全部样式表规则与内联 style 的 display:none/visibility:hidden 声明、只删隐藏声明本身（`.row{display:flex}`+`.collapse{display:none}` 剥除后自然恢复 flex，不盲改 block），规则集 cssText 写回 `<style>` 文本（CSSOM 改写不回写文本节点，不物化即被还原）；`[hidden]` 属性摘除；var 驱动兜底内联覆写 display:block——产物零隐藏声明；内联前浏览器侧 `page-unwrap-layers.js` 解包 `@layer` 级联层——Tailwind v4 把工具类规则全包在 `@layer utilities` 内而 juice 不进层，不解包则层内规则零内联、只靠工具类表达样式的元素一丝样式不剩；块形层体原位递归提升、声明形层序丢弃；`:root` 变量定义随层提升后 juice 将已定义 var() 解析为具体值；juice 级联引擎把 `<style>` 规则内联进 style 属性；随后**函数值真实化**——`page-collect-fn-values.js` 在 juice 产物上收集值仍含 var()/color-mix()/calc() 或空串（简写属性带 var 的 CSSOM 形态）的声明对，`page-resolve-computed.js` 在原始样式页（完整 CSS+class+@property）取 getComputedStyle 计算值，finalize 替换或删净——juice 多级 var 递归会弄丢 color-mix 颜色空间参数产出非法值、@property 变量与 calc 保持函数引用，终态零函数间接引用；浏览器里经 `page-finalize-inline.js` 按白名单只留明显结构化样式——border/outline/background/box-shadow、flex/grid 布局（display/gap/对齐）、overflow、transform，外加 font-size/font-weight（判标题层级信号）、position:absolute（判特殊定位元素信号——浮层/装饰/trans2img 候选；唯一按值门控项，仅 absolute 存活，relative/fixed/sticky/static 一律删）——其余声明（含盒模型几何 margin/padding/宽高、定位其余（relative/fixed/sticky/static、inset、z-index）、color 等）全删；白名单内再过一场零值过滤——值等于全元素初始值的声明删除（边框按"边"语义：style none/缺省或 width 0 → 该边三件全删；box-shadow:none、background:transparent、radius:0px、overflow:visible 等精确值；font-size/weight 相对对比与 flex 布局信号不是零值、保留）——唯一元素级例外：`<img>` 的 width/height 保留（步骤 7 LLM 判图片权重——小图标/大图/图片组的信号），并删净 `<style>`/class；产物 `5_juice_styles.html`，纯内联）→ 步骤 6 `extract_article.mjs` 文章视图（读步骤 5 产物 + 四键 key_ids——校验与 paragraphIds 嵌套展开共享 `lib/key-ids.mjs`：titleId/descriptionIds/paragraphIds 块**全部按元素本身**迁移（完整子树一字不动；块模型下无流容器子节点收集，裸文本无 data-idx 不可标记、不迁——带裸文本的容器由步骤 3 整体标块兜底）；title/desc 落在段落块子树内合法（四键只约束 ID 不相交）——收选节点先同一元素去重、再做最外层优先嵌套去重（被包含者跳过、内容随外层整块带入），最终统一按文档序 compareDocumentPosition 排序迁入（paragraphIds 列出顺序不影响输出）；流容器/非流包装层/祖先骨架/dump 空壳不在任何键、自然不入（步骤 6 不消费 dumpIds、无迁移后剔除 pass，emit 无 removedNoiseCount）；随后同页 setContent 内存往返跑瘦身 pass——共享 page-slim-article.js 六条结构规则（① data-* 只留 data-idx/data-language ② MathML→LaTeX——page-latex.js 的 __u2mLatexText 同作用域注入，KaTeX 双胞胎结构整体替换、无 annotation 保留原树 ③ 无文本/纯符号 button 与无文本 svg 整删 ④ 有文本 button 解包降级 ⑤ scheme ∉ http/https/mailto/tel 的 `<a>` 解包 ⑥ 属性只剩 data-idx 的 span 迭代拆包到不动点；保护集 = 迁入 key 元素全集 titleId∪descriptionIds∪blockIds——body 顶层全是显式标记的内容单元，删除/解包类启发式只清理块内未标记残留、替换类不设防；emit 增 slim 计数对象）；新 body 带 `max-width:768px; margin:4rem auto` 居中布局；产物 `6_article.html`）→ 步骤 7 [agent] LLM 读 `6_article.html` 产出 markdown 骨架 `7_skeleton.json`（数组按文档序、每项单键；key 为语义标签 `h1`-`h6`/`p`/`blockquote`/`ul`/`ol`/`code` 或特殊条目 `img`/`table`/`trans2img`——div 可判成 h2，不必与 DOM 标签一致；value 直接携带行外 markdown 语法——`h1-h6` 带 `#`、`blockquote` 逐行带 `>`、`ul`/`ol` 行级 `- `/`1. ` 写在 value（嵌套用缩进）、`img` 为完整 `![img](url)`、`table` 为完整管线表，行内格式（`**粗体**`/链接/行内 code）同样由 LLM 写；长文本只引用 `{{LONG_TEXT_k}}` 编号不带后缀且每个恰用一次（trans 标记子树内的除外，由后续轮还原），短文本/URL 照抄；code 条目 value 为 `{lang, content}` 对象（lang 必填，无线索时写 `""`）；`trans2img` value 为**单传祖先链 ID 数组**（分叉点到模块容器的全部 `data-idx`——顶层模块即 body 子元素到容器，嵌套模块的分叉点是外层内容单元、链只在其内部取）=独立复杂视觉模块（多层级块样式视觉模块：卡片组、对比面板、图表、图解、div 网格数据；单层包装的「代码块+标题/说明」与裸代码块走 code），标记后由步骤 8 截图；分派文本形态优先——仅真实 `<table>`（thead/tbody/th/td）走 table（行列对齐的 div 网格数据走 trans2img）、callout/提示框走 blockquote、单层包装的「代码块+标题/说明」走 code+p、文本可表达的卡片组走列表/小表，装饰不是截图理由，仅 markdown 无法表达的视觉模块（图表/图解/空间表意拼贴/多层级块样式模块、复杂跨行跨列表格）才走 trans2img）→ 步骤 8 `screenshot_trans.mjs` 占位符还原 + 图片下载 + trans2img 截图（先纯 Node 把步骤 7 骨架里所有 `{{LONG_TEXT_k[|suffix]}}` 替换为 `2_long_text.json` 原文，写出同结构的 `8_resolved_skeleton.json`——trans2img 数组透传；再用 `context.request`（共享代理与登录态）按文档序解包 `![img](url)` 括号内 URL 去重下载 http(s) 图片到 `assets/images/`——命名规则在 `lib/download_images.mjs` 头注：优先 URL 文件名、冲突带编号、扩展名按 content-type、失败保留原 URL 且记入 `failedImages`，成功者只换括号内 URL 把 img 值改写为 `![img](assets/images/x)`（保留 alt）后重写文件；最后扫骨架校验 trans2img 条目为非空正整数 ID 数组，走 **live 重渲染 + 严校验 + 快照兜底 + 逐条目择优**——页 A 加载 `file://1_snapshot.html`（真实文本 + 全量内联样式，签名基准兼兜底截图源），直接用 `--url` 参数开页 B 重渲染（`gotoSettled` + 复用 `snapshot-scroll.mjs` 渐进滚动 + 重注入 `page-prepare.js` 重标记——id 按文档序编号是 prepare 后 DOM 的纯函数，两次渲染结构一致则精确对位），两侧用共享 `page-element-signature.js` 对每个 id 算 `{tag,text,childCount}` 签名，全等才在 B 上 `el.screenshot({type:'webp'})`、失配/B 侧缺失/live 整体失败在 A 兜底（折叠模块如手风琴收起——步骤 2 只折叠清洗版、带样式版保真流到步骤 7——两侧同隐藏：截图前双层排除 + 逐 id 四段手术——分类层 `page-exclude-noncontent.js` 每页一次（keep = titleId∪descriptionIds∪paragraphIds 块（`lib/key-ids.mjs` 校验展开）∪trans2img id，隐藏集 = id 全集 − keep − keep 祖先 − keep 子孙，并入 dumpIds，保优先，`visibility:hidden` 零重排），几何层 `page-reveal-hidden.js` 逐 id 四段：纵向强制展开（display:none→block、visibility、opacity、`[hidden]`、max-height/height 塌缩）、横向裁剪 reveal（祖先链 overflow-x 裁剪且 clientWidth<scrollWidth → overflow:visible，走到 html 含 body/html）、留白扩盒（四边 20px 呼吸位——每侧 padding +20/负 margin −20 抵消，内容像素级零移动零重排；显式宽高/max-* 钉盒致内容缩水时自愈补 width/height = 原盒+40px；data-u2m-pad 防重入；在遮挡扫描前执行保证环区干净）、非亲族遮挡者隐藏（fixed/sticky 一律、其余盒相交即 `visibility:hidden`，可见后代一并覆写，亲族保留）；盒无效或截图失败换另一页再试、有界 10s 超时不整页挂死、仍失败汇总 error 列出 id），emit 以 `source: live|snapshot|mixed` 如实标注；链上每个 id 各写一张 `assets/trans/{id}.webp`（2x 分辨率，全部保留），随后逐条目按 boundingBox 择优——宽度优先 → 等宽选高 → 全同选最外层（数组首位），把条目 value 回写为选中路径后重写 resolved skeleton）→ 步骤 9 `render_skeleton.mjs` 骨架回填为 markdown（纯 Node 读 `8_resolved_skeleton.json`——value 已带行外语法：`h1-h6`/`blockquote` 以 key 为准规范化重建（剥 value 自带 `#`/`>` 前缀后按 key 级别重建，LLM 漏写/写错级别也能纠正），`p`/`ul`/`ol`/`table`/`img` 透传，`code` 加 `{lang}` 围栏，`trans2img`（此时已是步骤 8 回写的选中路径）→ `![](assets/trans/{id}.webp)`、仍为数组则 error 提示先跑步骤 8；块间空行，产物 `9_markdown.md`）。

**工作目录。** 所有 CLI 只收 `--url`，经 `lib/env.mjs urlDir(url)` 自行派生工作目录（步骤 0 的 init.sh 用同一 `urlToDirName` 输出 `url-name`/`url-working-path`）。每个 URL 对应 `working/<净化URL>/`，所有步骤产物直接在 `<url-dir>/` 根目录（`1_snapshot.html`、`2_clean_snapshot.html`、`2_clean_style_snapshot.html`、`2_long_text.json`、`3_key_ids.json`、`4_styled_extract.html`、`5_juice_styles.html`、`6_article.html`、`7_skeleton.json`、`8_resolved_skeleton.json`、`9_markdown.md`）；截图在 `<url-dir>/assets/trans/{id}.webp`，下载图片在 `<url-dir>/assets/images/<name>`；净化先剥 `http(s)://` 前缀（目录名从域名开始），其余非 `[A-Za-z0-9.-]` 替换为 `_`，超 120 字符截断 + sha256 前 8 位十六进制后缀；同域名 http/https 派生同一目录。`U2M_WORKING_ROOT` 覆盖根目录（所有测试用它隔离）。`working/cookies/storage_state.json` 是唯一全局登录态——仅 `snapshot-login.mjs` 写入（cookie 按 name|domain|path 去重、localStorage 按 origin+name、读取时剔除过期）；转换脚本只读。

**浏览器上下文**：`snapshot.mjs` 启动单个 chromium 实例贯穿步骤 1 全流程。route-abort `resourceType === 'media'`；`bypassCSP: true`（否则严格 CSP 站点会在 addScriptTag 处杀死 Node 工作流）；viewport 1280×3000；`U2M_PROXY` 环境变量控制代理（未设置继承系统代理 / `direct` 绕过 / URL 显式钉住——真实冒烟曾因系统代理隧道失败报 ERR_TUNNEL_CONNECTION_FAILED 而加，实现于 `script/lib/browser.mjs` 的 `proxyLaunchOptions`）。步骤 8 自起同参数浏览器（外加 `deviceScaleFactor: 2` 原生 2x 截图）：页 A `file://` 渲染快照、页 B 重渲染原 URL（storageState 复用登录态），进程内用完即关。浏览器/viewer 一律在最终 emit **之前**关闭（emit 会退出进程，顺序错了会留孤儿 chromium）。

**登录流程**：`snapshot-login.mjs` 对六个信号计分（全 frames 密码框 / URL 特征 / 标题与正文关键词——标题关键词只匹配 `<title>`、正文关键词只匹配正文 / 认证 cookie 反查 / 重定向 / SPA 等待）；≥2 命中判定需登录。人工登录走 CDP Screencast 中继（`screencast.mjs`：无头 chromium → HTTP+WS viewer，JS/CSS 全内联）。viewer 地址以 `[snapshot] viewer: http://...` 记录到 stderr，测试靠它接入。

**虚拟列表检测门**：步骤 1 内的 `snapshot-detect.mjs`（由 `snapshot.mjs` 调用，共享浏览器上下文）复用登录态开页、注入 pageInit、调用共享 `page-detect.js` 的 `__u2mDetectVirtualList`：顶部取正文签名 → 滚到底 → 在底部（回顶之前）检查签名是否仍在 innerText，消失即虚拟列表。命中抛 `{reason: 'virtual_list'}` 异常，`snapshot.mjs` 捕获后 emit `error`（exit 1）并终止，**不写快照、不产 sketch**；否则继续执行快照阶段。

## 测试须知

- 夹具在 `test/fixtures/`；`test/helpers/fixture-server.mjs` 在随机端口提供服务。`runScript`（test/helpers/run-script.mjs）以子进程启动 CLI，支持 `onStderr(line)` 按行回调——viewer 类测试靠它触达 WS/HTTP 接口。
- `test/fixtures/login-wall.html` 的 `?auto=1` 自登录延迟刻意设为 1500ms：400ms 的重定向会落在 goto 的 networkidle 窗口内，使 login_done 路径不可达。慢 CI 上可向 ~1200ms 方向下调以加宽余量。
- `test/smoke/SMOKE.md` 是真实 URL 手动冒烟清单（场景 1 已记录通过）。

## 文档地图

- `docs/design/url-to-markdown-design.md`——权威设计文档（§3 契约、§4 storage/URL 规则、§6 各脚本设计、§8 分派表为规范依据）
- `docs/superpowers/plans/2026-08-18-url-to-markdown.md`——仓库据以构建的 15 任务 TDD 实施计划
- `docs/superpowers/plans/baseline-notes.md`——SKILL.md baseline 测试发现与差距修复
- `README.md`——项目概览（结构、流程摘要、关键机制、环境变量、进度表）
- `.temp/`——已 gitignore 的原型（login.mjs、is_login_page.py、wait-click.mjs）；仅供参考，禁止导入
- `docs/superpowers/specs/2026-08-19-llm-driven-classification-design.md`——LLM 驱动分类与快照管线设计（含 Python 移除）
- `docs/superpowers/plans/2026-08-19-llm-driven-classification.md`——其实施计划
