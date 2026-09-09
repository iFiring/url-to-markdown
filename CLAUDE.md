# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 本仓库是什么

一个 Claude Code Skill 的源码：给定 URL，把网页主体内容转换成干净的 Markdown。`SKILL.md` 是技能的操作手册（步骤 0-5）；`script/` 下的 CLI 由遵循该手册的 agent 调用。

## 常用命令

```bash
bash script/init.sh                              # 纯环境自检与修复（幂等；无参数；stdout 输出一行 JSON）
pnpm test                                        # Node 单测（node --test test/unit/*.test.mjs）
pnpm run test:integration                        # Node 集成（真 chromium + 本地夹具服务器）
pnpm test:all                                    # Node 单测 + 集成

# 单文件 / 单用例
node --test test/unit/contract.test.mjs
node --test test/integration/render.test.mjs
npx playwright install chromium                  # 浏览器缓存

# 本地调试日志：U2M_DEBUG=1 时各 CLI 向 stderr 输出 [dbg +N.NNs] 前缀的
# 调试行（阶段耗时、输入输出字节数、登录检测六信号命中（含点击探测形态）、滚动轮次、逐图下载、
# [net] 打开页面（主 frame document 导航，含重定向/登录跳转每一跳）的请求头与
# 响应头（裸行无前缀；子资源不记），反爬诊断用，见 lib/browser.mjs），
# 不设则静默——stdout 单行 JSON 契约不受影响
U2M_DEBUG=1 node script/snapshot.mjs --url <url>

# 大产物分块阈值（字节）：U2M_ARTICLE_SPLIT_THRESHOLD（默认 61440）触发分割、
# U2M_ARTICLE_CHUNK_MAX（默认 40960）每块上限——测试调低触发用
```

环境要求：node ≥20（nvm）、pnpm > yarn > npm。未配置 linter。测试以子进程方式启动真实 CLI、对接随机端口的夹具服务器；集成测试需要已安装 chromium。

## 输出契约即产品

每个 CLI（含 init.sh）必须向 stdout 输出**恰好一行 JSON**——失败路径也不例外——日志走 stderr，退出码 0/1/2（usage_error=2）。agent 依据 SKILL.md 的决策表对 `status` 字段分支；破坏这一点就破坏了整个技能。

**emit 延迟退出陷阱**：`script/lib/contract.mjs` 的 `emit()` 先写行、再在**写回调**里 `process.exit`——它本身会同步返回。任何在 `usage()`/`emit()` 之后继续执行的代码都可能输出第二行、或以零行崩溃。所有 CLI 都用 `return usage(...)` / parseArgs 返回 null + 提前 return 防护。改动 CLI 参数处理或新增 emit 路径时必须保持该模式。

## 架构

**共享页面脚本是分类的唯一事实源。** `script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2mXxx(...)`。Node 工作流把它当**文本**读入并注入页面（`readSharedScript` + evaluate）。分类规则、清理、iframe 合并、样式内联、LaTeX 提取、虚拟列表检测（`page-detect.js` / `__u2mDetectVirtualList`）只存在于这些文件——严禁把该逻辑分叉进 `.mjs` 编排层。

**snapshot.mjs 单入口 + lib/ 模块**。步骤 1 合并为单个 CLI `script/snapshot.mjs`，内部按阶段调用五个阶段模块：`snapshot-login.mjs`（登录检测 + Screencast viewer）、`snapshot-scroll.mjs`（渐进滚动 + DOM 稳定）、`snapshot-redirect.mjs`（占优内容 iframe 重定向门）、`snapshot-detect.mjs`（虚拟列表检测门）、`snapshot-capture.mjs`（全保真快照抓取）。单个 chromium 实例贯穿全流程，避免重复启动开销。各模块不直接 emit——它们抛异常或返回值，由 snapshot.mjs 统一处理 emit 逻辑。

**Playwright 1.62 evaluate 语义**（经源码验证；最初计划写反了，已在代码中修正）：
- 字符串表达式只有完整表达式形式可用：`page.evaluate(`(${src})()`)`。**解析后得到函数值**的字符串永远不会被调用。

**管线顺序（步骤 0-9）**：步骤 0 环境自检 → 步骤 1 快照下载（五阶段，含重定向门）→ 步骤 2 结构清洗 → 步骤 3 [agent] 识别关键 ID → 步骤 4 样式视图裁剪 → 步骤 5 样式内联 → 步骤 6 文章视图 → 步骤 7 [agent] markdown 骨架 → 步骤 8 占位符还原 + 图片下载 + trans2img 截图 → 步骤 9 骨架回填。逐步详述：

- **步骤 0 `init.sh` —— 纯环境自检（node/pnpm/chromium/字体）**
  - 不再输出核心参数——`skill-root`/`url-name`/`url-working-path` 移交步骤 1 emit（修复逻辑不变）
  - 仅 Linux 自检修复 fontconfig/字体——缺失会让 chromium 渲染即 FATAL 崩溃，核心包（fontconfig+西文字体）装不上报 error
  - CJK 字体独立检查（`fc-list :lang=zh`，无 fc-list 按文件名粗判）——西文健康但缺中文也补装，装不上仅警告不阻断——中文 trans2img 截图会豆腐块
  - 探测路径可被 `U2M_FONTCONFIG_CONF`/`U2M_FONT_DIR` 覆盖，测试模拟用

- **步骤 1 `snapshot.mjs --url` —— 合并五阶段 + 核心参数产出**
  - 登录检测 `snapshot-login.mjs` → 渐进滚动 `snapshot-scroll.mjs` → **重定向门** `snapshot-redirect.mjs` → 虚拟列表检测 `snapshot-detect.mjs`（跑在最终目标页上）→ 全保真快照 `snapshot-capture.mjs`
  - 重定向门（占优内容 iframe 检测）：共享 `page-detect-iframe.js` 判定规则（可导航 http(s)/可见 ≥200px/正文 ≥500 且 ≥3× 主文档，多帧取最长，**单次判定**——只判入口原页面、目标页不重判）；命中则 `snapshotLogin` 跳转目标页（登录检测复跑，跨域登录墙 viewer 开在内容页）+ 退化守卫（目标页正文 <50% 回退原页）+ 重新滚动；快照成功后写 `redirected_<原名>/redirect_to.yaml` marker，未命中清 stale
  - 全保真快照：注入 page-init.js + page-prepare.js，同源 iframe 合并 + 外部 CSS 内联 + 剥 JS + `<base>` + 资源 src 绝对化 + data-idx
  - 输出核心参数 `skill-root`/`url-name`/`url-working-path`（url-name 经 `lib/env.mjs urlToDirName` 派生，与步骤 2-9 工作目录派生同一事实源；重定向页为 `redirected_` 前缀名）+ `redirect` 通报
  - 产物 `1_snapshot.html`

- **步骤 2 `clean_snapshot.mjs` —— 结构清洗（单页两趟，样式计算仅限共享段标志预计算）**
  - **共享段（两趟一致执行）** = 结构删除 + **D1 脊柱占优比较删除（步骤 7.5，spec 2026-09-09）** + astro 解包 + **注释剥离（pre/code 子树除外）** + 长文本占位 + aria-label 截断 + 折叠统计预计算 + **chrome 折叠集预计算**：
    - **D1**——沿 body 脊柱逐层比较兄弟文本量：非占优（rank1 含并列恒豁免）子元素 ratio ≤5% ∧（fixed/absolute/sticky ∨ 弹窗词汇 modal|dialog|popup|popover|drawer|lightbox|toast|snackbar，**不含 overlay**）∧ 内容守卫（p≤2 ∧ 无 main/article ∧ 无 pre/table）→ **两版整树删除**；下探遇占优子元素 p≥5 或 main/article 即停（内容内部永不扫描）、深度上限 20；文本计量与候选排除 script/style/template/noscript
    - **chrome 折叠集**——候选区 = body 直接子孙 ∪ 独子链（分叉出链）；三种：dialog（role=dialog/aria-modal，**任意深度**）> hidden（computed display:none/visibility:hidden 含祖先累积）> overlay（可见 ∧ fixed/absolute/sticky）；统一内容守卫；裸 [hidden] 及后代归 K5 独占；节点挂 `__u2mChromeFold`、后代挂 `__u2mInChromeFold`——**styled 收集与 clean K6/K7 同源 skip（k 对齐）**；折叠壳上的 LT run expando 随折删除（防 foldLongText 覆写 chrome token）
    - astro 解包——`astro-` 前缀框架脚手架标签子元素上提、包装弃置——两趟一致，步骤 3 引用集来自清洗版从不引用包装 id，两版 id 集对齐
    - **长文本占位（两趟各自执行：styled 分支开头带编号、clean 在 K11 之后无编号 `{{LONG_TEXT|n_unit}}`）**——超阈值 16 汉字/12 词的内容按两级折叠（spec 2026-09-06：`docs/superpowers/specs/2026-09-06-long-text-inline-run-design.md`）：
      - **极大纯行内 run**（流容器内 text 与行内元素混排的整段内容；检测/规范化序列化在两趟共享段末尾执行、结果挂元素 expando，孪生守卫由构造保证）折为单个 `{{LONG_TEXT_k|n_unit}}`、原文以剥净属性的 canonical HTML 片段入 `2_long_text.json` 的 `runs` 段（span 按 computed style 归一 strong/em/del、math 压成仅含 annotation 的极简形态、href 绝对化、`#`/`javascript:`/空 href 解包）
      - **散文本节点**（非纯容器/表格/pre 内部）照旧逐节点折叠入 `texts` 段；k 全文档序连续单计数器
      - 豁免：table/pre/svg/style 子树与 h1-h3 整子树豁免 run 折叠；**H1/H2/H3 整子树豁免——标题是层级锚点，占位会让步骤 3 看不到真实标题文本，与 `<title>` 不占位同款 rationale（H4/H5/H6 仍按阈值占位，字面取 H1/H2/H3）**
      - 阻断：含 `[hidden]`/display:none 元素（三层语义：run 根自查、后代逐查含 math 根自身、祖先不查——FAQ hidden 块内 run 照折）或无源 math 的 run 阻断不折
      - **KaTeX 视觉孪生原子化（spec §10）**——`span.katex` 视为原子 math 节点、只在内部判源，katex-html 孪生（clip 隐藏 mathml/svg 伸展符号）免检且不入库（否则步骤 8 源与孪生双份输出）；void 元素（br/wbr）canonical 序列化不带闭合标签（`</br>` 被 jsdom 解析为第二个 br、换行翻倍）
      - 步骤 8 `inline2md` 确定性转 markdown（含 `$$…$$`）；原文进 `2_long_text.json`（两段 schema：`texts` 散文本纯文本 + `runs` 行内 run 规范化 HTML，单一计数器全局编号；table2md/code2md 的 expandLongText 只消费 `texts` 段——表格/pre 子树被 run 检测的位置条件排除、其内部永远只有散文本占位符，扁平展开表零改动）
    - **aria-label 值首末句截断（两趟共享同位执行）**——按完整句末标点 `。！？；`/`.!?;` 切句、不含逗号/顿号，≥3 句保留首句+`…`+末句、≤2 句原样；元数据不进恢复清单
    - 折叠统计预计算——hidden 规模与 pre 行数在占位**前**量原文挂 expando（量占位符语法串会虚高、换行被吞会塌缩为 1 行）
  - **趟 1 styled** = SVG 瘦身 + 属性白名单 + meta charset 注入：
    - 22 静态属性 = clean K2 九属性 + style/href/src/width/height + 内容信号 colspan/rowspan/start/data-src/srcset/datetime/open/lang，外加 `<style>` 选择器引用的动态属性集——删属性即断 juice 级联，`<style>` 标签豁免；target/rel/tabindex/loading/未被引用的 data-* 等脚手架属性不流进步骤 4-7
  - **趟 2 clean** = K1-K7/K9/K10 机械规则：
    - class 语义过滤
    - 属性白名单（class/id/data-idx/data-language/hidden/type/role/alt/aria-label，href/src/aria（aria-label 除外）全删）
    - SVG 清空
    - hidden 裸属性折叠 `{{HIDDEN_TAG|n_chars;构成}}`（规模按占位前原文预计算）
    - K5x chrome 折叠集消费（仅 clean 趟）——hidden→`{{HIDDEN_TAG}}`（语义同裸 [hidden]，壳可标 paragraphIds）、dialog→`{{DIALOG_TAG}}`、overlay→`{{OVERLAY_TAG}}`（后两者 chrome、步骤 3 不选）；壳机制逐字复用 K5；**带样式版折叠集保活**（还原链零改动）；链外深处 CSS 隐藏（FAQ/非激活 tab）不折——全 DOM hidden 检测被 OpenAI 非激活 tab 正文实证否决；emit 增 `chrome:{removed,cssHiddenFolded,dialogFolded,overlayFolded,commentsRemoved}` 恒定形状
    - table/pre 折叠 `{{TABLE_k|rows×cols}}`/`{{CODE_k|n_lines}}`（k = 文档序编号 1 起、跳过 hidden/chrome 折叠集元素（同源 skip，两版 k 对齐）；行列/行数规模信号——表格形状在 K2 剥 colspan 前预计算挂 expando；CODE 行数来自 styled 趟 walkLines 收集结果、两版 k 对齐，未命中 map 的防御分支退回旧 `{{PRE_CODE_TAG|n_lines}}` 局部计数不占 k 编号）
    - 空白压缩
    - K10 空壳 span 拆包（clean 趟末段）——仅 data-idx 一个属性的 span 迭代解包，子节点并入父、内容不丢只粒度变粗，省 step 3 输入字节；仅 clean 趟——styled 趟保留这些 span 的 style 供步骤 5-7 判粗体/颜色，孪生 id 集由此放宽为 clean⊆styled
    - K11 纯视图文本折叠 `{{VIEW_TEXT|n_chars/n_words}}`（仅 clean 趟、K10 后、**先于 LT 占位执行**）：
      - 形态：可视模块内部「只含 div+行内文本元素+文本」的**极大纯子树**与 **p>行内 形态**（p 通常不嵌 p、只含 text 或行内元素——p 根独立一档：纯性 = 子树只许行内集（div/p/img 等阻断）、结构门槛同行内档（行内>4）；p 不入纯树允许集——正文段落流 `<div><p>…</p><p>…</p></div>` 不因 p 变纯而整块折叠；p 根折叠时内部行内元素不再单独入选（折叠循环 isConnected 守卫防双重计数））（图表轴刻度、图解步骤、对比卡片、KaTeX 视觉孪生 katex-html 等）整棵内容折为单占位符
      - **壳保留**（data-idx/class/aria-label 继续可引用与标识模块身份，机制同 K5 HIDDEN_TAG）；无编号不进恢复清单——原文在带样式版，步骤 4-8 零影响
      - **行内允许集（2026-09-03 扩展）= a/strong/b/em/i/code/br/MathML + K9 INLINE_TAGS 同族剔 img**——math 整棵放行（LaTeX 还原链走带样式版、步骤 6 才是 math 消费者），img/svg 图片信号仍阻断
      - **两道门槛（2026-09-03 修订，防小内容误折）**——①文本量被折部分 ≥8 汉字/≥6 词（`viewTextSize` 逐文本节点求和：K9 删 div 间空白后按 textContent 切词会把刻度行塌缩成 1 词，按节点计才反映真实量；K11 先于 LT、量的就是原文）②结构量按形态分档——纯 div 树内部 div>6、含行内树 div/行内合计>4（结构门槛同时保证折叠恒有字节收益，无需独立字节阈值）
      - **含长文本模块整棵折叠、原文随折吞没（2026-09-03 K11 先于 LT——clean 根本不为模块内长文本生成占位符）**——孪生守卫为 clean LT 后缀 ⊆ styled，步骤 3 少看见模块内 LT（可视模块整块标记、内部本就不拆）、还原链走带样式版不受影响，纯 LT 文本行（0 内部元素）过不了结构门槛天然不折
      - 豁免 a/button/h1-h3 后代（判读信号）、hidden 阻断纯性（K5 领地）、svg/img/语义标签天然阻断
  - **表格预计算 Markdown（双版条件折叠）**：
    - styled 趟末经 `page-collect-tables.js` 收集每表 `{k,dataIdx,outerHTML,rows,cols}`（折叠前、跳过 hidden）
    - Node 层 `lib/table2md.js` 用可插拔引擎（`--table-engine self|turndown` 或 `U2M_TABLE_ENGINE`，默认 self = jsdom + 手写 GFM 序列化 + `lib/expand-table-spans.mjs` 共享跨格展开；备选 turndown = jsdom + turndown + turndown-plugin-gfm）
    - 流程：预展开表内 `{{LONG_TEXT_k}}` → `expandTableSpans` 网格展开 → GFM 序列化 → 纯结构校验（首行全 `<th>` 才表头、无 th/嵌套块级内容/空表判 failed）
    - 成功存 `2_tables.json` markdown、两版都折叠为 `{{TABLE_k|rows×cols}}`；失败 styled 保 live 打 `data-u2m-table="fail"` + 落 `logs/tables/{k}_{dataIdx}.log` 诊断，失败不报 error（合法分支、落步骤 7）
    - fold 后用 `<!DOCTYPE html>\n` + `documentElement.outerHTML` 重序列化保持产物格式；emit 增 `tables:{total,ok,failed}` + `tablesJson`
  - **代码块预计算 Markdown（表格的 code 镜像）**：
    - styled 趟末经 `page-collect-code.js` 收集每 pre `{k,dataIdx,lang,text,lines,renderedLines,hasNonText,textContentNoGutter,blockContainers,gutterStripped,outerHTML}`（折叠前、跳过 hidden pre）
    - walkLines 结构化行重建——文本节点 `\n` 切分 + `<br>` 断行 + 非行内元素边界软断行（行已空不重复断；**空白守卫结构化（2026-09-03）——仅块间隙纯空白（两侧紧邻块级/容器边缘、非行内独子）零贡献**（CSS 块盒间空白不渲染防幻影空行），行内流空白按 pre 语义保留（缩进 token/行尾 `\n`/空行——旧「纯空白+当前行空」内容条件会吞缩进与空行）；空行容器强制一行空行、返回前弹尾随空行）
    - computed display 在 display:none 祖先下仍返回计算值故隐藏子树亦可提取
    - 层 1 序号槽排除——`userSelect===none` 且子树纯数字+分隔符才整棵跳过，双条件防误杀复制保护整块/纯数字代码行
    - **槽壳传播（2026-09-03）**——壳自身 us:auto 但全部子元素皆槽且自身无槽外文本（≥1 子命中防空传播——空行容器零子命中不算槽；OpenAI 行号槽 display:block 壳实测）→ 壳整棵视为槽：blockContainers 同步排除槽（否则 mixed_signal 文本/容器两侧对槽不对称误杀）、walkLines 不再对壳触发幻影空行
    - lang 链 code[data-language]→pre[data-language]→`language-*` class→Node 层 guessCodeLang 兜底
    - Node 层 `lib/code2md.mjs` 做七类 fail-closed 校验（non_textual/content_loss 空白不敏感往返/unresolved_long_text/empty/single_line_suspect/rendered_mismatch 扣空行豁免/mixed_signal_mismatch ±1 容差——LONG_TEXT 纪元豁免：text 含 `{{LONG_TEXT_` 时跳过渲染交叉校验（收集时 renderedLines 量的是占位符形态、与展开后行数不可比））+ 层 2 行首算术序号剥离（≥3 非空行全带行首整数、公差 1 连续、剥后非退化才剥——防误剥 yaml 数字键）+ `\r` 归一/首尾空行修剪
    - 成功存 `2_code.json` `{dataIdx,lang,content,lines,gutterStripped[,numberStripped]}`、两版都折叠为 `{{CODE_k|n_lines}}` + data-language 提升到 pre；失败 styled 保 live 打 `data-u2m-code="fail"` + 落 `logs/codes/{k}_{dataIdx}.log`，失败不报 error（合法分支、落步骤 7）；emit 增 `codes:{total,ok,failed}` + `codeJson`
  - **清洗版携带无编号 LONG_TEXT 占位（`{{LONG_TEXT|n_unit}}`）**——唯一消费者是步骤 3，还原链不变、一切还原仍走带样式版（步骤 7 引用来自 styled 路径的文章视图、步骤 8 从恢复清单回填；clean LT 后缀 ⊆ styled——K11 先于 LT 执行、模块内长文本随折吞没（2026-09-03，步骤 3 少见、还原链走带样式版不受影响））
  - spec 参考：docs/superpowers/specs/2026-08-27-clean-snapshot-simplify-design.md 及其 2026-08-31 修订记录、2026-09-02 表格占位符设计、2026-09-02 代码块占位符设计
  - 产物：`2_clean_snapshot.html`/`2_clean_style_snapshot.html`/`2_long_text.json`/`2_tables.json`/`2_code.json`/`logs/tables/`/`logs/codes/`

- **步骤 3 [agent] —— LLM 读清洗快照识别关键 ID**

- **步骤 4 `extract_styled.mjs` —— 样式视图裁剪**
  - 四键契约：titleId/descriptionIds/paragraphIds 标量块——paragraphIds 嵌套（数组=子段落流）经共享 `lib/key-ids.mjs` 校验并展开为扁平块清单传页面函数（步骤 4/6/8 同一校验事实源）——的子树 + 到 body 的祖先链一字不动，其余 body 元素删除
  - dumpIds 流内噪音折叠为空元素——清空全部子节点、属性仅留 id/class/data-idx，壳占住流内兄弟位置（步骤 5 juice 求值 nth-child/相邻选择器不失真；步骤 6 适配后迁移块、壳不在清单自然不入文章），落在保留区外的 dump 随分支删除不计错
  - CLI 前置校验——四键互不相交（含段落块重复列举）、dump 是 key 祖先（折叠会摧毁 key 子树）均报 error，emit 增 dumpCollapsedCount
  - `<head>` 与全部 `<style>` 保留，删除或折叠分支的 `<style>` 挪入 head
  - 产物 `4_styled_extract.html`

- **步骤 5 `compute_styles.mjs` —— 样式内联**
  - **前置隐藏声明剥离**（浏览器侧 `page-strip-hidden.js`）：收起元素展开为可见，CSSOM 删全部样式表规则与内联 style 的 display:none/visibility:hidden 声明、只删隐藏声明本身（`.row{display:flex}`+`.collapse{display:none}` 剥除后自然恢复 flex，不盲改 block），规则集 cssText 写回 `<style>` 文本（CSSOM 改写不回写文本节点，不物化即被还原）；`[hidden]` 属性摘除；var 驱动兜底内联覆写 display:block——产物零隐藏声明
  - **`@layer` 级联层解包**（内联前浏览器侧 `page-unwrap-layers.js`）——Tailwind v4 把工具类规则全包在 `@layer utilities` 内而 juice 不进层，不解包则层内规则零内联、只靠工具类表达样式的元素一丝样式不剩；块形层体原位递归提升、声明形层序丢弃；`:root` 变量定义随层提升后 juice 将已定义 var() 解析为具体值
  - juice 级联引擎把 `<style>` 规则内联进 style 属性
  - **函数值真实化**——`page-collect-fn-values.js` 在 juice 产物上收集值仍含 var()/color-mix()/calc() 或空串（简写属性带 var 的 CSSOM 形态）的声明对，`page-resolve-computed.js` 在原始样式页（完整 CSS+class+@property）取 getComputedStyle 计算值，finalize 替换或删净——juice 多级 var 递归会弄丢 color-mix 颜色空间参数产出非法值、@property 变量与 calc 保持函数引用，终态零函数间接引用
  - **finalize 白名单**（浏览器里经 `page-finalize-inline.js`）只留明显结构化样式——border/outline/background/box-shadow、flex/grid 布局（display/gap/对齐）、overflow、transform，外加 font-size/font-weight（判标题层级信号）、position:absolute（判特殊定位元素信号——浮层/装饰/trans2img 候选；唯一按值门控项，仅 absolute 存活，relative/fixed/sticky/static 一律删）——其余声明（含盒模型几何 margin/padding/宽高、定位其余（relative/fixed/sticky/static、inset、z-index）、color 等）全删
  - **零值过滤**（白名单内再过一场）——值等于全元素初始值的声明删除（边框按"边"语义：style none/缺省/initial/unset 或 width 0 → 该边三件全删，bare 简写 border-width/style/color 按四边全灭判、border-color:currentcolor 边存活时留着维持简写紧凑；box-shadow:none、background:transparent、radius:0px、overflow:visible、transform:none 等精确值；flex 布局信号不是零值、保留）
  - **CSS 关键字零值（2026-09-09）**——非继承属性上 initial/unset = 写了等于没写（finalize 末尾 `<style>`/class 删净后内联是唯一级联源），删；font-size/weight（白名单内唯一继承属性）分流：unset≡inherit 删、initial 阻断继承保留；display 不走关键字规则——`display:inline` 仅在 UA 默认行内标签集（span/a/strong/em/code 等 INLINE_DEFAULT_TAGS）上删，div 等块级标签上的 inline 与 inline-block 等非默认值保留
  - **背景噪音两组（2026-09-09，微信长文实测 6_article 372KB→73KB）**——①无图长手簇：无有效 background-image 时 position(含-x/-y)/size/repeat/attachment/origin 无论何值全删（无图可绘制则零视觉效果、含非初始的 no-repeat/left top），clip 仅删初始 border-box（clip 同时影响纯色绘制）；有图时按初始值形删（0% 0%/left top/auto/repeat/scroll/padding-box）②画布等值：background-color（含 bare background 简写纯色/none）与有效背景精确相等删——有效背景 = 最近祖先非透明 background-color、全透明则画布白，白底页面刷白/黑卡上黑 span 是纯噪音、灰卡上白 span 保留（其背景是卡片非画布）、body 自身深色底对 html/白比较不被误删；两组修剪均与顺序无关（只删与有效背景相等的声明、祖先行修剪后有效背景不变）
  - **继承等值 font 修剪（2026-09-09，取代旧「font-size/weight 一律保留」决策）**——font-size/font-weight 与继承有效值相等的重复声明删（normal≡400、bold≡700、medium≡16px 归一，最近祖先声明链上溯、根默认 16px/400），只留对比点——bold 下的 400 重置、17px 下的 18px 等步骤 7 层级/强调信号零损失；em/%/bolder 等不可比形态保守保留；修剪与顺序无关（只删等值声明、祖先行修剪后有效值不变）；修剪出的 bare span 由步骤 6 规则⑥级联解包（微信长文实测 569 个）
  - `<img>` 的 width/height 元素级例外保留（步骤 7 LLM 判图片权重——小图标/大图/图片组的信号），但值为 auto 的删（初始值无信号量、真实像素才判权重）
  - **table/pre 子树剥净**（`closest('pre')` 分支既有 + `closest('table')` 仿写——成功表/成功代码块已折叠为文本节点无 `[style]` 子树故 no-op，仅命中失败 live 表/live 代码块：剥净 border/background/box-shadow 等全部内联样式，到 `6_article.html` 只剩结构+文本+长文本占位符供步骤 7 LLM 语义还原），并删净 `<style>`/class
  - 产物 `5_juice_styles.html`，纯内联

- **步骤 6 `extract_article.mjs` —— 文章视图**
  - 读步骤 5 产物 + 四键 key_ids——校验与 paragraphIds 嵌套展开共享 `lib/key-ids.mjs`：titleId/descriptionIds/paragraphIds 块**全部按元素本身**迁移（完整子树一字不动；块模型下无流容器子节点收集，裸文本无 data-idx 不可标记、不迁——带裸文本的容器由步骤 3 整体标块兜底）
  - title/desc 落在段落块子树内合法（四键只约束 ID 不相交）——收选节点先同一元素去重、再做最外层优先嵌套去重（被包含者跳过、内容随外层整块带入），最终统一按文档序 compareDocumentPosition 排序迁入（paragraphIds 列出顺序不影响输出）
  - 流容器/非流包装层/祖先骨架/dump 空壳不在任何键、自然不入（步骤 6 不消费 dumpIds、无迁移后剔除 pass，emit 无 removedNoiseCount）
  - 随后同页 setContent 内存往返跑瘦身 pass——共享 page-slim-article.js 六条结构规则：
    - ① data-* 只留 data-idx/data-language
    - ② MathML→LaTeX——page-latex.js 的 __u2mLatexText 同作用域注入，KaTeX 双胞胎结构整体替换、无 annotation 保留原树
    - ③ 无文本/纯符号 button 与无文本 svg 整删
    - ④ 有文本 button 解包降级
    - ⑤ scheme ∉ http/https/mailto/tel 的 `<a>` 解包
    - ⑥ 属性只剩 data-idx 的 span 迭代拆包到不动点
  - 保护集 = 迁入 key 元素全集 titleId∪descriptionIds∪blockIds——body 顶层全是显式标记的内容单元，删除/解包类启发式只清理块内未标记残留、替换类不设防；emit 增 slim 计数对象
  - 新 body 带 `max-width:768px; margin:4rem auto` 居中布局；产物 `6_article.html`
  - **大产物分块（2026-09-09）**：`6_article.html` 总字节 > `U2M_ARTICLE_SPLIT_THRESHOLD`（默认 60KB）时按段落块贪心分割为 `6_article_chunk_X_of_N.html`（`lib/chunk-article.mjs` 纯函数：主内容 own 向 `U2M_ARTICLE_CHUNK_MAX`（默认 40KB）靠齐；📌开头（body 前 ≤3 块）/⚠️上文（上一块尾部 ≤2）/⚠️下文（下一块开头 ≤2）三侧只读上下文（**包裹在 HTML 注释内、每块独立一行**——DOM 解析不可见、子代理文本阅读可见；副本剥 data-idx/style、压缩标签间与文本两缘空白，own 区保真）+ ✅/❌ 转换边界标记，均**不计入 40KB 预算**（2026-09-09 用户裁定：上下文是只读参照，为压 40KB 削上下文本末倒置——v1 超限削减/v2 装箱预留两版均致中间块上下文被削光而废弃）、每侧自身 ≤chunkMax/5 字节帽即全部约束；单个巨段落块独立成块；尾块 <5 个段落块循环并入前块——splitThreshold 守护，贪心封边处 40KB 守护恒为死代码）；emit 增 `chunks:{split,count,files}` 恒定形状；成功后清 stale 骨架（`7_skeleton.json` + `7_skeleton_chunk_*.json`——重跑 6 后旧骨架必然失效）与另一模式旧分块 html。步骤 7 由 chunks.split 驱动：true → 单条消息并行派发 count 个子代理各读各的分块、各写 `7_skeleton_chunk_X_of_N.json`；false → 单子代理照旧。步骤 8 入口：`7_skeleton.json` 优先，否则 glob 分片校验（N 一致/X 恰 1..N/均为 JSON 数组）按 X 序合并，emit 增 `chunksMerged`，下游零改动

- **步骤 7 [agent] —— LLM 读 `6_article.html` 产出 markdown 骨架 `7_skeleton.json`**
  - **段落块 = `<body>` 直接子元素**——每个段落块各自拆成独占一行的 markdown 行；数组按文档序、每项单键
  - key 为语义标签 `h1`-`h6`/`p`/`blockquote`/`ul`/`ol`/`code` 或特殊条目 `img`/`table`/`trans2img`——div 可判成 h2，不必与 DOM 标签一致
  - value 直接携带行外 markdown 语法——`h1-h6` 带 `#`、`blockquote` 逐行带 `>`、`ul`/`ol` 行级 `- `/`1. ` 写在 value（嵌套用缩进）、`img` 为完整 `![img](url)`、`table` 为完整管线表，行内格式（`**粗体**`/链接/行内 code）同样由 LLM 写
  - 长文本只引用 `{{LONG_TEXT_k}}` 编号不带后缀且每个恰用一次（trans 标记子树内的除外，由后续轮还原），短文本/URL 照抄
  - code 条目 value 为 `{lang, content}` 对象（lang 必填，无线索时写 `""`）
  - `trans2img` value 为**截图边界链 ID 数组**（链首到模块容器的全部 `data-idx`——链首 = 段落块（body 直接子元素）；段落块第一层有「标题/说明」时链首下移一次、它们独立成条目，第一层有多个复杂模块或带 UI 交互控件时截图定死在段落块整体（不拆标题/说明）；展开器标题是内容标题、算第一层「标题/说明」，嵌套模块的链在展开器面板内部取；模块容器内部的兄弟文本不是分叉信号、随截图吸收）=独立复杂视觉模块（多层级块样式视觉模块：卡片组、对比面板、图表、图解、div 网格数据；单层包装的「代码块+标题/说明」与裸代码块走 code），标记后由步骤 8 截图
  - 分派文本形态优先：
    - `{{TABLE_k}}` 占位符（步骤 2 预计算成功的表）发 `{"table":"{{TABLE_k}}"}` 引用不自转（步骤 8 还原预计算 markdown）
    - 失败 live 无样式表（步骤 2 转换失败、经步骤 5 剥样式保 live；`data-u2m-table="fail"` 标记在步骤 6 随 data-* 白名单删除，步骤 7 按原始 `table` 标签形态分派）走 table（LLM 自转，结构不可表达才降级 trans2img——跨行跨列成功路径已由确定性引擎展开不再触发 trans2img；行列对齐的 div 网格数据走 trans2img）
    - `{{CODE_k}}` 占位符（步骤 2 预计算成功的代码块）发 `{"code":"{{CODE_k}}"}` 引用不自转（步骤 8 物化 `{lang,content}`、lang 以 data-language 收集值为准）
    - 失败 live 代码块（经步骤 5 剥样式；fail 标记同上在步骤 6 删除，按原始 `pre` 形态分派）照旧自转 `{lang, content}`（lang 优先抄 data-language）
    - callout/提示框走 blockquote、单层包装的「代码块+标题/说明」走 code+p、文本可表达的卡片组走列表/小表
    - 装饰不是截图理由，仅 markdown 无法表达的视觉模块（图表/图解/空间表意拼贴/多层级块样式模块、嵌套表/单元格内块级内容）才走 trans2img

- **步骤 8 `screenshot_trans.mjs` —— 占位符还原 + 图片下载 + trans2img 截图**
  - 占位符还原（纯 Node 阶段，顺序 LONG_TEXT → TABLE → CODE）：
    1. LONG_TEXT：把 `2_long_text.json` 两段的 `runs` 逐 k 经 `lib/inline2md.mjs` 转成 markdown 值（异常退回 textContent 纯文本 + warning）、与 `texts` 合并为扁平解析表，再把步骤 7 骨架里所有 `{{LONG_TEXT_k[|suffix]}}` 替换为解析表值（emit 增 `runsResolved`），写出同结构的 `8_resolved_skeleton.json`——trans2img 数组透传
    2. TABLE——`{{TABLE_k[|...]}}` 还原（LONG_TEXT 之后——成功路径表 markdown 已预展开无 LONG_TEXT 占位、失败路径表值已是具体 markdown 不匹配）：查 `2_tables.json` 把 `table` 条值中的 `{{TABLE_k}}` 替换为预计算 markdown，未定义/失败 k 保留字面记 `failedTables`（不阻断）
    3. CODE——`{{CODE_k}}` 还原（TABLE 之后）——**精确匹配**而非子串扫描（代码内容字面含 `{{CODE_n}}` 是真实场景，介绍本管线的文档会跨块错替）：只处理 code 键整体引用（字符串 `"{{CODE_k}}"` 整体物化为 `{lang, content}`、对象 `{content:"{{CODE_k}}"}` 替换 content + lang 覆写，lang 一律取 `2_code.json` 值），未定义/failed k 保留字面记 `failedCodes`（不阻断；残留由步骤 9 守卫响亮报错）
  - emit 增 `runsResolved`/`tablesResolved`/`failedTables`/`codesResolved`/`failedCodes`
  - 图片下载：用 `context.request`（共享代理与登录态）按文档序解包 `![img](url)` 括号内 URL 去重下载 http(s) 图片到 `assets/images/`——命名规则在 `lib/download_images.mjs` 头注：优先 URL 文件名、冲突带编号、扩展名按 content-type、失败保留原 URL 且记入 `failedImages`，成功者只换括号内 URL 把 img 值改写为 `![img](assets/images/x)`（保留 alt）后重写文件
  - trans2img 截图：扫骨架校验 trans2img 条目为非空正整数 ID 数组，走 **live 重渲染 + 严校验 + 快照兜底 + 逐条目择优**：
    - 页 A 加载 `file://1_snapshot.html`（真实文本 + 全量内联样式，签名基准兼兜底截图源），直接用 `--url` 参数开页 B 重渲染（`gotoSettled` + 复用 `snapshot-scroll.mjs` 渐进滚动 + 重注入 `page-prepare.js` 重标记——id 按文档序编号是 prepare 后 DOM 的纯函数，两次渲染结构一致则精确对位）
    - 两侧用共享 `page-element-signature.js` 对每个 id 算 `{tag,text,childCount}` 签名，全等才在 B 上 `el.screenshot({type:'webp'})`、失配/B 侧缺失/live 整体失败在 A 兜底（折叠模块如手风琴收起——步骤 2 只折叠清洗版、带样式版保真流到步骤 7——两侧同隐藏：截图前双层排除 + 逐 id 四段手术）
    - 分类层 `page-exclude-noncontent.js` 每页一次（keep = titleId∪descriptionIds∪paragraphIds 块（`lib/key-ids.mjs` 校验展开）∪trans2img id，隐藏集 = id 全集 − keep − keep 祖先 − keep 子孙，并入 dumpIds，保优先，`visibility:hidden` 零重排）
    - 几何层 `page-reveal-hidden.js` 逐 id 四段：①纵向强制展开（display:none→block、visibility、opacity、`[hidden]`、max-height/height 塌缩）②横向裁剪 reveal（祖先链 overflow-x 裁剪且 clientWidth<scrollWidth → overflow:visible，走到 html 含 body/html）③留白扩盒（四边 20px 呼吸位——每侧 padding +20/负 margin −20 抵消，内容像素级零移动零重排；显式宽高/max-* 钉盒致内容缩水时自愈补 width/height = 原盒+40px；data-u2m-pad 防重入；在遮挡扫描前执行保证环区干净）④非亲族遮挡者隐藏（fixed/sticky 一律、其余盒相交即 `visibility:hidden`，可见后代一并覆写，亲族保留）
    - 盒无效或截图失败换另一页再试、有界 10s 超时不整页挂死、仍失败汇总 error 列出 id，emit 以 `source: live|snapshot|mixed` 如实标注
    - 链上每个 id 各写一张 `assets/trans/{id}.webp`（2x 分辨率，全部保留），随后逐条目按 boundingBox 择优——宽度优先 → 等宽选高 → 全同选最外层（数组首位），把条目 value 回写为选中路径后重写 resolved skeleton

- **步骤 9 `render_skeleton.mjs` —— 骨架回填为 markdown**
  - 纯 Node 读 `8_resolved_skeleton.json`——value 已带行外语法：
    - `h1-h6`/`blockquote` 以 key 为准规范化重建（剥 value 自带 `#`/`>` 前缀后按 key 级别重建，LLM 漏写/写错级别也能纠正）
    - `p`/`ul`/`ol`/`table`/`img` 透传
    - `code` 加 `{lang}` 围栏——围栏 backtick 自适应（围栏严格长于内容最长反引号连续串，GFM 不可闭合）+ lang 剥离非法字符 + 残留守卫（value 仍为字符串 = 未还原的 `{{CODE_}}` 引用 → error 提示先跑步骤 8，镜像 trans2img 守卫）
    - `trans2img`（此时已是步骤 8 回写的选中路径）→ `![](assets/trans/{id}.webp)`、仍为数组则 error 提示先跑步骤 8
  - 块间空行、文件以换行收尾，产物 `9_markdown.md`

**工作目录。** 所有 CLI 只收 `--url`，经 `lib/env.mjs urlDir(url)` 自行派生工作目录（步骤 1 emit 输出 `url-name`/`url-working-path`）。每个 URL 对应 `working/<净化URL>/`；**占优内容 iframe 页面（步骤 1 重定向门判定）的专属目录为 `redirected_<原名>`**，目录内 `redirect_to.yaml`（内容 `to: <目标URL>`）是定位 marker——`urlDir()` 一次 existsSync 间接，步骤 2-9 无感知；marker 只在快照成功后写入（检测未命中时清除 stale）。所有步骤产物直接在 `<url-dir>/` 根目录（`1_snapshot.html`、`2_clean_snapshot.html`、`2_clean_style_snapshot.html`、`2_long_text.json`、`2_tables.json`、`2_code.json`、`3_key_ids.json`、`4_styled_extract.html`、`5_juice_styles.html`、`6_article.html`、`6_article_chunk_X_of_N.html`（>60KB 时）、`7_skeleton.json`、`7_skeleton_chunk_X_of_N.json`（分割时）、`8_resolved_skeleton.json`、`9_markdown.md`）；表格失败诊断在 `<url-dir>/logs/tables/{k}_{dataIdx}.log`，代码块失败诊断在 `<url-dir>/logs/codes/{k}_{dataIdx}.log`；截图在 `<url-dir>/assets/trans/{id}.webp`，下载图片在 `<url-dir>/assets/images/<name>`；净化先剥 `http(s)://` 前缀（目录名从域名开始），其余非 `[A-Za-z0-9.-]` 替换为 `_`，超 120 字符截断 + sha256 前 8 位十六进制后缀；同域名 http/https 派生同一目录。`U2M_WORKING_ROOT` 覆盖根目录（所有测试用它隔离）。`working/cookies/storage_state.json` 是唯一全局登录态——仅 `snapshot-login.mjs` 写入（cookie 按 name|domain|path 去重、localStorage 按 origin+name、读取时剔除过期）；转换脚本只读。`working/cookies/login_decisions_skips.json` 是跳过记忆（`{hostname: [信号名,...]}`，仅弱信号入档）——同样仅 `snapshot-login.mjs` 读写；旧版 `login_decisions.json`（信号级 `"login"|"skip"` 对象格式）已废弃，代码不读不写、磁盘遗留自然失效。

**浏览器上下文**：`snapshot.mjs` 启动单个 chromium 实例贯穿步骤 1 全流程。route-abort `resourceType === 'media'`；`bypassCSP: true`（否则严格 CSP 站点会在 addScriptTag 处杀死 Node 工作流）；viewport 1280×3000；`U2M_PROXY` 环境变量控制代理（未设置继承系统代理 / `direct` 绕过 / URL 显式钉住——真实冒烟曾因系统代理隧道失败报 ERR_TUNNEL_CONNECTION_FAILED 而加，实现于 `script/lib/browser.mjs` 的 `proxyLaunchOptions`）。步骤 8 自起同参数浏览器（外加 `deviceScaleFactor: 2` 原生 2x 截图）：页 A `file://` 渲染快照、页 B 重渲染原 URL（storageState 复用登录态），进程内用完即关。浏览器/viewer 一律在最终 emit **之前**关闭（emit 会退出进程，顺序错了会留孤儿 chromium）。

**登录流程（2026-09-07 登录检测 v2）**：`snapshot-login.mjs` 对六个信号计分（cookieMissing 已删除——现代站点给匿名会话也种 session/csrf 类 cookie（知乎 SESSIONID 假阴性），未登录上下文又近乎恒真，两个方向都无区分度）：全 frames 密码框 / URL 特征 / 标题与正文关键词——标题关键词只匹配 `<title>`、正文关键词只匹配正文 / 重定向 / SPA 等待 / **登录入口点击探测**。登录入口候选（`loginButton` 弱信号）= 主 frame 元素级匹配：交互元素 a/button/[role=button] 看子树文本，其余（Vue/React 站常用 span/div 实现入口，实测极客时间即 cursor:pointer 的 span）看自身直接文本且须指针光标佐证；文本 ≤8 字符、含「登录/登入/登陆/注册/log in/sign in/login/register/sign-in/log-in」、不含「退出/登出/logout/切换」、checkVisibility 可见；候选 ≤3 个、未定论时在 spa 等待窗内 400ms 轮询（SPA 迟水合——networkidle 提前达成、检测跑在头部渲染前——会让一次性检查随机扑空），每候选整个检测生命周期至多点击一次。**点击探测（`loginConfirmed` 强信号）**：原生 `el.click()`（绕过视觉遮挡，弹窗已盖住按钮时事件仍可达）后 ≤1.5s 轮询两种确认——URL 跳转（origin+pathname 归一比较）或**全屏登录弹窗**（fixed/absolute 或 role=dialog、可见、面积 ≥50% 视口、内含表单元素与按钮、排除含 main/h1 的布局容器——页面级 absolute 包装恰好含搜索框会假阳性，modal 几乎从不包含 main/h1）；点击无反应或只弹小 dropdown → `loginConfirmed` 不成立、`loginButton` 保留普通一票（对「点了只展开下拉再二跳」的站点不至于全盘失明）。探测只在**判定未定论且未被记忆豁免**时执行：password 已定论 → 零页面扰动（不点击登录页自己的「登录」提交按钮）；dismissed → 不探测（强信号复活会让记忆形同虚设）。已知边界：不穿透 shadow DOM、不读 aria-label、`target=_blank` 新窗口视为无反应。**两级制判定——`password`/`loginConfirmed` 为强信号单独成立，弱信号 ≥2 合议**。**跳过记忆 v2**（`working/cookies/login_decisions_skips.json`，`{hostname: [信号名,...]}`，仅 snapshot-login read-merge-write、损坏内容形状强转容忍）：viewer「⏭️ 跳过登录」按钮**经确认框**（文案如实说明将记住什么）后只把本次命中的**弱信号名**入档——强信号永不入档（强信号跳过=一次性，下次运行 viewer 照开）；计分语义 = **命中信号全部在记忆内才整体豁免**（dismissed → 判定不需登录、探测不执行、emit `loginSkippedByMemory` 如实通报——「已登录」结论来自记忆压制时 agent/用户必须看得到），存在记忆外新信号时记忆内信号**照常态计票**（旧证据与新证据合议，不再是旧版的信号级永久致盲——知乎误判根因）。跳过同时也刷新 storageState——用户可能已实际登录只是 recheck 永败，不丢会话；「✅ 登录完成」不写档（旧版 login 记录从未被消费）；翻转裁决 = 删数组条目。viewer 工具栏显示判定详情：强信号形态（密码框 / 登录入口点击确认——全屏弹窗/跳转登录页）+ 票数 n/6 + 命中清单（记忆内标注）。**探测状态还原**（点击探测会变异页面——弹窗/跳转/dropdown）：判定需登录且探测确认 → 点击后状态直接进 viewer（弹窗开着/停在登录页最利于登录）；点击过未确认 → `gotoSettled` 原 URL 还原再进 viewer；跳过确认 → 入档 + 刷新 storageState + `gotoSettled` 原 URL 还原再续 capture（快照抓干净页而非登录弹窗）；判定不需登录但点击过 → 还原。**viewer 回调一律 settled 守卫**——finish 关 viewer 会 terminate WS 客户端、必然触发 onClientClose，无守卫则 recheck 的探测点击会把弹窗重新点开、污染后续 capture 快照（实测竞态）。人工登录走 CDP Screencast 中继（`screencast.mjs`：无头 chromium → HTTP+WS viewer，JS/CSS 全内联；**WS 消息监听必须在任何 await 之前挂载**——客户端可能在握手完成后立即发消息，EventEmitter 不排队无监听期的帧）。viewer 起来后**自动 `open` 用户默认浏览器**（原 login_url.mjs 行为，snapshot 合并时遗失、已恢复；`U2M_VIEWER_NOOPEN=1` 关闭，测试用）；登录期间页面视口临时切 1280×800（与 viewer 画布匹配——共享上下文是 1280×3000 懒加载视口，3000px 塞 800px 画布会纵向压扁），结束后恢复。viewer 地址以 `[snapshot] viewer: http://...` 记录到 stderr，测试靠它接入。

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
