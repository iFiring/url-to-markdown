# 真实 URL 手动冒烟清单（不入自动测试）

前置：`bash script/init.sh` 输出 ok。

## 1. 真实静态文章页

1. `node script/snapshot.mjs <文章URL>` → 期望 `ok`（内部自动处理登录检测、滚动、虚拟列表检测、快照抓取）
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

## 2. 真实登录墙页

1. `node script/snapshot.mjs <登录页URL>` → viewer 弹出（内部 snapshot-login.mjs 检测到需登录）
2. 在 viewer 中完成真实登录 → 点「✅ 登录完成」→ 脚本继续执行滚动、检测、快照
3. 重跑同 URL → storageState 复用，无需再次登录
4. 后续按 SKILL.md 步骤 2-5 继续

记录：站点 / 登录方式（账密/验证码/SSO）/ Screencast 操控是否顺畅。

## 3. 特殊元素页（含 canvas/图表/公式/Mermaid 的公开页）

验证 manifest 分派与步骤 3 产物（SVG 语义等价性人工评审）。
