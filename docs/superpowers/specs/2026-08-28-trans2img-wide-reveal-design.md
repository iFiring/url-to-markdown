# 步骤 8 超宽元素截图双层排除 + 三段手术设计（trans2img wide reveal）

日期：2026-08-28 ｜ 状态：二稿（初稿 spike 实证 + 方案取舍完成；二稿并入双层排除与视口决策，实施计划见 `docs/superpowers/plans/2026-08-28-trans2img-wide-reveal.md`）

## 1. 问题

步骤 8（`screenshot_trans.mjs`）对 trans2img 元素截图时，**宽度超出 1280 视口的部分截取不到，为空白**；横向展开修复后又出现**内容被站点左右 fixed/sticky 导航层叠覆盖**、截图带导航像素的问题；更进一步的要求是**任何非文章内容元素（侧栏、浮窗、广告）都不应进图**。

机理（spike 在 openai 文档页 live 页 + 快照页双向实证）：

- 视口 1280×3000、`deviceScaleFactor: 2`。元素布局盒本身是全宽的（`boundingBox` 与截图宽度都如实反映元素宽度），缺的是**像素**。
- 空白根因是**真实盒级 overflow 裁剪**：`html` 设了 `overflow-x: auto` 时，`body` 的 `overflow-x: hidden` 不再按 CSS 规范上浮为视口裁剪，而是作为普通盒裁剪；内部 `overflow-x: auto` 滚动容器（宽表格站点的标准写法）同理。被盒裁掉的内容 Chromium 根本不绘制，`el.screenshot()` 的 captureBeyondViewport 也无济于事。
- 对照组：`html` 未设 overflow 时 `body` 的裁剪上浮为**视口裁剪**，captureBeyondViewport 扩展视口后本就能截全——**页面写法不同决定了 bug 是否出现，也决定了测试夹具必须构造真实盒裁剪形态（`html{overflow-x:auto} + body{overflow-x:hidden}`），视口传播形态测不到 bug**。
- 覆盖根因：横向展开后内容溢出到 fixed/sticky 导航的列区域，导航层叠在上（且 captureBeyondViewport 下 fixed 元素会在扩展面顶部重复绘制）。

spike 程序化验证数据（openai 文档页，production 等价 before → 修复后 after）：元素 1871 超视口带内容密度 0% → 9.66%；元素 3047 0.22% → 19.67%（遮挡隐藏后）；站点 JS 对行内覆写零回写；百分比宽度对照块前后零变化（无重排）。

## 2. 目标与非目标

**目标**：让超宽 trans2img 元素截到完整像素——视口外内容绘制出来 + 非文章内容元素不进图。排除分两层：**分类层**（LLM 分类事实源的语义排除，页面级一次）与**几何层**（截图时刻的亲族/盒相交判定，逐元素）。页 A（快照兜底）与页 B（live）同享。

**非目标**：

- 不引入 DOM 转 SVG/图片路线。库调研结论存档：foreignObject 系（modern-screenshot/dom-to-image-more/html-to-image）在 GitHub markdown 被 sanitize 剥离、非浏览器渲染器一律不支持、canvas/iframe 必须排除、超大元素同样撞 canvas 上限；satori 自有布局引擎无法重现任意网页；dom-to-svg/dom2svg 无阴影/滤镜且休眠/微型项目；node-html-to-image 自带第二套浏览器且丢登录态。修空白问题不需要付出这些代价。
- 不做 z-boost（全链 `position:relative + z-index` 压顶）。同页实测有效，但祖先链上 `transform`/`filter`/`isolation`/`will-change` 建的 stacking context 会把元素困在低层，压不动外面的 fixed 导航——对任意站点是碰运气，弃用。
- 不改视口：维持 1280×3000（曾议 iPad Air 竖屏 820×1180，否决——快照抓取、渐进滚动稳定、桌面宽度内容完整性都以现视口为准，步骤 8 单独换窄视口会推高 live 签名失配率）。
- 不处理元素超 ~8000 CSS px 的情形（2x 下撞 chromium 合成表面 ~16384 设备 px 上限），维持现有 10s 超时 + 换页重试 + 汇总 error 兜底。
- 不改 stdout 契约（emit 字段一个不动）、不碰 emit 延迟退出防护模式、不加新依赖。

## 3. 方案：双层排除 + 四段手术

执行顺序：**分类层（每页一次，截图循环前）→ 逐 id 四段手术（3.2 纵向 → 3.3 横向 → 3.4 留白扩盒 → 3.5 遮挡者）**。全部行内 `!important`、只动真实问题、幂等、跨 id 状态累积（与现状一致）。

### 3.1 分类层页面级排除（新增）

新共享脚本 `script/lib/page-exclude-noncontent.js`（具名函数 `__u2mExcludeNonContent(keepIds)`），每页一次：

- **keep 集**（调用侧拼好传入）= `3_key_ids.json` 的 `titleIds ∪ descriptionIds ∪ standaloneIds ∪ listFlowIds` ∪ 步骤 8 骨架的 trans2img id 全集——正文事实源与截图目标都必须保；
- **隐藏集** = 页内 `data-u2m-id` 全集 − keep − keep 的祖先 − **keep 的子孙**，再并入 `listFlowDeleteIds`（LLM 明判的菜单/导航/广告/推荐噪音，keep 子树内的也藏——藏的是分类已定性的噪音；`visibility` 留空位不破坏模块形状）。**保优先**：任何来源的隐藏候选与 keep 或 keep 祖先重叠时一律不藏（步骤 3 理论上可产出 delete id 是 keep 祖先的坏分类，藏了会把 keep 元素连坐藏空）；
  - **keep 的子孙不藏**是关键保护：模块/正文**内部**元素是模块视觉本身，naive 补集会把模块内部挖空；
  - keep 的祖先是容器与背景，藏了就毁模块；
- 落地手段 `visibility:hidden !important`：与 DOM 删除像素等价、零重排（模块位置不变、boundingBox 择优不受影响）、页 A（无 JS 的 file://）同样适用。keep 穿透按构造封闭：被藏元素子树内不可能有 keep 元素（有则它是 keep 的祖先，已在排除之列）；子代**显式** `visibility:visible` 规则的穿透与几何层同式处理——对被藏元素的可见后代一并覆写 `visibility:hidden`；
- 执行时机：页 A 在 gotoSettled 后、页 B 在 prepare 重标记 + 签名计算**之后**、截图循环之前（visibility 不动 tag/children/textContent，签名不受影响）；
- `3_key_ids.json` 缺失 → error（与 `1_snapshot.html` 同等的前置产物待遇）；
- 返回 `{hidden, kept}` 计数，仅供 `U2M_DEBUG` 观测。

### 3.2 纵向强制展开（现状，不动）

自元素向 body 逐级覆写正在隐藏的属性：`display:none→block`、`visibility`、`opacity:0→1`、`[hidden]` 摘除、`max-height/height` 塌缩、塌缩裁剪者展开。循环走到 body 为止（不含 body/html）。

### 3.3 横向裁剪 reveal（新增）

自元素**向 html 逐级**（`parentElement` 到 null——与纵向不同，必须包含 body 与 html：真实盒裁剪最常在这两层），对**确实在横向裁剪**的祖先覆写 `overflow: visible`：

- 触发条件：`overflow-x ∈ {hidden, clip, auto, scroll}` **且** `clientWidth < scrollWidth`（正在裁剪才动，本就不裁的零改动）；
- 用 `overflow` 简写一次覆写双轴——规范会把 `overflow-x:visible + overflow-y:hidden` 强制计算回 auto，简写绕开；
- 不碰视口、不碰布局：视口保持 1280，百分比宽度元素零影响（spike 实证元素 bb 前后不变）。

### 3.4 留白扩盒（2026-08-28 追加）

截图四边留 20px 呼吸位（用户反馈：部分模块截图内容太贴边）。**单纯加 `padding: 20px` 会把内容挤窄 40px**——auto 宽块的内容宽 = 可用宽 − padding，文字重排换行、表格被压。用负 margin 抵消：

- 每侧 `padding` := 原 computed 值 **+ 20**（保留模块自身不对称内边距设计，只外扩）；每侧 `margin` := 原 computed 值 **− 20**。推论：盒四向外扩 20px（背景延伸成环）、**内容像素级零移动零形变**、margin 盒尺寸不变（flex/grid 项、兄弟布局均不受扰动；margin 折叠形态下偏移与 padding 恰好抵消，结论相同）；
- **自愈**：显式 `width`/`height`/百分比宽/`max-*`（border-box 常态）会把盒钉住、padding 反吃内容——扩盒后复查内容宽高，缩水（>0.5px）则补 `width/height = 原盒 + 40px`（border-box）+ `max-width/height: none`；
- 执行位置：横向 reveal **之后**（clientWidth/scrollWidth 裁剪判据看原盒）、遮挡者扫描**之前**（盒大了 20px，新碰到环区的邻居才会在扫描中被藏掉，环才干净）；`display:contents` 无盒目标跳过；
- `data-u2m-pad` 属性标记防重入（同一页同 id 只扩一次）；返回的 `box` 在扩盒后测量，择优 boundingBox 自然用扩盒后的尺寸；
- 页 A 与页 B 走同一共享脚本，行为一致。padding 不适用的 display（table-row 等）无害降级为无环。

### 3.5 遮挡者隐藏（新增，相交规则覆盖一切定位形态）

对 `body` 下**非亲族**元素（既非目标子孙亦非祖先，双向 `contains` 排除——模块内的 fixed 徽标/吸顶表头是亲族，保留）：

- `position: fixed / sticky` → `visibility: hidden !important`，一律隐藏。它们是视口家具（导航/吸顶/悬浮按钮），永远不是模块内容；顺带消灭 captureBeyondViewport 的 fixed 元素重复绘制伪影；
- **其余一切元素（不再限于 absolute）→ 与目标盒真实相交时隐藏**（矩形不相交判定）——relative/transform/负 margin/浮动侵入目标盒的形态一并覆盖。判定保持启发式属性：凡在目标盒区域绘制像素的非亲族元素都该走；
- 选 `visibility` 而非 `opacity`：离散无过渡（opacity 可被站点 transition 捕获半途态）、不影响布局；
- 父 hidden 子 visible 会穿透，故对遮挡者的可见后代一并覆写 `visibility:hidden`；
- **不恢复**——导航对同页后续所有截图同样该藏；
- 快速跳过 `SCRIPT/STYLE/NOSCRIPT/TEMPLATE/LINK/META` 标签控制成本（`body *` 全量 getComputedStyle 扫一遍在数千元素页面为每 id 数十 ms 量级，远小于截图本身）。

### 3.6 返回值契约与调用侧

```js
__u2mRevealHidden(id)                  → { found, touched, wideTouched, occluders, box, boxless }
__u2mExcludeNonContent(keepIds, deleteIds) → { hidden, kept }
```

`touched` 语义不变（纵向计数）；`wideTouched`（横向覆写处数）与 `occluders`（隐藏的遮挡者数，含相交命中）仅供 `U2M_DEBUG` 观测——调用侧在现有 debug 块后各加一行。调用侧新增：读 `3_key_ids.json` 拼 keep 集 → 存在的页各执行一次分类层（页 B live 整体失败为 null 时自然跳过；debug 一行 `{hidden, kept}`）→ 循环内逐 id 三段手术。流程零变化。两层都写 `visibility:hidden`，重复覆写幂等无冲突。

## 4. 不变量

- stdout 恰好一行 JSON，emit 字段不变；日志一律 stderr。
- 共享页面脚本是唯一事实源：横向 reveal 与遮挡者隐藏只存在于 `page-reveal-hidden.js`，分类层排除只存在于 `page-exclude-noncontent.js`，严禁分叉进 `.mjs` 编排层。
- 手术全部行内 `!important` + 幂等：可见且无裁剪的元素链零改动。
- 页 A 与页 B 走同一共享脚本，行为一致。

## 5. 测试计划

夹具（内联 SNAPSHOT 字符串，死端口 LIVE_URL 走快照兜底——沿用 `test/unit/screenshot-trans.test.mjs` 既有模式）：

- **超宽裁剪夹具**：`html{overflow-x:auto} + body{overflow-x:hidden}` + 内部 `.wrap{overflow-x:auto;max-width:640px}` 装 2800px 表格 + 左右两条品红 `position:fixed; z-index:9999` 假导航横跨表格区域。**必须用真实盒裁剪形态**（见 §1）。
- **亲族 fixed 夹具**：模块内 `position:fixed` 红色徽标（类比模块内吸顶表头）。
- **分类层夹具**：快照含正文模块 + 带各自 `data-u2m-id` 的侧栏浮窗/推荐位（非 keep、非 keep 祖先），手写最小 `3_key_ids.json` 只标正文 → 断言浮窗特征像素 = 0、正文模块内容像素 > 阈值（完整未误伤）。`page-exclude-noncontent.js` 另配直接 evaluate 的**语义单测**（真实浏览器 setContent + 注入脚本，断言保护规则矩阵：keep 自身/祖先/子孙保、非内容藏、delete 在 keep 子树内藏、delete 为 keep 祖先时保优先）。`page-reveal-hidden.js` 的留白扩盒同样配语义单测（auto 宽块内容探针零移动/盒恰 +40/原不对称内边距保留、显式 border-box 宽自愈、幂等、display:contents 跳过）。

断言（`pixelStats` 辅助：产物 webp 装进 chromium canvas，逐像素统计——颜色匹配每通道 ±40 容差抗 webp 有损压缩；带密度 = 超视口带内与带内众色不同的像素占比）：

1. 截图宽 = 5680 设备 px（2800 + 40 留白 CSS × 2，截全且含环——表格显式 border-box 宽同时是自愈路径的端到端证明）；
2. 超视口带（x ≥ 2600 设备 px）内容密度 > 1%（空白回归守卫：纯色带 ≈ 0%）；
3. 品红像素 = 0（非亲族 fixed 导航已隐藏）；
4. 模块内红徽标像素 > 1000（亲族不被误伤）；
5. 分类层夹具：浮窗特征像素 = 0、正文模块像素完整；
6. 几何层泛化：非 fixed/sticky 的 relative/负 margin 彩色块压在模块上 → 特征像素 = 0（一切定位形态的相交隐藏）。

集成回归：`pnpm test:all` 全绿；真实 URL 冒烟（openai 文档页）按 `test/smoke/SMOKE.md` 流程记录。

## 6. 文档同步

- `script/lib/page-reveal-hidden.js` 头注：机制列表加横向裁剪 reveal 与遮挡者隐藏两条；
- `script/lib/page-exclude-noncontent.js` 头注（新文件）：分类层机制——keep 集构成、隐藏集推导（祖先/子孙保护）、visibility 落地理由；
- `script/screenshot_trans.mjs` 头注：截图段注释改写为"双层排除 + 三段手术"；
- `CLAUDE.md` 管线顺序段步骤 8 括注：同步为双层排除 + 三段手术描述；
- SKILL.md 步骤 8 是面向 agent 的薄决策表（不含内部机制），无需改动。

## 7. 风险与边界

- **>~8000 CSS px 元素**：2x 撑爆合成表面上限，截图仍会失败——现有超时/换页/error 兜底覆盖，属已知边界不处理。
- **overflow 简写双轴副作用**：覆写 `overflow:visible` 同时解除该祖先的纵向裁剪（如文本省略容器）。触发条件要求横向真实溢出（`clientWidth < scrollWidth`）才动手，且纵向塌缩本就由 3.2 展开——风险收窄到"祖先刻意用 overflow 裁饰性纵向溢出"的长尾，可接受。
- **visibility 穿透后代**：已用"遮挡者可见后代一并覆写"封闭；若站点 JS 在截图瞬间动态重建导航节点，新节点不在本次扫描内——spike 实测站点 JS 零回写，未观测到该风险。
- **sticky 内容误伤**：理论上存在"非亲族 sticky 是页面正文的一部分且恰好视觉上属于模块"的构造，实践中 sticky 的语义就是视口吸附，判定为可接受。
- **性能**：遮挡扫描每 id 一次全量 `body *` getComputedStyle；数千元素页面数十 ms 量级，不构成瓶颈。分类层每页一次 `querySelectorAll('[data-u2m-id]')` + 祖先链判定，量级更小。
- **分类层 id 对齐**：keep 数字 id 在页 A（`1_snapshot`）与页 B（live 重标记）间只在两次渲染结构一致时对位——签名严校验本就保证结构漂移时不用 B 截图；漂移场景由几何层兜底。
- **分类层误伤**：keep 子孙保护规则封死"模块内部挖空"；`listFlowDeleteIds` 藏错的风险与步骤 6 删除同源（同一 LLM 分类事实源），可接受。
- **双层叠加**：两层幂等覆写同一 `visibility:hidden` 声明，无冲突、无顺序依赖（分类层先执行只是语义整洁）。
- **留白扩盒长尾**：padding 不适用的 display（table-row/column 等）无环但无害；`position:absolute` 目标在 `left/right` 单边定位下环可能不对称（margin 补偿方向随定位边）——不裁内容，可接受；环区透明背景的模块在 markdown 白底上呈现为白边，即预期效果。

## 8. 修订记录

- 2026-08-28：初稿。方案经 spike 实证（`.temp/spike-wide-reveal.mjs`，gitignored throwaway：live 页复现空白 → 横向 reveal 修复 → 遮挡两方案对照）与库调研（satori / dom-to-image-more / dom-to-svg / dom2svg / node-html-to-image / html-to-image / modern-screenshot，结论见 §2 非目标）后定稿。
- 2026-08-28：二稿。并入两项决策：视口维持 1280×3000（iPad Air 竖屏 820×1180 方案否决，记入非目标）；非文章内容排除升级为**双层**——新增分类层 `page-exclude-noncontent.js`（keep 集 = 四类正文 id ∪ trans2img id；隐藏集 = id 全集 − keep − 祖先 − 子孙，并入 listFlowDeleteIds；visibility:hidden 落地），几何层（原 3.3）相交规则从仅 absolute 泛化到一切定位形态。章节重排：分类层为 3.1，三段手术顺延为 3.2-3.4，返回值契约并为 3.5。同日精化（写实施计划时）：分类层签名补 `deleteIds` 参；子代显式 `visibility:visible` 穿透与几何层同式覆写；测试计划补分类层语义单测。
- 2026-08-28：三改。用户反馈截图内容太贴边——新增 **3.4 留白扩盒**（每侧 padding +20 / 负 margin −20 抵消，内容零重排；显式宽高钉盒时自愈；`data-u2m-pad` 防重入；遮挡者扫描前执行），遮挡者顺延为 3.5、返回值契约为 3.6，标题改"四段手术"。测试：超宽断言 5600 → 5680（自愈路径端到端证明），新增 `test/integration/page-reveal-hidden.test.mjs` 语义矩阵（auto 宽零移动 / border-box 自愈 / 幂等 / contents 跳过）。文档同步：page-reveal-hidden.js 与 screenshot_trans.mjs 头注、CLAUDE.md 步骤 8 括注、SMOKE.md 1b 节。
