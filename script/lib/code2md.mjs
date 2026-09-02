// script/lib/code2md.mjs
// 步骤 2 代码块转换（表格占位符设计的 code 镜像）：接收浏览器侧
// __u2mCollectCode 的收集载荷，Node 层做七类 fail-closed 校验 + 层 2 行首
// 序号剥离 + 序列化 → 2_code.json 条目 + 失败诊断日志。
// fail-closed 原则（spec §6）：宁可失败走步骤 7 LLM 兜底，不可静默失真。
// 提取在浏览器侧完成（walkLines 需要 computed display），本模块不解析 HTML——
// 与表格 self/turndown 可插拔有意不同（YAGNI）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { expandLongText } from './table2md.js';
import { guessCodeLang } from './placeholder.mjs';

const STRIP_WS_RE = /\s+/g;
const UNRESOLVED_RE = /\{\{LONG_TEXT_\d/; // 非 global：.test 无 lastIndex 状态
const LONG_TEXT_TOKEN_RE = /\{\{LONG_TEXT_/; // 纪元豁免判定（spec §6.1 补注）
const GUTTERISH_RE = /^[\d\s.,;:)|·•\-–—]*$/;

const stripWs = (s) => String(s || '').replace(STRIP_WS_RE, '');

// 修剪首尾空行（内部空行保留——代码保真）
function trimBlankEnds(lines) {
  let a = 0, b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

function validateAndSerialize(c, longTextMap) {
  // 1. non_textual：围栏无法表达图示/嵌套表
  if (c.hasNonText) return { reason: 'non_textual' };
  // 2. content_loss：空白不敏感往返——提取文本与 DOM 文本（减槽）逐字符相等；
  //    <br> 在两侧均零贡献、块间空白被 stripWs 抹平，只捕获真丢文本
  if (stripWs(c.text) !== stripWs(c.textContentNoGutter)) return { reason: 'content_loss' };
  // 3. LONG_TEXT 预展开（\r 归一随行，切分前）
  const expanded = expandLongText(String(c.text || ''), longTextMap).replace(/\r\n?/g, '\n');
  if (UNRESOLVED_RE.test(expanded)) return { reason: 'unresolved_long_text' };
  // 4. 层 2 序号剥离（Task 2 注入；本任务先返回原样）
  const stripped = stripLeadingNumbers(expanded.split('\n'));
  // 5. empty：修剪首尾空行后为空/纯空白
  const trimmed = trimBlankEnds(stripped.lines);
  if (trimmed.join('').trim() === '') return { reason: 'empty' };
  // 6. 渲染交叉校验。LONG_TEXT 纪元豁免（spec §6.1 补注）：收集时 renderedLines
  //    量的是占位符形态（单行）、校验对象是展开后行数——纪元不可比；展开引入的
  //    换行逐字来自原始文本节点、非提取器发明。与 renderedLines=null 同款跳过。
  const hasLongText = LONG_TEXT_TOKEN_RE.test(String(c.text || ''));
  if (!hasLongText && c.renderedLines != null) {
    const interiorBlanks = trimmed.slice(1, -1).filter((l) => l.trim() === '').length;
    if (trimmed.length === 1 && c.renderedLines > 1) return { reason: 'single_line_suspect' };
    if (trimmed.length - interiorBlanks > c.renderedLines) return { reason: 'rendered_mismatch' };
  }
  // 7. mixed_signal：\n 与块容器双信号并存但行数矛盾（±1 容差吸收尾随 \n）。
  //    按 textContentNoGutter（占位符形态）计 \n——两信号同纪元可比
  const newlineCount = (String(c.textContentNoGutter || '').match(/\n/g) || []).length;
  if (newlineCount > 0 && c.blockContainers > 0 &&
      Math.abs(newlineCount + 1 - c.blockContainers) > 1) {
    return { reason: 'mixed_signal_mismatch' };
  }
  const content = trimmed.join('\n');
  return {
    content,
    lines: trimmed.length,
    lang: c.lang || guessCodeLang(content) || '',
    numberStripped: stripped.stripped,
  };
}

export async function convertCodes(codeList, { longTextMap = {}, logsDir } = {}) {
  const codes = {};
  let ok = 0, failed = 0;
  for (const c of codeList) {
    const r = validateAndSerialize(c, longTextMap);
    const isOk = !r.reason;
    if (isOk) ok++; else failed++;
    codes[String(c.k)] = {
      dataIdx: c.dataIdx,
      lang: isOk ? r.lang : (c.lang || ''),
      content: isOk ? r.content : null,
      status: isOk ? 'ok' : 'failed',
      ...(isOk ? {} : { reason: r.reason }),
      lines: isOk ? r.lines : c.lines,
      gutterStripped: !!c.gutterStripped,
      ...(isOk && r.numberStripped ? { numberStripped: true } : {}),
    };
    if (!isOk && logsDir) {
      const snippet = (c.outerHTML || '').length > 2000
        ? (c.outerHTML.slice(0, 2000) + '\n…[truncated]') : (c.outerHTML || '');
      const logText = `dataIdx: ${c.dataIdx}\nk: ${c.k}\nlines: ${c.lines}` +
        `\nrenderedLines: ${c.renderedLines}\nblockContainers: ${c.blockContainers}` +
        `\nreason: ${r.reason}\n\n--- outerHTML ---\n${snippet}\n`;
      await fs.mkdir(logsDir, { recursive: true });
      await fs.writeFile(path.join(logsDir, `${c.k}_${c.dataIdx}.log`), logText, 'utf8');
    }
  }
  return { codes, counts: { total: codeList.length, ok, failed } };
}

// 层 2：行首算术序号剥离（spec §6.2）——保守条件全满足才剥，防误剥 yaml
// 数字键等真实代码：≥3 个非空行全部带行首整数 token、构成公差 1 连续序列
// （起始任意——OpenAI 摘录槽有从 26 起形态）、剥后内容非退化。
// 剥离量 = 行首水平空白 + 数字 + 水平空白串 + 至多一个分隔符 + 尾随水平空白
// （不吞更深缩进）。长数字（>3 位）不是序号：lookahead 要求数字后是
// 分隔符/空白/行尾。覆盖 '1 x' / '1. x' / '1: x' / '1 | x' / '26 "x"' 形态。
const LEADING_NUM_RE = /^[ \t]*(\d{1,3})(?=[ \t.:;)|·•\-–—]|$)/;
const NUM_PREFIX_RE = /^[ \t]*\d{1,3}[ \t]*(?:[.:;)|·•\-–—][ \t]*)?/;

export function stripLeadingNumbers(lines) {
  const idxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') idxs.push(i);
  }
  if (idxs.length < 3) return { lines, stripped: false };
  const firsts = idxs.map((i) => {
    const m = LEADING_NUM_RE.exec(lines[i]);
    return m ? Number(m[1]) : null;
  });
  if (firsts.some((n) => n === null)) return { lines, stripped: false };
  for (let j = 1; j < firsts.length; j++) {
    if (firsts[j] !== firsts[0] + j) return { lines, stripped: false };
  }
  const out = lines.slice();
  for (const i of idxs) out[i] = out[i].replace(NUM_PREFIX_RE, '');
  if (out.every((l) => GUTTERISH_RE.test(l))) return { lines, stripped: false };
  return { lines: out, stripped: true };
}
