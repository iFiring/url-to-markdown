# 真实 URL 手动冒烟清单（不入自动测试）

前置：`bash script/init.sh` 输出 ok（纯环境自检；核心参数 skill-root / url-name / url-working-path 由步骤 1 输出）。

## 1. 真实静态文章页

1. `node script/snapshot.mjs --url <文章URL>` → 期望 `ok`（内部自动处理登录检测、滚动、虚拟列表检测、快照抓取）
2. 按 SKILL.md 步骤 2-6 继续（结构清洗 → LLM 识别 → 文章视图渲染 → LLM 骨架 → 终态渲染）
3. 检查最终产物：正文完整、无导航/广告、图片引用有效

记录：URL / 截图 / 发现的问题。

### 场景 1 执行记录（2026-08-18，自动化完成）

- URL：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
- 步骤 0-5 全部通过：`ok` → `logged_in` → 双 `ok`（各 4 图 / 19 特殊元素）→ 步骤 3 无需处理 → 步骤 4 去噪 + `{{IMG_1}}` 替换 → `selected`（node_workflow，人工选择以 curl POST /select 模拟）
- 终稿 23KB：正文完整（Description/Constructor/Methods/Examples/See also），无导航/广告；`![IMG_1](node_workflow/assets/images/IMG_1.png)` 指向真实 801×297 PNG（状态图）
- 发现并已修复：长页面（21256px 主列）稀释文本密度 → 启发式误吞整个正文列 → 占位符被 Readability 丢弃 → 双稿只剩页眉（commit ac07e90：启发式加 500 字符上限 + 占位符 `<p>` 包裹；修复后重跑正文完整）
- 遗留观察（不阻断）：manifest 中 15 个 svg_convert pending 对应被剔除的侧栏元素，其占位符随噪声一起消失——条目悬挂无引用，后续可加"丢弃"状态

### 场景 1 补充记录（2026-08-19，mmh1.top，代理故障排查）

- URL：https://mmh1.top/article/prompt-cache.html（免登录中文翻译页）
- 首跑报 `net::ERR_TUNNEL_CONNECTION_FAILED`——根因是**本机系统代理**（macOS HTTP/HTTPS 代理 127.0.0.1:1082）：chromium 静默继承系统代理，代理当时的瞬时状态拒绝了对目标站的 CONNECT 隧道；稍后重试直连/走代理均 200，非站点问题。已加 `U2M_PROXY` 逃生通道（fix/u2m-proxy 分支）
- 重跑通过：Node 稿 22KB 全文完整（7 节/表格/代码块）；~~Python 稿仅 1.9KB——readability-lxml 选中错误容器只截到 §5.2 片段~~（Python 运行时已移除，双稿择优不再适用；**已废弃**）
- 1 个 passthrough_svg 实为装饰性背景（aria-hidden 网格线），其引用被 Readability 剔除——无害；manifest 悬挂 done 条目属已知遗留观察
- 步骤 3 无 pending；步骤 4 完成；步骤 5 首跑 120s 内无人点击 → timeout（用户重跑即可）

## 1b. 步骤 6 双层排除 + 四段手术（超宽截全 + 非文章内容不进图 + 截图留白）

对已有全产物的工作目录单独重跑步骤 6（`U2M_WORKING_ROOT` 指向副本，不动原始数据）：
`U2M_WORKING_ROOT=<副本根> U2M_DEBUG=1 node script/render_markdown.mjs --url <URL>`，
检查 stdout 单行 ok、stderr 三类 debug 行（分类层排除 / 横向裁剪 reveal / 遮挡者隐藏）、
超宽元素（>1280 CSS px）截图的视口外带（设备 px x≥2560）内容密度由 ≈0 变为 >1%、无导航像素。
2026-08-28 起新增留白扩盒：每张 trans 截图四边多 20px 呼吸位（内容零重排），
重跑后抽验 1-2 张 webp 目检边缘不再贴边。

### 执行记录（2026-08-28，openai 文档页）

- URL：https://developers.openai.com/api/docs/guides/prompt-caching（spec spike 同页；副本自 `working/developers.openai.com_api_docs_guides_prompt-caching/`，其 `assets/trans/*.webp` 为修复前产物，构成 before/after 对照）
- 结果：`ok`，count=10，**source=live**（签名命中 10/10）；stdout 单行 JSON 契约保持
- debug 行实测：`分类层排除（live）: 隐藏 1860 / keep 命中 68`（快照侧同值）；`横向裁剪 reveal` 触发于 1870（3 处）/3046（1 处）；`隐藏态强制展开` 触发于 3044/3348；无 `遮挡者隐藏` 行——分类层已把 fixed 侧栏整体隐藏、几何层按设计跳过已隐藏元素（两层协同，非缺陷；几何层路径由单测品红断言覆盖）
- 像素对照（pixelStats，2x 设备 px）：**3047（2864px 宽 benchmark 表）超视口带密度 0.0000 → 0.2969**，目检全宽有内容、无导航像素；其余元素窄于视口（带不存在、密度 0 为平凡值），宽度与修复前一致无回归
- 结论：超视口空白 bug 在真实页面修复；分类层按步骤 3 事实源正确清洗 1860 个非内容元素

## 2. 真实登录墙页

1. `node script/snapshot.mjs --url <登录页URL>` → viewer 弹出（内部 snapshot-login.mjs 检测到需登录）
2. 在 viewer 中完成真实登录 → 点「✅ 登录完成」→ 脚本继续执行滚动、检测、快照
3. 重跑同 URL → storageState 复用，无需再次登录
4. 后续按 SKILL.md 步骤 2-6 继续

记录：站点 / 登录方式（账密/验证码/SSO）/ Screencast 操控是否顺畅。

## 3. 特殊元素页（含 canvas/图表/公式/Mermaid 的公开页）

验证 manifest 分派与步骤 3 产物（SVG 语义等价性人工评审）。

## 4. 文章视图瘦身（步骤 4 零值过滤 + 瘦身 pass；下表为 2026-08-28 旧编号执行记录，产物名保留当时形态）

URL：https://developers.openai.com/api/docs/guides/prompt-caching（复用既有步骤 0-4 产物，1_snapshot 未重跑）

| 产物 | 改动前 | 改动后 |
|---|---|---|
| 5_juice_styles.html | 241.4KB | 177.9KB（-26.3%） |
| 6_article.html | 239.5KB | 110.5KB |
| 9_markdown.md codex:// 链接 | 2 处 | 0 处 |

- 1_snapshot.html sha256 前后一致（步骤 8 零冲击）
- slim 计数：spansUnwrapped=1483 / buttonsRemoved=7 / buttonsUnwrapped=28 / svgsRemoved=30 / linksStripped=2 / attrsDropped=43 / mathReplaced=0
- 步骤 8 截图 source：mixed（9 张）
- 9_markdown 代码围栏逐字相同 11/11 块，公式 $…$ 命中 6 处
- mathReplaced=0 说明：该页 19 个 `<math>` 的 annotation 均无 `encoding="application/x-tex"`（非 KaTeX 双胞胎形态），规则②按"无 annotation 保留原树"正确放行；公式在骨架中由 annotation 文本手工转写，9_markdown 命中不受影响

- 2026-08-29 追记：`__u2mLatexText` 分级信任扩展（未声明 encoding 的裸 annotation 也信；显式声明非 TeTeX 编码仍拒）后重跑步骤 6——`mathReplaced` 0→19、MathML 残留 0、`6_article.html` 110.5KB→96.7KB（累计 -59%）。工作目录中 7/8/9 产物仍为扩展前生成（公式内容一致——LLM 转录与机械替换等价），下次完整跑批自然对齐

## 5. 步骤 5-6 端到端（修订后骨架契约回归，2026-09-02 新增；2026-09-11 起原步骤 8/9 合并为单 CLI、后重编号为 5/6）

两页已有步骤 0-4 产物（`working/mmh1.top_article_prompt-cache.html/`、`working/developers.openai.com_api_docs_guides_prompt-caching/`），按修订后 `references/markdown_skeleton_guide.md` 重跑：步骤 5（子代理读 `4_article.html` 写 `5_skeleton.json`）→ `node script/render_markdown.mjs --url <URL>`，各步 stdout 单行 `ok`。

mmh1 页检查点（中文博客，多层级视觉模块密集）：

- 四处多层级模块（cache scope 层级图 / BAD-OK 对比 ×2 / 三面板账本）判 `trans2img`，链形如 `[133]`、`[343]`、`[467]`、`[599]`（链首即容器）
- 两处带标题栏代码块（idx 234/536）判 `code`+`p` 而非 trans2img；`lang` 取自 `<code data-language>`（tsx/jsonc）
- byline（idx 72 原文/作者/日期/阅读）收敛为单个 `p`；「01」-「07」圆形徽章不入标题文本
- 图表内 LONG_TEXT（如 9/10/11）不被引用；6_markdown 无同段重复

openai 页检查点（英文文档，展开器/嵌套图解/UI 控件密集）：

- 嵌套图解（figure 3059/3363，位于展开器内）的 trans2img 链取局部（链首为展开器内容内的独占包裹层），不含展开器自身（3045/3351）——双向独占链新定义
- 3 处 UI 控件残留（`role="group"` 选项卡 / `role="button"` 触发器，idx 2101/2233/3119）不产生条目；6_markdown 无 "JavaScriptPython"、"Earlier modelsGPT-5.6+" 拼接残留
- 数学节 `$…$` / 块级公式照抄；裸 `pre` 自带边框背景仍判 `code`；代码左侧行号（`1<!-- -->2<!-- -->` 形态）删除
- 两个真实表格（idx 1998/2761）走 `table`；div 网格图解走 `trans2img`

两页共同：6_markdown 目检标题层级合理、无垃圾条目、trans2img 图片路径有效（`assets/trans/{id}.webp`）。

记录：每页 skeleton 条目数 / trans2img 条目与 id 列表 / 发现的契约偏差。

## 6. 代码块占位符（2026-09-02 新增）

- URL: <mmh1.top prompt-cache 文章地址>（`working/mmh1.top_article_prompt-cache.html/`）
- 预期：步骤 2 emit `codes` 全 ok（≥2 块）；重跑步骤 5-6 后 `6_markdown.md` 代码块
  换行与原 LLM 语义重建结果逐字一致（内容来自 `2_code.json` 预计算而非转录）
- URL: <developers.openai.com prompt-caching 指南地址>（`working/developers.openai.com_api_docs_guides_prompt-caching/`）
- 预期：步骤 2 emit `codes` 14 块全 ok、其中 10 块 `gutterStripped`（user-select:none
  序号槽层 1 排除 + 2026-09-03 槽壳传播——display:block 壳 us:auto、数字 span 才
  us:none 的形态不剔除会 mixed_signal 误杀）；pre 2874 的 `2_code.json` 内容以 `{`
  开头且 `  "model"` 两格缩进保留（2026-09-03 空白守卫结构化后恢复；k=6 代码内
  空行同步保真）；步骤 7 对占位符块发 `{"code":"{{CODE_k}}"}` 引用不自转
- 实测（2026-09-03 槽壳传播 + 空白守卫结构化后）：`codes: {total:14, ok:14,
  failed:0}`，k=5/6（2874/3127，此前 mixed_signal_mismatch）转 ok；k=5 两格缩进
  在位、k=6 空行恢复 13 行全保真；`logs/codes/` 空

## 7. 内嵌 iframe 壳页（重定向门，2026-09-07 新增）

- URL 1: https://mmh1.top/article#/ai-article/skill
- URL 2: https://mmh1.top/article#/ai-article/prompt-cache
- 预期：步骤 1 emit `redirect.to` 为 …/article/{skill,prompt-cache}.html；工作目录为 `redirected_` 前缀名（内含 `redirect_to.yaml`）；步骤 2 起仍以原始 URL 调用、产物落在 redirected 目录；`6_markdown.md` 为完整文章
- 注意：按记忆规约，收尾前用最终代码重跑全管线再记录结论
## 8. 长文本行内 run 折叠（2026-09-07 新增）

- URL: <含 KaTeX 行内公式 + `<br>` 混排长段的技术博客/文档页真实地址>
- 预期：
  - 步骤 2 `2_long_text.json` runs 段——KaTeX 段落的值只含 `<math…><annotation…>`
    极简形态，无 katex-html/mord/strut/svg 孪生痕迹（spec §10 原子化）；公式源
    单份不重复
  - `<br>` 混排段的 canonical 为 `<br>` 形态（非 `<br></br>`——jsdom 会把后者
    解析为两个 br、换行翻倍）
  - 重跑步骤 5-6 后 `6_markdown.md`：run 段落 `$…$` 公式单份、无孪生文本污染
    （形如 `$E=mc^2$*E*=*m**c*2` 即失败）；硬换行单个、无多余空行
  - 混排长段的行内格式（粗体/斜体/链接/行内 code/公式）来自确定性通道：
    同一 URL 重跑逐字一致，无字面 `{{LONG_TEXT` 残留
- 实测：待跑

## 9. 登录检测 v2：点击探测 + 跳过记忆（2026-09-07 新增）

- URL: https://www.zhihu.com/question/2071375581464343126/answer/2072161669128655948
- 背景：旧版误判「已登录」的双根因——①`login_decisions.json` 里历史 skip 把
  loginButton 强信号永久致盲；②知乎给匿名用户种 SESSIONID，`cookieMissing`
  假阴性。v2 删除 cookieMissing、旧记忆文件废弃不读、登录入口改点击探测确认。
- 预期：检测判定需要登录（强信号 loginConfirmed·modal——点击页头「登录/注册」
  后 SignFlow 全屏弹窗命中 ≥50% 视口+表单+按钮判定）；viewer 打开且画面停在
  弹窗态；旧 `login_decisions.json` 的知乎 skip 条目不再生效
- 实测（2026-09-07，--timeout 20000 无人值守冒烟）：stderr `登录检测:
  loginConfirmed+loginButton 命中（2/6），强信号 loginConfirmed（modal）→
  需要登录`；viewer 正常启动；超时如实 emit `{"status":"error",
  "reason":"login_timeout"}`；`working/cookies/` 未生成 skips 文件（未点跳过）
- 待人工全链路验证：viewer 内真实登录知乎 → 「✅ 登录完成」recheck 通过 →
  快照抓到登录态页面；或「⏭️ 跳过登录」确认框 → `login_decisions_skips.json`
  写入 `{"www.zhihu.com":["loginButton"]}` → 快照抓干净页（无 SignFlow 弹窗）→
  二次运行豁免不弹 viewer 且 emit `loginSkippedByMemory:["loginButton"]`

## 10. 大产物分块（2026-09-09 新增）

URL：微信长文（复用 `working/mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw/`，旧 6_article.html 372KB / 509 段落块）

- [ ] 重跑步骤 4 → 预期 emit `chunks.split=true`、约 8 块、主内容 ≤50KB（上下文侧不计）、分块含 📌/⚠️/✅/❌ 标记
- [ ] 步骤 5 并行派发子代理 → 全部分片落盘
- [ ] 步骤 6 → `chunksMerged` 与块数一致；6_markdown.md 与不分块基线对比内容一致（标题层级、列表延续无跨块断裂）

## 11. 边界 chrome 清除与折叠（2026-09-09 新增）

spec: `docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md`；plan: `docs/superpowers/plans/2026-09-09-body-spine-chrome-removal.md` Task 8

### 执行记录（2026-09-09，五样本隔离协议，通过）

协议：`mktemp -d` 隔离目录只读复制 `working/` 五样本的 `1_snapshot.html`，`U2M_WORKING_ROOT` 指向隔离目录重跑步骤 2——`working/` 零写入。mmh1 重定向样本以 `redirect_to.yaml` 给出的目标 URL（`https://mmh1.top/article/skill.html`）派生普通目录跑——负控制只考察内容，重定向定位机制不参与步骤 2 行为。

**chrome 统计实测（emit `chrome` 对象）**：

| 样本 | removed | cssHidden | dialog | overlay | comments | clean 字节（旧→新） | 净瘦 |
|---|---|---|---|---|---|---|---|
| 微信长文 | 20 | 26 | 3 | 1 | 48 | 66954 → 48201 | **-28.0%** |
| OpenAI prompt-caching | 5 | 1 | 0 | 0 | 46 | 41261 → 25614 | **-37.9%** |
| 极客时间 983111 | 2 | 0 | 0 | 0 | 161 | 29975* → 29265 | -2.4% |
| 知乎回答（登录墙） | 0 | 1 | 0 | 2 | 0 | 45467* → 43082 | -5.2% |
| mmh1 skill（负控制） | **0** | **0** | **0** | **0** | 1 | 17195 → 17122 | 仅注释差 |

\* 极客/知乎旧字节取自 spec §13 探针记录（working/ 无旧清洗版产物）。

与预期偏差（均已核查为良性）：
- 微信 folds 合计 30 > 预期 8-14——逐项核对全部 chrome：wx_bottom_modal_wrp（DIALOG）、js_article_bottom_bar（OVERLAY）、js_profile_ban、隐藏 iframe、**24 个 weui-a11y_ref 读屏隐藏 span**（模拟探针漏计该类，1-9 字脚手架文本）
- 微信 removed=20（预期 ≈24，±20% 带内）；OpenAI removed=5（预期 ≈7）、字节 -37.9% 优于 spec ≈27%——D1 kill 明细全部 chrome：文档横幅 div、fixed 顶栏 header（探针 v2 增量核算 bug 曾漏计的那个）、搜索浮层、Ask AI 挂件（vocab 命中）
- mmh1 负控制完美成立：三规则全零命中，新旧 diff 仅 head 主题字体注释一行（-73B）

**k 对齐实证（微信）**：`{{CODE_k}}` 编号集合旧 vs 新逐字一致（k=1-39 全集）；TABLE 无（该页无表）；正文区（data-idx<4378）p 元素 400→400 零丢失，消失的 7 个 p 与 3 个 LONG_TEXT 全在 chrome 区（随折叠壳/D1 删除吞没）。

**OpenAI 正文完整性**：正文 11 个标题（h1 Prompt caching + 10 个 h2 章节）全保留；消失的 10 个标题全为 chrome——搜索浮层 h2「Search the API docs」+「Suggested」×2、导航抽屉（`div#drawer` 折为 `{{HIDDEN_TAG|1145_words;49_li/49_a…}}`，即 spec 预期 H1-C 接住的 26% 文本量侧栏）分组 h3×6、Ask AI 挂件 h2「Docs agent」。

**知乎登录横幅**：`Modal-wrapper Modal-enter-done`（28_div/7_button/6_svg）折为 `{{OVERLAY_TAG|110_chars}}`——spec §7 预期形态命中。

**步骤 3 选择质量对比（微信，子代理按 analyze_html_guide.md 全文判读）**：PASS——
- titleId=18、descriptionIds=[20,51,55] 与旧版一致（20 现为 VIEW_TEXT 壳，壳可引用性验证通过）
- paragraphIds：旧 507 块**零缺失**（全部仍是 js_content 直接子块）；新增 1 块（486，旧版漏标的正常正文段落——改进非误伤）；39 个 CODE 占位全选
- chrome 零误选：新四键最大 id 4360，≥4378 区段（DIALOG/OVERLAY/HIDDEN 壳、评论区、工具条、a11y span、iframe）无一入键；dumpIds=[] 与 guide「流外不标」一致

**实现期发现并修复（TDD 红阶段）**：①深度上限测试夹具裸文本独子链被既有 K11 整链折叠——BIG 裹 `<p>` 排除干扰；②**run 覆写 bug**——LT run 检测先于 K5x 消费，可见 overlay/dialog 壳内文本 ≥16 汉字被记录 run（expando 挂壳），clean 趟 foldLongText 把 chrome token 覆写为 `{{LONG_TEXT}}`；修复 = K5x 折叠时删除壳上 `__u2mRunHtml/__u2mRunSize`（hidden 种因 run 根自查 display:none 天然免疫）。两修复详见对应 commit（`7225b4c`/`bffab5e`）。

全量验证：`pnpm test:all` 441/441 绿（单测 374 + 集成 67）；golden 逐字节钉住（article-1 重建仅 head 注释行漂移、clean-simplify 零漂移、longtext.json 零漂移）。
