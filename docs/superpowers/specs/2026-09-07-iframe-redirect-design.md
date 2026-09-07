# 内嵌 iframe 页面的重定向转换设计

- 日期：2026-09-07
- 状态：已与用户对齐设计，待实施
- 起因：`https://mmh1.top/article#/ai-article/skill` 这类「壳页 + 内容 iframe」页面，现有管线步骤 0-2 处理不了（详见 §1）

## 1. 背景与问题

### 1.1 页面形态（2026-09-07 对 mmh1.top 实测）

- 主文档 = 站点壳（正文仅 83 字符），hash 路由
- 文章全文在一个 iframe 里：`https://mmh1.top/article/skill.html`（React 客户端渲染，约 10700 字符正文）
- iframe 有独立内部滚动上下文（内容 12957px / 可视 2944px）
- 站点近期才改成此结构——`working/mmh1.top_article__ai-article_skill/` 里 9 月 1-3 的旧产物 0 iframe、内容在主文档，当时管线跑通

### 1.2 现有管线缺口

| # | 位置 | 问题 |
|---|------|------|
| 1 | `script/lib/snapshot-scroll.mjs` | 只滚主页面 `window`，iframe 内部滚动上下文永不触发，frame 内懒加载内容不会加载 |
| 2 | `script/lib/page-prepare.js`（同源合并段） | 合并只搬 body 子节点，frame `<head>` 里的 `<style>`/`<link>` 全丢 → 合并内容无样式 → 步骤 5 无规则可内联、步骤 7 丢视觉信号 |
| 3 | `script/lib/page-prepare.js`（合并门槛） | 「主文档文本 <500 才合并」——壳文本 ≥500 的站整篇 frame 内容直接丢失 |
| 4 | `script/lib/snapshot-detect.mjs` | 虚拟列表检测只看主 frame innerText，frame 内虚拟列表是盲区 |

## 2. 方向选择（已否决项）

| 路线 | 结论 |
|------|------|
| **重定向到 frame 真实 URL**（本设计） | frame 页成为一等转换目标：滚动/虚拟列表/CSS 内联/截图全部原生复用现有机制；样式保真天然成立 |
| 合并进主文档（扩展 page-prepare 同源合并） | 否——需解决 frame 样式携带、级联冲突、iframe 内部滚动三大难题。**现有合并行为一字不改，保留为 srcdoc/about:blank 这类无 URL 可重定向 frame 的回退** |
| 步骤 0 检测 | 否——init 为此要开浏览器渲染，每个 URL +5~15s，非 iframe 页也付 |
| 每步独立重判 | 否——检测需真实浏览器渲染（步骤 2 是纯 Node 无浏览器），且站点在步骤间变化会导致结论不一致。**判定一次、落盘、后续读盘** |

跨域说明：重定向支持跨域 frame，依赖的不是 CORS——`goto(frameUrl)` 是顶层导航，CORS 不参与；Playwright 经 CDP 测量任意 frame 正文也不受同源策略限制。需要守的边界是「frame 页独立打开时行为退化」（§7 退化守卫）与「登录态按 origin 隔离」（§3 goto 后复跑登录检测）。

## 3. 总体架构：步骤 1 四阶段中插入重定向门

`snapshot.mjs` 现有时序 `登录 → 滚动 → 虚拟列表检测 → 快照` 改为：

```
登录阶段（原页面；七信号本就扫全部 frames）
  → 滚动阶段（原页面。壳页高度快速稳定，成本极低；滚动后才检测，
     可捕获「滚动才插入的 iframe」，且此刻 frame 内容已加载充分）
  → 【新】重定向检测门（lib/snapshot-redirect.mjs）：
      未命中 → 虚拟列表检测 → 快照（现状不变，零行为差异）
      命中 → goto(frame URL)
             → 登录检测复跑（同源通常 no-op；跨域登录墙时 viewer 开在
               内容页——正确的 origin，storageState 照常积累）
             → 滚动阶段（这次滚的是真实内容页，参数复用）
             → （若目标页自身又嵌占优 iframe：递归，深度上限 2 跳）
             → 虚拟列表检测 → 快照
```

要点：

- 虚拟列表检测**永远跑在最终目标页上**——虚拟列表若存在，恰恰会在内容页里；命中则现有 `virtual_list` 错误语义不变（exit 1、不写快照）
- 跨域 frame 的 cookie 由 context 级 cookie jar 天然携带（壳页加载 iframe 时已收到 frame 域的 cookie）
- 检测逻辑放新共享模块 `lib/snapshot-redirect.mjs`，导出判定函数；snapshot.mjs 只编排——沿用「模块不 emit、抛异常或返回值」的既有架构

## 4. 判定规则：什么才算「内容 iframe」

对主文档里的每个 `<iframe>` 依序过闸，全部通过才是候选：

1. **可导航**：frame URL 为 http(s) 且剥 hash 后 ≠ 当前页面 URL（排除 srcdoc/about:blank——回落现有合并；排除自嵌套循环）
2. **可见**：iframe 元素 `getBoundingClientRect()` 宽、高均 ≥200px（排除隐藏工具 iframe，如翻译辅助/埋点）
3. **内容占优**：frame 正文长度（innerText 归一化，与主文档同一口径）≥500 且 ≥3× 主文档正文长度

补充规则：

- **不限同源**——跨域 frame 同样是候选（理由见 §2 跨域说明）
- 多候选取正文最长者
- 嵌套重定向（目标页自身又嵌占优 iframe）递归处理，**总深度上限 2 跳**防环

mmh1 对照：主 83 / frame 10736（比值 129×）、1280×2944 可见、http(s) 可导航——四条全过。

常量集中在 `lib/snapshot-redirect.mjs` 顶部：`MIN_FRAME_TEXT=500`、`TEXT_RATIO=3`、`MIN_BOX=200`、`MAX_HOPS=2`、`DEGENERATE_RATIO=0.5`。

## 5. 目录命名与指针

### 5.1 特殊目录名

```
redirected_<原名>
例：redirected_mmh1.top_article__ai-article_skill
```

- `<原名>` = 现有 `urlToDirName(url)` 的输出；`redirected_` 前缀表达「从某个页面重定向过来」
- 派生规则：对 `'redirected_' + 剥 scheme 后的 URL` 做现有同款净化（非 `[A-Za-z0-9.-]` → `_`），>120 截断 + `sha256('redirected_' + 原始 URL)` 前 8 位十六进制后缀——纯函数，从原 URL 可直接推出，站点更换嵌入目标时目录名稳定
- 新导出 `redirectedDirName(url)`（`lib/env.mjs`），与 `urlToDirName` 并列

### 5.2 指针文件（marker）

```
位置：working/redirected_<原名>/redirect_to.yaml
内容：to: <最终目标 URL>（一行；纯诊断用途）
```

- **定位不需要解析**：`urlDir(url)` 派生原名后，仅做一次 `existsSync(working/redirected_<原名>/redirect_to.yaml)`——存在即重定向，工作目录取 `redirected_<原名>`；不存在取原名目录（现状行为）
- `redirected_<原名>` 目录存在但无 marker = 陈旧残留，按普通页面处理
- 原有 `<原名>` 目录（历史普通运行的产物）保留不动，被 marker 覆盖时自然让位
- **写入时机 = 快照序列化成功之后**——中途任何失败（登录超时/虚拟列表/退化回退）都不写 marker，避免步骤 2-9 落到只有空壳的 redirected 目录
- **删除时机 = 步骤 1 检测未命中时**——若 marker 存在（站点改版回来）则删除 marker 文件本身；`redirected_<原名>` 目录及其陈旧产物留存无害
- 零全局状态：不同 URL 的重定向状态各自封闭在自己的目录子树里，无竞争、无索引膨胀

## 6. 契约变更

| 触点 | 变更 |
|------|------|
| `script/init.sh` | 删掉核心参数段（urlToDirName 派生、工作目录创建、三字段输出）；stdout 只剩 `{"status":"ok","node":...,"pm":...,"chromium":...}`；**`--url` 参数移除**（传入报 usage_error，退出码 2）；SKILL.md 步骤 0 命令改为 `bash <skill-root>/script/init.sh` |
| `script/snapshot.mjs` emit | ok 增四字段：`skill-root`、`url-name`（重定向时带 `redirected_` 前缀）、`url-working-path`、`redirect: {"to": 最终目标URL, "urlName": 目录名} \| null`。agent 对 `redirect` 字段无需分支——管线内部消化一切，步骤 2-9 调用方式零变化（照旧 `--url` 原始 URL） |
| 目录创建时机 | `ensureUrlDirs` 从「启动浏览器前」移到「重定向决策后」，用最终目录名创建；原目录名不再预建 |
| `script/lib/env.mjs` | 新增 `redirectedDirName(url)`、marker 存查/写入/删除助手；`urlDir()` 加 marker 查阅——步骤 1 写入与步骤 2-9 查阅共用同一事实源 |
| SKILL.md | 步骤 0 命令与输出表；步骤 1 输出表增四字段；步骤 3/7 提示中 `<url-working-path>` 的来源改为步骤 1 emit；工作目录规则补 `redirected_` 命名与 marker 机制 |
| CLAUDE.md / README.md | 同步：步骤 0 职责收窄、步骤 1 新字段、工作目录规则、`redirect_to.yaml` 说明 |

`skill-root` 说明：agent 调用 init.sh 本就需要 `<skill-root>`（SKILL.md 位置先验已知），步骤 1 emit 它仅是绝对路径规范化，随另两字段一并产出保持三参数成组。

## 7. 错误处理与回退

- **退化守卫**：goto 后 settle 完，目标页正文 < 检测时 frame 正文的 `DEGENERATE_RATIO`（50%）→ 判定独立打开退化（如嵌入页检测 `window.self === window.top` 后渲染空壳）→ 回原页面重载、走现状路径（合并回退），不写 marker，stderr 记录；只尝试一次不振荡
- **跨域登录墙**：goto 后登录检测复跑命中 → viewer 开在内容页，用户在正确 origin 登录，storageState 照常积累
- **marker 腐化防御**：定位只依赖 `existsSync`，不解析内容；内容坏行不影响任何行为
- **虚拟列表**：跑在最终目标页上；命中则 exit 1 不写快照、不写 marker
- **srcdoc/about:blank frame**：不是候选，现有 `page-prepare.js` 合并行为一字不改
- 登录/viewer/浏览器关闭时序不变：一律在最终 emit 之前关闭（契约既有约定）

## 8. 测试策略

### 8.1 单测

- `redirectedDirName(url)`：普通长度、>120 截断 + hash、与 `urlToDirName` 前缀关系
- `urlDir()` marker 间接：marker 存在 → redirected 目录；不存在 → 原名目录；`redirected_` 目录存在但无 marker → 原名目录（陈旧）；`U2M_WORKING_ROOT` 隔离下行为一致
- marker 写入/删除助手：写后可删、删除不存在文件不报错

### 8.2 集成（夹具服务器；同 host 双端口即天然跨域）

- **正向**：壳页 + 同源内容 iframe → 断言 `redirected_` 目录产出 `1_snapshot.html` 为内容页（无 iframe 元素）、emit 四字段齐、marker 存在且步骤 2（`clean_snapshot.mjs --url 原URL`）在 redirected 目录找到产物
- **跨域**：双端口夹具，内容 iframe 指向另一端口 → 重定向生效
- **反例三连**：主文档内容充足 + 小 iframe（不重定向，行为与现状一致）；srcdoc iframe（走现有合并路径，现状断言不变）；退化守卫（内容页顶层打开渲染空 → 回退原路径、无 marker）
- **init 更新**：三字段断言删除、不再创建工作目录、传 `--url` 报 usage_error(2)
- **回归**：现有全部测试保持绿——普通页面（无占优 iframe）全管线零行为变化

### 8.3 真实冒烟

`test/smoke/SMOKE.md` 增补 mmh1.top 两篇文章 URL（`#/ai-article/skill`、prompt-cache 篇），按记忆规约用最终代码重跑全管线后再记录结论。

## 9. 非目标（显式排除）

- 主文档与 frame **双方都实质充实**（正文比在 1×~3× 区间）的页面：不重定向（保主文档）、也不增强合并——维持现状，留待真实案例出现再迭代
- srcdoc/about:blank 无 URL frame 的合并保真增强（样式携带、内部滚动）——重定向路线下绝大多数内容 iframe 不再走合并，不值得投入
- 跨域 frame 的独立登录流程定制——复用现有七信号 + viewer，不在壳页上发明跨 origin 登录
- 重定向检测结果的跨步骤缓存失效协议——每次步骤 1 都重新检测并维护 marker，步骤 2-9 只读磁盘状态
- 已知理论边界：域名本身以 `redirected.` 开头的站点（如 `https://redirected.example.com/x`）其普通目录名恰为另一 URL 的重定向目录名——视为可忽略的病态碰撞，不做防让
