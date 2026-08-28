# 真实 URL 手动冒烟清单（不入自动测试）

前置：`bash script/init.sh --url <文章URL>` 输出 ok（含核心参数 skill-root / url-name / url-working-path）。

## 1. 真实静态文章页

1. `node script/snapshot.mjs --url <文章URL>` → 期望 `ok`（内部自动处理登录检测、滚动、虚拟列表检测、快照抓取）
2. 按 SKILL.md 步骤 2-5 继续（结构清洗 → LLM 识别 → LLM 分类 → 分派执行）
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

## 1b. 步骤 8 双层排除 + 四段手术（超宽截全 + 非文章内容不进图 + 截图留白）

对已有全产物的工作目录单独重跑步骤 8（`U2M_WORKING_ROOT` 指向副本，不动原始数据）：
`U2M_WORKING_ROOT=<副本根> U2M_DEBUG=1 node script/screenshot_trans.mjs --url <URL>`，
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
4. 后续按 SKILL.md 步骤 2-5 继续

记录：站点 / 登录方式（账密/验证码/SSO）/ Screencast 操控是否顺畅。

## 3. 特殊元素页（含 canvas/图表/公式/Mermaid 的公开页）

验证 manifest 分派与步骤 3 产物（SVG 语义等价性人工评审）。

## 4. 文章视图瘦身（步骤 5 零值过滤 + 步骤 6 瘦身 pass）

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
