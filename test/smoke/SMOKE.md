# 真实 URL 手动冒烟清单（不入自动测试）

前置：`bash script/init.sh` 输出 ok。

## 1. 真实静态文章页

1. `node script/login_url.mjs <文章URL>` → 期望 `logged_in`
2. 并行运行 `node script/clear_trans_html.mjs <文章URL>` 与 `uv run python script/clear_trans_html.py <文章URL>`
3. 人工执行 SKILL.md 步骤 3/4（LLM 步骤）
4. `node script/render_markdown.mjs <url-dir>` → 人工选择 → `selected`
5. 检查 `working/<url-dir>/result.md`：正文完整、无导航/广告、图片引用有效

记录：URL / 截图 / 发现的问题。

## 2. 真实登录墙页

1. `node script/login_url.mjs <登录页URL>` → viewer 弹出
2. 在 viewer 中完成真实登录 → 点「✅ 登录完成」→ 期望 `login_done`
3. 重跑同 URL → 期望 `logged_in`（storageState 复用）
4. 后续同上 2-5

记录：站点 / 登录方式（账密/验证码/SSO）/ Screencast 操控是否顺畅。

## 3. 特殊元素页（含 canvas/图表/公式/Mermaid 的公开页）

验证 manifest 分派与步骤 3 产物（SVG 语义等价性人工评审）。
