# url to markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

操作手册（步骤 0-5 决策表、错误处理）见 [SKILL.md](SKILL.md)；面向 Claude Code 的开发约定、架构与技术细节见 [CLAUDE.md](CLAUDE.md)（唯一事实源）。

## 为什么要做这个

传统的脚本(`markitdown / turndown / markdownify`)都存在以下弊病：

- 无法准确识别标题级别（`h1-h5`），或者按钮小标题
- 无法识别到隐藏的章节和段落
- 无法正确识别并转换复杂 UI 模块：流程图、交互控件
- 无法识别通过 Javascript 渲染的单页应用（SPA）
- 无法转换嵌入在 iframe 或其他特殊元素中的特殊页面
- 无法打开有「验证码」或「登录墙」的页面

## 本 SKILL 能做什么

- 准确识别大小标题，章节和段落
- 能够识别隐藏/收起的内容
- 对无法用脚本转换的表格和代码块，支持 LLM 语义识别和转换
- 准确识别复杂 UI 模块，并将其转换成图片；支持滚动内容的截图
- 支持打开浏览器窗口，实现人工「扫码」/「输入账号密码」/「跳过验证码」等功能，并支持缓存登录态（Cookie）
- 支持自动跳转到内嵌 iframe 的页面

## 本 SKILL 还不能做什么

- 飞书/钉钉这类使用虚拟列表（Virtual-List）的文档

## 设计思想

- 所有 HTML 文章/文档本质上都是「标题 + N 个段落」的长列表，将物理分割和 LLM 语义处理相结合
- 在大模型语义识别步骤之前，将 DOM 的输入压缩到极致：将网页从 1.6MB 压缩到 30KB，压缩率达到了 98% 以上；同时输出尽可能小：大模型仅输出结构化 JSON
- 先用脚本清洗噪音（标签属性、非语义类名、长文本、大型表格、大段代码），再交给 LLM 处理语义化内容
- 长文本、表格和代码块用短字符占位，在 LLM 处理完之后再恢复——节省输入 Token，也不会因网页内容产生幻觉
- 对于格式化的 `table` 表格和 `pre>code` 代码块，直接用脚本转换，降低大模型识别转换的成本；转换失败会用大模型兜底
- 对于大型 Div 复杂模块，通过「截图边界链」的设计，支持对滑动模块的截图功能

## 技术栈

- **Playwright**（chromium）——无头抓取、CDP Screencast 登录中继、元素 2x 截图
- **juice**——CSS 级联引擎，把 `<style>` 规则内联进元素 style 属性
- **ws**——Screencast viewer 的 WebSocket 中继
- 语义分派（步骤 2 关键 ID 识别 / 步骤 4 markdown 骨架）由 LLM agent 按 SKILL.md 手册完成，不依赖 readability / turndown 类转换库

## 环境要求

- Node ≥ 20（`init.sh` 可经 nvm 自动安装正确版本）
- Linux / macOS
- 包管理器优先级 pnpm > yarn > npm（降级使用，不自行安装）
- Playwright chromium（`init.sh` 检测并安装）

## 项目结构

```text
SKILL.md                 # Skill 主体文件（步骤 0-5 操作手册）
CLAUDE.md                # 面向 Claude Code 的开发约定（技术细节唯一事实源）
README.md                # 项目概览（英文版）
README.zh-CN.md          # 项目概览（中文版）
script/                  # CLI 脚本
  lib/                   # 共享模块（contract / env / browser…）与页面脚本 page-*.js
test/                    # 单元 / 集成测试 + fixtures + smoke 冒烟清单
package.json
pnpm-lock.yaml

working/                 # 运行时工作目录（gitignore，仅保留骨架）
  cookies/               # 所有访问过 URL 的登录态公共存储
  <url-path>/            # 该 URL 步骤 1-5 的全部产物（最终产物 5_markdown.md）
  redirected_<url-path>/ # iframe 重定向页的专属目录（内含 redirect_to.yaml 标记）
```

## 核心流程（步骤 0-5）

步骤 0、1、3、5 只运行脚本并按 stdout 的 `status` 分支；步骤 2、4 由 agent（LLM）做语义处理。

| 步骤 | 执行者 | 命令 | 产物 |
|---|---|---|---|
| 0 环境初始化 | 脚本 | `bash script/init.sh` | 环境就绪（node/pnpm/chromium/字体；纯环境自检，无参数） |
| 1 快照下载 + 结构清洗 | 脚本 | `node script/snapshot.mjs --url <url>` | `1_snapshot.html` + 清洗产物 `1_clean_snapshot.html`、`1_clean_style_snapshot.html`、`1_long_text.json`、`1_tables.json`、`1_code.json`；输出核心参数 `skill-root`/`url-name`/`url-working-path`（重定向页为 `redirected_` 特殊名）+ `redirect` 通报 |
| 2 关键 ID 识别 | **agent** | 读 `1_clean_snapshot.html` | `2_key_ids.json` |
| 3 文章视图渲染 | 脚本 | `node script/render_article.mjs --url <url>` | `3_article.html`（>60KB 时另产出分块 `3_article_chunk_X_of_N.html`，emit `chunks` 驱动步骤 4 派发模式） |
| 4 markdown 骨架 | **agent** | 读 `3_article.html`（分割时按 `chunks.files` 并行派发子代理、各写 `4_skeleton_chunk_X_of_N.json`） | `4_skeleton.json` / `4_skeleton_chunk_X_of_N.json` |
| 5 还原 + 下载 + 截图 + 渲染 | 脚本 | `node script/render_markdown.mjs --url <url>` | `5_markdown.md`（最终产物）、`assets/images/`、`assets/trans/`（入口自动检测并合并分片骨架） |

各步骤的 `status` 分支决策表、骨架词汇表与约束见 SKILL.md；各脚本的技术细节见 CLAUDE.md 与对应脚本头部注释。
