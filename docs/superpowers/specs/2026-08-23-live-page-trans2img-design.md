# 步骤 8 trans2img 截图改为重渲染真实 URL（live re-render + 快照兜底）

- 日期：2026-08-23
- 状态：设计获批，直接实施（有界改动）
- 修订记录：v1 守护式方案（步骤 1 chromium 存活跨步骤、browser.json/TTL reaper/扫杀）因运维复杂度过高被否决——重渲染方案以"严校验 + 兜底"替代"同实例"获得同等鲁棒性，且步骤 1 一行不动。
- 影响面：`script/screenshot_trans.mjs`（stage 3 重写）、新增 `script/lib/page-element-signature.js`、删除 `script/lib/page-resolve-placeholders.js`、单测/集成测试、SKILL.md、CLAUDE.md、README

## 1. 背景与动机

现状步骤 8 的截图源是 `6_article.html`——768px 重建文档，步骤 5 白名单剥掉了 color 等声明，暗色模块黑底黑字，且不是真实页面。目标：trans2img 截图取自**重新渲染的真实 URL**——canvas 图表重绘、跨域 iframe 重新加载、登录态与字体渲染全部保真。

否决过的方案：坐标迁移（2_clean_snapshot 零样式，坐标与真实页面无对应）；守护式活页面（运维复杂度不成比例）；纯渲染 1_snapshot.html（canvas 序列化后空白——降级为兜底）。

## 2. 核心机制：重标记是确定性的

`data-u2m-id` 按文档序递增编号，是「prepare 之后 DOM」的纯函数。`page-prepare.js` 的变换序列——同源 iframe 合并 → 注 `<base>` → 内联外部 CSS → **剥尽 script/noscript/template** → 剥 on* 属性 → 剥复制按钮 → src 绝对化 → 文档序标记——在同一 URL 的两次渲染上执行结果相同。因此步骤 8 重新渲染 URL 后把同一套 `page-init.js + page-prepare.js`（共享脚本，唯一事实源）再注入一遍，DOM 未变则 id 精确落在同一元素，**无需任何 id/class 反查搜索**。

"两次渲染 DOM 一般不变"是被**校验**的前提而非被依赖的假设：变了（广告插入/水合差异/A/B）则 id 平移，严校验拦截，该 id 降级快照兜底——降级而非错图。

## 3. 步骤 8 改造（screenshot_trans.mjs）

### 3.1 前置产物

读 `7_skeleton.json` + `2_long_text.json` + **`1_snapshot.html`**。`6_article.html` 不再是本步骤输入；缺 1_snapshot → error 指路步骤 1。

### 3.2 stage 3 流程

单浏览器（`chromium.launch`，进程内、用完即关——现有生命周期模式不变，无守护进程），context 选项：viewport 1280×3000、**deviceScaleFactor 2**（原生 2x 截图）、storageState（存在则注入）、bypassCSP、route-abort media、`addInitScript(page-init)`（B 页导航时生效，劫持 IntersectionObserver 助懒加载 + mermaid 源码捕获）。

1. **页 A（快照侧）**：`goto file://1_snapshot.html`（domcontentloaded + 尽力 networkidle + `fonts.ready`）→ evaluate 读 `<base data-u2m-base>` 的 href 得原 URL → 注入 `page-element-signature.js` 对全部 trans2img id 计算签名。A 侧同时就是兜底截图源（真实文本、全量内联样式，只需按需再等一次资源）。
2. **页 B（live 侧）**：`gotoSettled(原 URL)` → `snapshotScroll`（复用步骤 1 的渐进滚动 + DOM 稳定，懒加载/水合就位）→ evaluate 重注入 `page-prepare.js`（重标记）→ 同套签名函数对同批 id 计算签名。任何一步抛错（站点不可达/代理失败等）→ 整体降级，全部 id 走 A。
3. **逐 id 比对与截图**：签名全等 → B 上 `el.screenshot({type:'webp'})`；失配或 B 侧缺失 → A 上截。A 侧也缺失（id 不在快照里）→ error（骨架与视图不匹配，重跑步骤 7，与现行为一致）。
4. 关浏览器 → emit。

### 3.3 签名与严校验（新共享脚本 page-element-signature.js）

`__u2mElementSignature(ids)` → `{ [id]: { tag, text, childCount } | null }`，text 为折叠空白后截断 300 字符的 textContent。两侧同一函数，Node 侧深度相等比对。刻意**假阴性偏向**：时间戳/计数等任何文本差异都判失配降级，绝不输出错图。

### 3.4 emit 契约变更

- 删 `replaced`（页面内占位符还原退役：live 页与 1_snapshot 都是真实文本）；
- 增 `source: "live" | "snapshot" | "mixed"`；
- 其余字段（`count`/`screenshots`/`images`/`failedImages`/`resolvedSkeleton`/`skipped`）不变。

### 3.5 占位符还原退役

删 `script/lib/page-resolve-placeholders.js` 与其单测；移除 `readSharedScript('page-resolve-placeholders.js')`、页面内还原、页面内未定义编号校验。stage 1 骨架级还原（纯 Node，`2_long_text.json` → `8_resolved_skeleton.json`）**保留不变**，skeleton 引用未定义编号仍报 error。

### 3.6 图片下载（stage 2）

不变，与 stage 3 共享同一浏览器实例（有 trans2img 或有 img 任一才启动浏览器）。

## 4. 不改动

步骤 1（snapshot.mjs 及四个 lib 阶段）、步骤 2-7、步骤 9、stdout 单行 JSON 契约的其余部分、共享脚本唯一事实源原则（重标记/签名都是 page-*.js 页面逻辑，编排只做流程控制）。

## 5. 测试

- **单测（离线，CI 不依赖外网）**：fixture `1_snapshot.html` 的 `<base>` 指向死端口（127.0.0.1:9，ECONNREFUSED 即时失败）→ live 整体降级 → 断言 `source:"snapshot"`、截图落盘、resolved skeleton、无 `replaced` 字段。改造用例组：正常兜底截图、code 对象还原（不变）、骨架级未定义编号 error（不变）、id 双侧未命中 error、缺前置指路步骤 1、img 下载与混合用例。删除页面内还原相关 2 条用例。
- **集成（夹具服务器 + 真实 chromium，确定性）**：夹具页含可标记模块 → 跑步骤 1 → 从 1_snapshot 解析模块 id 写 7_skeleton → 步骤 8 断言 `source:"live"`；服务器翻版（模块前插入元素使 id 平移、文本变更）→ 重跑步骤 8 断言校验失配自动 `source:"snapshot"`。
- 全量回归 `pnpm test:all`；kimi-k2-6 真实工作目录重跑步骤 8 做冒烟。

## 6. 已知边界（如实记录，不阻塞）

- **HTTP 缓存不跨步骤**：进程级 launch 每次全新临时 profile，重渲染重新拉取静态资源（秒级成本，正确性无影响）。per-url 持久 profile 会引入双 cookie 存储的认证语义纠缠，v1 不做。
- **时刻差**：live 截图来自重渲染的"此刻"，正文来自冻结快照；`source` 如实标注，兜底路径与正文完全同时刻。
- **live 侧 fixed/sticky 遮罩**（后出现的 cookie banner）可能盖进截图；无 JS 的快照兜底无此问题。已知代价。
- **低文本模块**（canvas 图表 textContent 近空）签名区分度弱——严校验下假阴性增多只是多走兜底，无错图风险。
- **mermaid**：步骤 8 重渲染时 mermaid JS 重新执行，渲染结果确定性高则签名匹配；不匹配走兜底。
