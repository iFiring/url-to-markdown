# 虚拟列表中断门（Virtual-List Gate）设计

- 日期：2026-08-19
- 状态：待实现
- 关联：`SKILL.md`、`script/lib/page-*.js` 共享脚本体系、`docs/design/url-to-markdown-design.md`

## 1. 背景与目标

当前管线对**所有页面**无差别跑同一套：`page-init.js` 劫持 `IntersectionObserver`（覆盖懒加载）→ `progressiveScroll` 滚到底 → `waitForDomStable` 等节点数稳定 → 转换。这套对静态 / SPA / SSR / 懒加载 / 按需加载页面都能拿到全文（滚动即可触发全部渲染）。

唯一无法全文转化的是**虚拟列表**（react-window / react-virtualized / vue-virtual-scroller 等）：这类页面只渲染可见窗口 + 少量缓冲项，滚到下方时**顶部节点被回收复用**，DOM 里始终只有一小段切片。现有管线会把这一小段当正文产出，静默给出**残缺 Markdown**。

目标：在转换**之前**检测虚拟列表，命中则中断、告知用户，避免残缺输出。其余页面行为不变。**只做这一道门**——非虚拟列表类型不做差异化调参（留待后续迭代）。

## 2. 检测信号

虚拟列表的本质机理是**节点回收**：滚到下方后，顶部曾可见的内容从 DOM 消失（被复用为下方内容）。普通长页只是把顶部滚出视口，DOM 节点仍在。

**信号定义**：
1. 在页面顶部，取正文签名 `T`：`document.body.innerText` 归一化（折叠空白、trim）后前 ~400 字符。
2. 滚到底加载全程（与 `progressiveScroll` 同款的滚到底循环，至 `scrollHeight` 稳定）。
3. **在底部、尚未回顶**时，取当前 `document.body.innerText`（同归一化），检查 `T` 是否为其子串。
4. `T` 消失 → 虚拟列表。`T` 仍在 → 普通长页。

**时序约束（强制）**：第 3 步必须在滚到底、`scrollTo(0,0)` 之前执行。虚拟列表滚回顶部会重新渲染顶部窗口，若在回顶后检查，`T` 已回来，检测失效。检测函数不回顶——检测完即关浏览器，回顶无意义。

**误报边界**：会主动裁剪离屏 DOM 的普通长页（罕见，多见于列表/Feed 而非文章正文）会被误判。这类页面滚到底时顶部确已不在 DOM，与虚拟列表同构，产出亦只能是部分窗口——中断反而正确。误报方向与"避免静默残缺输出"目标一致，**接受**。

**无限滚动 Feed**：顶部节点是追加而非回收，`T` 始终在 DOM → 不判为虚拟列表，走正常流程；其"无终止"由 `progressiveScroll` 的 60 次上限自然兜底，不在本门范围内。

## 3. 架构与组件

### 3.1 共享检测脚本（单一事实源）

新建 `script/lib/page-*.js` 体系下的 `script/lib/page-detect.js`，含一个具名函数：

```js
function __u2mDetectVirtualList(cfg) {
  // cfg: { signatureChars?, scrollIters?, settleMs? }
  // 整段在浏览器内一次 evaluate 跑完：
  // 取 T → 滚到底循环 → 在底部检查 T → 返回 { isVirtualList: bool, signature }
}
```

与 `page-init.js` / `page-classify.js` 同模式：普通非模块文件，双运行时当**文本**读入注入。**严禁**把检测逻辑分叉进 `.py` 或 `.mjs`。检测是 Node-only 步骤（见 3.2），但脚本仍归共享体系，Python 侧若将来需要可直接注入调用，逻辑不重复。

**调用约定**（遵循 Playwright 1.62 evaluate 语义，见 CLAUDE.md）：完整表达式形式 `page.evaluate(\`(${src})()\`)`。

### 3.2 新 CLI：`script/detect_page.mjs`

Node-only（与 `login_url.mjs` 同——单运行时门，不产双稿、无需 Python 镜像）。职责：

1. 解析 `<url>` 参数（沿用 `parseArgs` + 提前 return 防护，遵循 emit 延迟退出陷阱模式）。
2. `openPage(url, { viewport:{width:1280,height:3000}, initScripts:[pageInit], storageStatePath: storageStatePath(), log })`——复用步骤 1 写好的登录态。
3. `const detect = await page.evaluate(\`(${pageDetect})()\`)`。
4. 分支：
   - `detect.isVirtualList` → 关浏览器 → `emit({ status:'virtual_list', page_type:'virtual_list', reason:'页面为虚拟列表，仅渲染可见窗口，无法全文转化为 Markdown' }, 0)`。
   - 否则 → 关浏览器 → `emit({ status:'scrollable', page_type:'scrollable' }, 0)`。
5. 任意异常（open 失败等）→ `emitError(e.message, 1)`；usage 错误 → exit 2。

浏览器在最终 emit **之前**关闭（emit 会 `process.exit`，顺序错会留孤儿 chromium——与现有 CLI 同约束）。

### 3.3 不改动的部分

- `clear_trans_html.mjs` / `clear_trans_html.py`：**完全不变**。检测已在步骤 1.5 完成，转换器不再感知虚拟列表。`progressiveScroll` / `waitForDomStable` / 特殊元素分派 / 图片下载 / Readability / turndown 全部原样。
- `page-classify.js` / `page-init.js` / `page-merge.js` / `page-clean.js` / `page-inline.js` / `page-latex.js`：不变。
- 步骤 2-5 的 stdout 契约、manifest 结构、分派表：不变。

### 3.4 SKILL.md 变更

在"步骤 1 · 打开 URL，判断/完成登录"与"步骤 2 · 双工作流清洗转换"之间插入：

**步骤 1.5 · 检测页面特性**

```bash
node <skill-root>/script/detect_page.mjs <url> [--timeout 120000]
```

| stdout status | 动作 |
|---|---|
| `scrollable` | 进入步骤 2 |
| `virtual_list` | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error` | 把 `reason` 反馈给用户并终止 |

步骤 2-5 编号不变（用 1.5 避免重排）。原步骤 1 的 `login_done`/`logged_in` 仍直接进 1.5。

"常见错误处理"表可补一行：`detect_page` 报 `virtual_list` 但用户确信是普通长页 → 该站可能主动裁剪离屏 DOM，属已知误报边界，建议改用其他抓取方式。

## 4. 数据流

```
步骤0 init → 步骤1 login_url(写 storage_state) → 步骤1.5 detect_page
                                                ├─ scrollable → 步骤2 clear_trans_html(双工作流) → 步骤3/4/5
                                                └─ virtual_list → 告知用户并终止
```

`detect_page.mjs` 产出：仅 stdout 一行 JSON（无文件产物）。不写 working 目录、不写 manifest、不写 sketch。`page_type` 字段为诊断输出，agent 仅对 `virtual_list` 分支动作。

## 5. 契约一致性

- **恰好一行 JSON**：`scrollable` 与 `virtual_list` 均为 exit 0 的正常路径（`virtual_list` 是"正常中断"，非 error），日志走 stderr。`error` 走 exit 1，usage 走 exit 2。
- **emit 延迟退出陷阱**：`detect_page.mjs` 用 `return usage(...)` / parseArgs 返回 null + 提前 return 防护，不在 `emit()` 之后继续执行。
- 与 `init.sh` / `login_url.mjs` / `clear_trans_html.mjs` / `render_markdown.mjs` 的契约形态完全对齐。

## 6. 错误处理

| 场景 | 处置 |
|---|---|
| `openPage` 失败（网络/代理/超时） | `emitError(reason, 1)`——与现有 CLI 一致 |
| 检测 evaluate 抛异常 | 捕获 → `emitError(reason, 1)`；不静默继续 |
| `U2M_PROXY` 代理问题（ERR_TUNNEL...） | 继承现有 `openPage` 的 proxy 处理，错误信息与步骤 2 一致 |
| 误判（普通长页被判 virtual_list） | 属已接受边界；SKILL.md 常见错误表给出说明 |

## 7. 测试

遵循 TDD。夹具放 `test/fixtures/`，经 `test/helpers/fixture-server.mjs` 在随机端口提供。

1. **`test/fixtures/virtual-list.html`**：tall spacer 占位 + 少量渲染项 + 滚动时回收顶项（模拟 react-window 行为：维护一个固定大小窗口数组，滚动时替换内容）。断言 `detect_page.mjs` 对它 emit `virtual_list` 且退出码 0。
2. **`test/fixtures/long-article-lazy.html`**：长正文 + 懒加载图片（IntersectionObserver 触发），**不**回收顶部节点。断言 emit `scrollable`、退出码 0。
3. **`test/fixtures/static-short.html`**：短静态页。断言 `scrollable`。
4. **契约单测**：断言 `detect_page.mjs` 在各路径下 stdout 恰好一行合法 JSON、stderr 不混入 stdout、退出码正确（参照现有 contract 单测模式，`test/unit/contract.test.mjs`）。
5. **共享脚本纯函数行为**（可选，镜像 `urlToDirName` 双语言同向量测试模式）：若 `page-detect.js` 的签名/归一化逻辑可抽出纯函数，用同组向量在 Node 单测覆盖。

集成测试以子进程方式启动真实 CLI、对接随机端口夹具服务器（与现有集成测试同模式）。Python 侧无需新增测试（检测 Node-only）。

## 8. 非目标

- 不对 SPA / SSR / 懒加载 / 按需加载做差异化调参——它们都走现有滚动流程，本门只识别虚拟列表。
- 不处理无限滚动 Feed 的"无终止"问题（由 progressiveScroll 60 次上限兜底）。
- 不处理 tab/路由切换导致的内容替换（非滚动触发，超出"虚拟列表"定义）。
- 不把检测塞进 clear_trans_html（用户明确要求独立步骤 1.5）。

## 9. 开放问题

无。检测信号、逻辑归属、步骤放置、契约形态、测试范围均已与用户确认。
