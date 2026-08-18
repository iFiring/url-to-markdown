# SKILL.md Baseline 测试记录（Task 14）

- 日期：2026-08-18；分支 feature/url-to-markdown；夹具 `http://127.0.0.1:50850/static-article.html`（本地夹具服务器）
- 原始运行记录：`.superpowers/sdd/2026-08-18-url-to-markdown/baseline-run{1,1b,2}-notes.md`（工作区，不入库）

## 运行概览

| 运行 | 条件 | 结果 |
|---|---|---|
| run 1（预跑） | SKILL.md 被隐藏但对象经 git status 找到 `.hidden` 备份并读取 | 完成全流程（方法论泄漏，等效"有手册预跑"） |
| run 1b（无手册基线） | 显式禁止读 SKILL.md / README 核心流程 / docs / .superpowers，仅凭脚本源码 | 完成任务，但需源码考古；暴露手册承载的关键知识缺失 |
| run 2（有手册复测） | 计划 Step 3 原文提示词，先读 SKILL.md 严格执行 | 通过全部 4 项判定标准；独立复现同一图片路径缺陷 |

## 无手册（run 1b）失败模式 / 知识缺口

1. **{{IMG_n}} 替换规则未知**：对象发现令牌残留在 result.md，靠自行推断才补上 `![...](node_workflow/assets/images/IMG_1.png)`——这正是手册步骤 4 明文规定的知识
2. **步骤 3/4 的 LLM 职责未知**：manifest pending 处理、语义去噪提示词均为手册内容，无手册时只能靠猜
3. **脚本契约靠源码考古**：stdout 单行 JSON / stderr 日志 / 退出码契约分散在各脚本首行注释与 contract.mjs，可发现但耗时
4. **render 路径基准坑**：`<url-dir>` 相对 workingRoot 解析而非 cwd，首跑报错后靠 error JSON 才定位

## 有手册（run 2）判定标准核验

1. 按顺序执行步骤 0→5，每步依据 stdout JSON 的 status 分支 → **通过**（0:ok→1:logged_in→2:双ok→3:无pending→4:提示词清洗+令牌替换→5:selected）
2. 产物落在 `working/<url-dir>/result.md` → **通过**
3. 步骤 3 正确处理 manifest（无 pending 正确跳过）；步骤 4 用指定提示词与 `{{IMG_n}}` 替换规则 → **通过**
4. warnings 不误判为失败 → **通过**（本次 warnings 为空，无误判行为）

## 两轮独立确认的缺陷（差距回写项）

| # | 缺陷 | 严重度 | 处置 |
|---|---|---|---|
| D1 | 最终 `result.md` 复制到 `<url-dir>/` 后，`assets/images/...` 相对引用断裂（该层级无 assets/） | 高（交付物可用性） | 脚本修复：`/select` 复制时改写 `](assets/` → `](<wf>/assets/`，补集成测试断言最终文件图片路径可解析 |
| D2 | 步骤 4 写 `<wf>/result.md` 与步骤 5 产物 `working/<url-dir>/result.md` 同名不同层，落位歧义 | 中 | SKILL.md 明确两层文件的位置关系 |
| D3 | 无人值守路径（`--no-open` + 首请求取消打开自检 + `POST /select`）未文档化——agent 驱动场景高频需要 | 中 | SKILL.md 增补说明 |
| D4 | `--port`/`--open-timeout`/`--no-open`/步骤 1 `--timeout` 默认值未在手册正文说明 | 低 | SKILL.md 随 D3 一并补注 |

## 其他观察（不阻断）

- Python 工作流（readability-lxml）在极短页面上残留 nav/footer 噪声——已知库间差异，双稿择优吸收（两轮均选 Node 稿或清洗后择优）
- Node 稿 h1 被 Readability 降为 ##（脚本只消费 a.content 丢弃 a.title）——去噪步骤可恢复；记为后续增强
- run 1 预跑还发现 video 源链接绝对化（Task 10 deferred 项）与 alt 文本在令牌替换时丢失——后者由步骤 4 人工回填，手册已隐含覆盖

## 结论

判定标准 4/4 通过；D1 为脚本级缺陷、D2-D4 为文档缺口，一并修复后 SKILL.md 达到交付标准。
