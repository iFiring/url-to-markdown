# 真实 URL 手动冒烟清单（不入自动测试）

前置：`bash script/init.sh` 输出 ok。

## 1. 真实静态文章页

1. `node script/login_url.mjs <文章URL>` → 期望 `logged_in`
2. 并行运行 `node script/clear_trans_html.mjs <文章URL>` 与 `uv run python script/clear_trans_html.py <文章URL>`
3. 人工执行 SKILL.md 步骤 3/4（LLM 步骤）
4. `node script/render_markdown.mjs <url-dir>` → 人工选择 → `selected`
5. 检查 `working/<url-dir>/result.md`：正文完整、无导航/广告、图片引用有效

记录：URL / 截图 / 发现的问题。

### 场景 1 执行记录（2026-08-18，自动化完成）

- URL：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
- 步骤 0-5 全部通过：`ok` → `logged_in` → 双 `ok`（各 4 图 / 19 特殊元素）→ 步骤 3 无需处理 → 步骤 4 去噪 + `{{IMG_1}}` 替换 → `selected`（node_workflow，人工选择以 curl POST /select 模拟）
- 终稿 23KB：正文完整（Description/Constructor/Methods/Examples/See also），无导航/广告；`![IMG_1](node_workflow/assets/images/IMG_1.png)` 指向真实 801×297 PNG（状态图）
- 发现并已修复：长页面（21256px 主列）稀释文本密度 → 启发式误吞整个正文列 → 占位符被 Readability 丢弃 → 双稿只剩页眉（commit ac07e90：启发式加 500 字符上限 + 占位符 `<p>` 包裹；修复后重跑正文完整）
- 遗留观察（不阻断）：manifest 中 15 个 svg_convert pending 对应被剔除的侧栏元素，其占位符随噪声一起消失——条目悬挂无引用，后续可加"丢弃"状态；readability-lxml 会拍平标题层级（3 个标题 vs Node 21 个），双稿择优吸收


1. `node script/login_url.mjs <登录页URL>` → viewer 弹出
2. 在 viewer 中完成真实登录 → 点「✅ 登录完成」→ 期望 `login_done`
3. 重跑同 URL → 期望 `logged_in`（storageState 复用）
4. 后续同上 2-5

记录：站点 / 登录方式（账密/验证码/SSO）/ Screencast 操控是否顺畅。

## 3. 特殊元素页（含 canvas/图表/公式/Mermaid 的公开页）

验证 manifest 分派与步骤 3 产物（SVG 语义等价性人工评审）。
