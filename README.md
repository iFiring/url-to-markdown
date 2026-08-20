# url to markdown

打开 URL 网页，将主体内容转换成干净的 Markdown 文件。

## Meta Data
---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

## 环境要求

- Node >= 20
- Linux / MacOS

## 技术栈

- `Playwright`
- `@mozilla/readability`
- `turndown` + `@joplin/turndown-plugin-gfm`

## 项目结构

```text
working/                 # 工作目录
  cookies/               # 所有访问过 URL 的 cookie 公共存储目录
  [_U_R_L_]/             # 将特殊字符替换成下划线的 URL
    assets/
      draft/             # 复杂元素草稿（内联样式 HTML）
      complex/           # 特殊元素最终产物（SVG/PNG）
      images/            # 下载的正文图片
    sketch.md            # 经过脚本 `clear_trans_html` 初步清洗和转换的 Markdown 文件
    result.md            # 经过 LLM 优化过的 Markdown 文件（最终交付物）

SKILL.md                 # Skill 主体文件
script/                  # 脚本
test/                    # 单元测试
README.md                # 项目说明
package.json
pnpm-lock.yaml
```

### Skill 文件夹结构

```text
url-to-markdown/
  SKILL.md
  script/
  working/
  README.md
  package.json
  pnpm-lock.yaml
```

## 核心流程

- 步骤 [0,1,2,5] 你只需运行脚本和确认结果；步骤 [3,4] 需要你对数据和文本去做语义处理

### 0.运行脚本 `init.sh`，初始化环境

- 先检测环境，在环境初始化完成后，通过了则继续下一步
- 如果环境不支持或者中途报错（非警告，会阻断）了，退出当前 SKill 所有流程，结束并把原因反馈给用户

### 1.打开 URL，判断是否需要进入登录流程，抓取全保真快照

用 Node 脚本 `snapshot.mjs` 打开 URL，它会自动完成四个阶段：登录检测（如需登录则弹出 viewer 供人工操作）、渐进滚动（触发懒加载）、虚拟列表检测（仅渲染可见窗口的页面无法全文转化）、全保真快照抓取（内联 CSS、剥尽 JS、标记 `data-u2m-id`）。产物为 `steps/1_snapshot.html`。

- 每次登录后的 Cookie（set-cookie）需要存储下来，在每次打开 URL 上都要带上

### 2.打开 URL，清理 HTML，转化成 Markdown

用脚本 `clear_trans_html.mjs` 打开页面，清理 DOM 元素，转化成 Markdown。

#### 清理

- 清洗无效 DOM 元素，包括 `<nav>`, `<footer>`, `<aside>`, 侧边栏和广告位。
- 保留主体页面内容；保留 CSS

#### 转化

- 将复杂的页面元素，在 Markdown 中打上特殊标记
- 将文本内容，转化成 Markdown

### 3.你负责转换特殊 DOM 元素

特殊的 DOM 元素，你负责转化成 SVG，替换 Markdown 中的标记

- 从目录 `working/[_U_R_L_]/assets/draft/` 获取所有待转换元素（HTML）
- 非文本的 DOM 元素，转换成 SVG

### 4.你负责对 Markdown 语义去噪

审阅 Markdown 初稿，你负责检查质量并优化内容

- 提示词: "你是一个网页内容清洗专家。以下是网页转换的 Markdown 初稿。请去除其中的广告、推荐阅读、版权声明等无关内容，只保留核心正文。同时，请检查并修复其中的 Markdown 表格格式，确保其符合标准。去除多余的换行，空格。直接输出清洗后的 Markdown。**注意**：不要添加/修改/删除主体文本内容和原义。"

### 5.人工选择 Markdown 文件

用脚本 `render_markdown.mjs` 渲染生成的 Markdown 文件，人工确认后作为最终交付物。

- 使用本地的 Markdown 渲染
- 给用户选择和提交按钮，脚本返回用户选择的结果并退出

## 脚本列表

- 每次打开 URL 必须将 `Cookies/LocalStorage` 注入到 `Playwright` 上下文
- Playwright 脚本中不允许播放视频和音频文件
- 可能有延迟，无头模式下用 `wait_until=networkidle`，或者等待 5S 再开始

### `init.sh`

环境初始化：判断环境和依赖安装，正常则成功退出，异常则报错退出。

- 判断 Node 的正确版本，是否安装了依赖和 chromium，没问题则成功退出；没有 Node，报错退出
- Node 版本不对，尝试使用 nvm 安装正确版本；无法安装则报错退出
- Node 包管理器使用优先级 "pnpm > yarn > npm"；降级使用，不要自行安装
- 配置 `pnpm.onlyBuiltDependencies` 允许 pnpm 安装 `chromium`
- 初始化 chromium：配置 `pnpm.onlyBuiltDependencies` 允许 pnpm 自动安装 `chromium`；不存在则手动执行 `npx playwright install chromium`，已存在则不需要执行

### `snapshot.mjs`

步骤 1 的统一入口，合并四个阶段为单个 CLI：

1. **登录检测**（`lib/snapshot-login.mjs`）：打开 URL，六信号判断登录态（正文内容不超过 500 字、URL 特征匹配、输入框+密码框检测、页面"登录"元素检测、cookie/token 检测、重定向检测），满足 2 个条件即判定需登录。未登录时弹出 CDP Screencast viewer 供人工操作。登录完成后存储 Cookies/LocalStorage。
2. **渐进滚动**（`lib/snapshot-scroll.mjs`）：滚动到底部再回顶，触发懒加载，等待 DOM 稳定。
3. **虚拟列表检测**（`lib/snapshot-detect.mjs`）：检查是否为虚拟列表（仅渲染可见窗口的页面），命中则终止。
4. **全保真快照**（`lib/snapshot-capture.mjs`）：注入页面脚本，合并同源 iframe、内联外部 CSS、剥尽 JS、注入 `<base>`、打 `data-u2m-id`，序列化 `steps/1_snapshot.html`。

#### 参考

- 登录状态判断：`.temp/login.mjs`
- 登录状态判断：`.temp/is_login_page.py`

### `clear_trans_html.mjs`

加载快照与 `classify_plan.json`，清理 DOM 元素，转化成 Markdown。

- 如果是内嵌了 iframe 页面，则打开 iframe 页面
- 懒加载/虚拟 DOM 处理：由 `snapshot.mjs` 在抓取阶段完成（渐进滚动 + DOM 稳定）
- 在清理和转化前有个前提，必须获取到全部正文内容，不能被懒加载或虚拟 DOM 隐藏

#### 清理

- 清理库，Node 使用 `@mozilla/readability`
- 清理视频和音频元素；清理按钮元素

#### 转换

- 转换库，Node 使用 `turndown` + `@joplin/turndown-plugin-gfm`
- 纯图片：下载正文所有 `<img>` 标签的图片，存储在工作目录 `working/[_U_R_L_]/assets/images/IMG_1`，在 Markdown 中引用占位符 `{{IMG_1}}`
- 复杂非纯文本 `<div>`：先给 DOM 元素截图，截取 DOM 元素（HTML + 有效 CSS 内联样式），存储在工作目录 `working/[_U_R_L_]/assets/draft/COMPLEX_DIV_1`，在 Markdown 中引用占位符 `{{COMPLEX_DIV_1,2,3}}`；
- 在处理特殊元素后，再使用转换库转换文档

### `render_markdown.mjs`

在浏览器窗口渲染 Markdown，由用户确认，提交后返回 Markdown 路径

#### 参考

- 打开临时网页给用户选择：`.temp/wait-click.mjs`

# 开发进度

按阶段实施，在此处更新开发进度。

| 阶段 | 内容 | 进度（未完成/已完成） |
|------|---------|------|
| 项目结构 | 项目总体结构，包括文件夹，package 文件等等 | 已完成 |
| 初始化脚本 `init.sh` | 环境检测与依赖安装 | 已完成 |
| 快照脚本 `snapshot.mjs` | 登录检测 + 滚动 + 虚拟列表检测 + 全保真快照 | 已完成 |
| clear_trans_html | Node 清洗转换 HTML → Markdown | 已完成 |
| `render_markdown.mjs` | 浏览器渲染，人工确认最终 Markdown | 已完成 |
| SKILL.md | 操作手册（步骤 0-5、status 分支决策表、错误处理） | 已完成 |
| 真实 URL 冒烟 | 手动清单见 test/smoke/SMOKE.md | 场景 1 已完成（MDN 文章页端到端通过）；场景 2（登录墙）/3（特殊元素）待人工 |
| 移除 Python 运行时 | 双稿择优退役，收敛 Node 单运行时 | 已完成 |
| LLM 驱动分类与快照管线 | capture_snapshot + classify_plan + applyClassifyPlan | 已完成 |
