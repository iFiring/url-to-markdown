# url to markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

- 使用：把单个 URL 的正文转为 Markdown 文件
- 不使用：批量爬取、站点镜像；登录态存于 IndexedDB / Service Worker 的站点

操作手册（步骤 0-9 决策表、错误处理）见 [SKILL.md](SKILL.md)；面向 Claude Code 的开发约定与架构说明见 [CLAUDE.md](CLAUDE.md)。

## Meta Data

---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

## 环境要求

- Node ≥ 20（`init.sh` 可经 nvm 自动安装正确版本）
- Linux / macOS
- 包管理器优先级 pnpm > yarn > npm（降级使用，不自行安装）
- Playwright chromium（`init.sh` 检测并安装）

## 技术栈

- **Playwright**（chromium）——无头抓取、CDP Screencast 登录中继、元素 2x 截图
- **juice**——CSS 级联引擎，把 `<style>` 规则内联进元素 style 属性
- **ws**——Screencast viewer 的 WebSocket 中继
- 语义分派（步骤 3 关键 ID 识别 / 步骤 7 markdown 骨架）由 LLM agent 按 SKILL.md 手册完成，不依赖 readability / turndown 类转换库

## 项目结构

```text
SKILL.md                 # Skill 主体文件（步骤 0-9 操作手册）
CLAUDE.md                # 面向 Claude Code 的开发约定
README.md                # 本文件
script/                  # CLI 脚本
  lib/                   # 共享模块（contract / env / browser…）与页面脚本 page-*.js
test/                    # 单元 / 集成测试 + fixtures + smoke 冒烟清单
docs/                    # 设计文档与实施计划
package.json
pnpm-lock.yaml

working/                 # 运行时工作目录（gitignore，仅保留骨架）
  cookies/               # 所有访问过 URL 的登录态公共存储（storage_state.json）
  <url-path>/            # 该 URL 步骤 1-9 的全部产物
    assets/
      images/            # 步骤 8 下载的正文图片
      trans/             # 步骤 8 的 trans2img 截图（WebP，2x 分辨率）
    1_snapshot.html
    2_clean_snapshot.html / 2_clean_style_snapshot.html / 2_long_text.json
    3_key_ids.json
    4_styled_extract.html
    5_juice_styles.html
    6_article.html
    7_skeleton.json
    8_resolved_skeleton.json
    9_markdown.md        # 最终产物
```

`<url-path>` 由 URL 净化生成：先剥 `http(s)://` 前缀（目录名从域名开始），其余非 `[A-Za-z0-9.-]` 替换为 `_`，超 120 字符截断 + sha256(URL) 前 8 位十六进制后缀。同域名的 http/https 两版派生同一目录。

## 核心流程（步骤 0-9）

步骤 0-2、4-6、8-9 只运行脚本并按 stdout 的 `status` 分支；步骤 3、7 由 agent（LLM）做语义处理。

| 步骤 | 执行者 | 命令 | 产物 |
|---|---|---|---|
| 0 环境初始化 | 脚本 | `bash script/init.sh --url <url>` | 环境就绪；输出核心参数 `skill-root`/`url-name`/`url-working-path` 并创建工作目录 |
| 1 快照下载 | 脚本 | `node script/snapshot.mjs --url <url>` | `1_snapshot.html` |
| 2 结构清洗 | 脚本 | `node script/clean_snapshot.mjs --url <url>` | `2_clean_snapshot.html`、`2_clean_style_snapshot.html`、`2_long_text.json` |
| 3 关键 ID 识别 | **agent** | 读 `2_clean_snapshot.html` | `3_key_ids.json` |
| 4 样式视图裁剪 | 脚本 | `node script/extract_styled.mjs --url <url>` | `4_styled_extract.html` |
| 5 样式内联 | 脚本 | `node script/compute_styles.mjs --url <url>` | `5_juice_styles.html` |
| 6 文章视图提取 | 脚本 | `node script/extract_article.mjs --url <url>` | `6_article.html` |
| 7 markdown 骨架 | **agent** | 读 `6_article.html` | `7_skeleton.json` |
| 8 还原 + 下载 + 截图 | 脚本 | `node script/screenshot_trans.mjs --url <url>` | `8_resolved_skeleton.json`、`assets/images/`、`assets/trans/` |
| 9 骨架回填 | 脚本 | `node script/render_skeleton.mjs --url <url>` | `9_markdown.md` |

各步骤的 `status` 分支决策表、骨架词汇表与约束见 SKILL.md；各脚本的技术细节见对应脚本头部注释。

### 关键机制

- **stdout 单行 JSON 契约**：每个 CLI（含 `init.sh`）向 stdout 输出恰好一行 JSON，失败路径也不例外；日志走 stderr；退出码 0/1/2（usage_error=2）。agent 依据 `status` 字段分支，这是整个技能的骨架约定。
- **共享页面脚本是分类的唯一事实源**：`script/lib/page-*.js` 由 Node 编排层当文本读入注入页面，分类、清理、iframe 合并、样式内联等页面侧逻辑只存在于这些文件，不重复实现于 `.mjs` 层。
- **登录态**：`working/cookies/storage_state.json` 是唯一全局登录态，仅步骤 1 的登录流程写入（cookie 按 name|domain|path 去重、localStorage 按 origin+name、读取时剔除过期）；转换脚本只读。需要人工登录时弹出 CDP Screencast viewer（无头 chromium → HTTP+WS 页面，JS/CSS 全内联）。
- **虚拟列表检测**：仅渲染可见窗口的页面无法全文转化，步骤 1 命中即终止（`reason=virtual_list`），不写快照。
- **长文本占位**：步骤 2 把长文本（超阈值 16 汉字/12 词的单个文本节点）替换为 `{{LONG_TEXT_k|n_chars}}` / `{{LONG_TEXT_k|n_words}}`，agent 只见结构不见内容，步骤 8 机械还原——语义判断不携带全文，token 可控。占位分两趟执行：带样式版带编号（还原链消费），清洗版无编号 `{{LONG_TEXT|n_chars}}`（唯一消费者步骤 3 只看结构+体量）；原文进 `2_long_text.json` 恢复清单，还原链只走带样式版路径。
- **trans2img live 重渲染截图**：`data-idx` 按文档序编号是 prepare 后 DOM 的纯函数——步骤 8 按 `--url` 参数重渲染原页面并重注入同一套标记脚本，两次渲染结构一致则 id 精确对位；与快照侧逐 id 签名严校验（假阴性偏向，宁降级不出错图），失配或重渲染失败自动降级快照渲染兜底，`source` 字段如实标注来源。
- **核心参数单一事实源**：`<url-name>` 由 `lib/env.mjs urlToDirName(url)` 派生（非 `[A-Za-z0-9.-]` → `_`，超 120 字符截断 + sha256 前 8 位后缀）——步骤 0 的 init.sh 与步骤 1-9 的工作目录派生共用同一实现，保证两处目录名恒一致。
- **清洗版瘦身**：步骤 2 对 `2_clean_snapshot.html` 走「单页两趟 + 机械规则」（K1 class 语义过滤、K2 属性白名单——URL/aria 清空、hidden 裸属性折叠 `{{HIDDEN_TAG|n_chars;构成}}`、table/pre 折叠、空白压缩、空壳 span 拆包、**K11 纯视图折叠**——可视模块内部「div+行内元素+文本」极大子树与 p>行内 段落整棵折为 `{{VIEW_TEXT|n_chars/n_words}}`、壳保留，行内允许集 = a/strong/em/code/br/MathML 等行内文本类元素、img/块级标签仍阻断），零样式计算、无检测管线；清洗版唯一消费者是步骤 3（携带无编号 LONG_TEXT 占位与 VIEW_TEXT 折叠），一切还原走带样式版——正文与带样式版零丢失
- **astro 解包两趟共享 + 带样式版属性白名单**：`astro-` 前缀脚手架标签（astro-island/slot 等，携带巨量序列化 props）两趟都解包——脚手架不再流进步骤 4-7（曾实测 `6_article.html` 残留 59 个 astro 标签、27KB 属性噪音）；带样式版另有属性白名单（22 静态属性 = clean K2 八属性 + style/href/src/width/height + 内容信号 colspan/rowspan/start/aria-label/data-src/srcset/datetime/open/lang，`<style>` 标签豁免）+ **`<style>` 选择器引用属性的动态保留集**（删属性即断 juice 级联——曾实测 article-1 丢 45 条 border/background/display 声明）。主流框架中仅 Astro 在 SSR 产物留持久化自定义标签（Vue/Nuxt/Qwik 等走属性或 script，由白名单/步骤 1 覆盖），解包集钉在 `astro-` 前缀、永不外溢到真实 web component（GitHub/YouTube 的内容型自定义标签）
- **@layer 级联层解包（步骤 5 前置）**：Tailwind v4 站点把工具类规则全包在 `@layer utilities` 里而 juice 不进层——不解包则卡片边框/圆角/背景等工具类样式零内联（实测某站点 56% 的 CSS 在层内、带样式元素仅 579 个）。步骤 5 内联前先在浏览器侧解包（块形层体原位递归提升、`@layer a, b;` 层序声明丢弃，DOM 圈选不误伤正文代码示例），`:root` 变量定义随层提升后 juice 把已定义 var() 解析为具体值——实测同站点带样式元素 579 → 2632
- **函数值真实化（步骤 5）**：juice 对多级 var 链的递归解析会弄丢 color-mix 颜色空间参数（产出非法值、浏览器整条丢弃），@property 注册变量与 calc() 保持函数引用——步骤 5 收集残留声明对，在原始样式页（完整 CSS+class+@property）取 getComputedStyle 计算值替换（无值则删净），终态零 var()/color-mix()/calc()，全部是浏览器计算出的真实值
- **隐藏声明剥离（步骤 5 前置）**：收起的元素（手风琴面板/折叠区/抽屉）在计算样式前展开——CSSOM 只删 display:none/visibility:hidden 声明本身，规则其余声明保留，自然 display:flex/grid/table 等结构信号完整流进步骤 7（不盲改 block）；`[hidden]` 摘属性、var 驱动收起兜底覆写。实测参考页 27 处 display:none 清零，展开元素带自然布局
- **零值声明过滤（步骤 5 finalize）**：白名单内值等于全元素初始值的声明删除——边框按"边"语义判无效（宽 0 或样式 none 的边整条不可见，三件全删），Tailwind preflight 被 juice 内联出的海量 `border: 0px solid` 即此类；实信号（非零边框/圆角+背景、flex、font-size/weight 相对对比）全保留。实测参考页 5_juice 约 -26%
- **文章视图瘦身 pass（步骤 6）**：迁移后同页内存往返执行六条结构规则——data-* 白名单清理、MathML→LaTeX（KaTeX 双胞胎整体替换）、无文本/纯符号 button 与空 svg 删除、有文本 button 解包、非白名单协议 `<a>` 解包（codex:// 营销链接不再漏进产物）、空壳 span 迭代拆包（语法高亮 token 塌缩为纯文本）。保护集跳过 key 元素、`1_snapshot` 零接触。实测参考页 6_article 239.5KB → 110.5KB

### 环境变量

| 变量 | 作用 |
|---|---|
| `U2M_WORKING_ROOT` | 覆盖 working 根目录（测试隔离用） |
| `U2M_PROXY` | 代理控制：不设则继承系统代理 / `direct` 绕过 / URL 显式钉住 |
| `U2M_DEBUG` | 非空时各 CLI 向 stderr 输出 `[dbg +N.NNs]` 调试行（阶段耗时、输入输出字节数、登录检测信号、滚动轮次、逐图下载、`[net]` 打开页面（document 导航，含重定向/登录跳转）的请求头与响应头（裸行无前缀，子资源不记），反爬诊断用） |
| `U2M_FONTCONFIG_CONF` / `U2M_FONT_DIR` | 覆盖 init.sh（仅 Linux）fontconfig 配置与字体目录的探测路径；测试在任意宿主模拟 Linux 环境用 |

## 测试

```bash
pnpm test                 # 单元测试（node --test test/unit/*.test.mjs）
pnpm run test:integration # 集成测试（真 chromium + 本地夹具服务器）
pnpm test:all             # 全量
```

- 夹具服务器随机端口（`test/helpers/fixture-server.mjs`），`U2M_WORKING_ROOT` 隔离工作目录
- 真实 URL 手动冒烟清单见 `test/smoke/SMOKE.md`

## 开发进度

| 阶段 | 内容 | 进度 |
|------|------|------|
| 项目结构 | 目录 / package / `init.sh` 环境自检 | 已完成 |
| 步骤 1 `snapshot.mjs` | 登录检测 + 渐进滚动 + 虚拟列表检测 + 全保真快照（单 chromium 贯穿） | 已完成 |
| 步骤 2 `clean_snapshot.mjs` | 结构清洗（单页两趟：astro 解包共享 + 带样式版属性白名单 + 清洗版 K1-K9 极致瘦身） | 已完成 |
| 步骤 3 / 7 agent 语义操作 | key_ids 识别 / markdown 骨架生成（SKILL.md 手册） | 已完成 |
| 步骤 4-6 | 样式裁剪 → juice 内联 → 文章视图 | 已完成 |
| 步骤 8 `screenshot_trans.mjs` | 占位符还原 + 图片下载 + trans2img 截图 | 已完成 |
| 步骤 9 `render_skeleton.mjs` | 骨架回填 markdown | 已完成 |
| 测试 | 单测 + 集成 167 项 | 已完成 |
| 真实 URL 冒烟 | 手动清单 `test/smoke/SMOKE.md` | 场景 1 已记录通过（产生于旧双稿管线，新 9 步管线待重验）；场景 2/3 待人工 |
| 2026-08-29 | 步骤 5/6 文章视图瘦身（零值过滤 + 六条结构规则） | ✅ |
