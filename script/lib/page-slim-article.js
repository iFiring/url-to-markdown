/**
 * 步骤 6 页面内瘦身函数。在浏览器 evaluate 中执行，签名
 * __u2mSlimArticle(protectedIds)——在 __u2mExtractArticle 迁移与噪音
 * 剔除之后、序列化之前对文章视图执行六条结构规则（spec：
 * docs/superpowers/specs/2026-08-29-step6-article-slimming-design.md §5，
 * 固定执行顺序——前面的规则改变后面规则看到的输入）：
 *  ① data-* 清理：保留 {data-u2m-id, data-language}（后者是步骤 7 判
 *     代码语言的机械信号），其余 data-*（组件库脚手架/交互状态）全删。
 *     白名单而非黑名单——陌上站点的 data-* 安全默认删除
 *  ② MathML→LaTeX：annotation 有 LaTeX 源才替换（KaTeX 双胞胎结构整体
 *     替换消灭 katex-html 重复；结构不匹配只换 <math>；无源保留原树）
 *  ③ 无文本/纯符号 button 与无文本 svg 删除（/[\p{L}\p{N}]/u 不命中
 *     的纯符号交互件如 ⋮/✕ 同删；含字母数字者走 ④）
 *  ④ 有文本 button 降级（解包上提子节点，包装铬的 style 弃置）
 *  ⑤ 非白名单协议 href 剥除（scheme ∉ http/https/mailto/tel 的 <a>
 *     解包——参考页 codex:// 营销链接单个 ~1KB prompt 曾漏进 9_markdown）
 *  ⑥ 空壳 span 拆包（属性只剩 data-u2m-id，迭代到不动点——pre 内语法
 *     高亮 token span 的样式已被步骤 5 清空，结构在、信息不在）
 * 保护集 protectedIds = titleIds ∪ descriptionIds ∪ standaloneIds
 * （listFlowIds 不入——容器本身不迁移）：删除/解包类（③④⑤⑥）跳过
 * 保护元素本身、其后代照常瘦身；保真替换类（②）不受约束——替换保留
 * 内容只换形态。id 随元素消失只影响 6/7 血统：步骤 8 用 1_snapshot/
 * live 的 id 对位，零影响。
 */
function __u2mSlimArticle(protectedIds) {
  var stats = {
    attrsDropped: 0, mathReplaced: 0, buttonsRemoved: 0,
    buttonsUnwrapped: 0, svgsRemoved: 0, linksStripped: 0, spansUnwrapped: 0
  };
  var protectedSet = {};
  for (var i = 0; i < (protectedIds || []).length; i++) protectedSet[protectedIds[i]] = true;
  function isProtected(el) {
    var id = el.getAttribute && el.getAttribute('data-u2m-id');
    return !!(id && protectedSet[id]);
  }
  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  // ① data-* 清理：白名单之外的 data-* 全删
  var KEEP_DATA = { 'data-u2m-id': 1, 'data-language': 1 };
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    for (var j = el.attributes.length - 1; j >= 0; j--) {
      var name = el.attributes[j].name;
      if (name.indexOf('data-') === 0 && !KEEP_DATA[name]) {
        el.removeAttribute(name);
        stats.attrsDropped++;
      }
    }
  }

  // ② MathML→LaTeX：annotation 有 LaTeX 源才替换（__u2mLatexText 来自
  // page-latex.js，由 extract_article.mjs 组合注入同一作用域；独立
  // evaluate 时优雅降级跳过）。KaTeX 双胞胎结构识别：父 span 仅含 math
  // 一个元素子（空白文本子忽略）且祖父恰两元素子、另一为 span →
  // 祖父整体替换（katex-html 孪生一并消灭）；结构不匹配只换 <math>，
  // 孪生残留由规则⑥解体为文本（同今日现状，LLM 能正确择一）。
  // 不受保护集约束——保真替换保留内容只换形态
  function elementChildren(el) {
    var out = [];
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
    return out;
  }
  var maths = document.querySelectorAll('math');
  for (var i = 0; i < maths.length; i++) {
    var el = maths[i];
    if (!el.parentNode) continue;
    var latex = typeof __u2mLatexText === 'function' ? __u2mLatexText(el) : null;
    if (!latex) continue;
    var target = el;
    var p = el.parentElement;
    var g = p ? p.parentElement : null;
    if (p && g && p.tagName === 'SPAN' && g.tagName === 'SPAN') {
      var pKids = elementChildren(p);
      var gKids = elementChildren(g);
      var twin = null;
      for (var k = 0; k < gKids.length; k++) if (gKids[k] !== p) twin = gKids[k];
      if (pKids.length === 1 && pKids[0] === el && gKids.length === 2 &&
          twin && twin.tagName === 'SPAN') {
        target = g;
      }
    }
    target.parentNode.replaceChild(document.createTextNode('$' + latex + '$'), target);
    stats.mathReplaced++;
  }

  // ③ 无文本/纯符号 button 与无文本 svg 删除：textContent 无非空白文本、
  // 或无任何字母数字（/[\p{L}\p{N}]/u 不命中——⋮/✕/× 等纯符号交互件，
  // 参考页 7 个 ⋮ 溢出菜单实测即此类；中文与 GPT-5.6+ 等含字母数字者
  // 走 ④）。svg 的 <text> 后代算文本——带文字的图标保留
  function hasWordText(el) {
    var t = (el.textContent || '').trim();
    return t.length > 0 && (/\p{L}|\p{N}/u).test(t);
  }
  var interactive = document.querySelectorAll('button, svg');
  for (var i = 0; i < interactive.length; i++) {
    var el = interactive[i];
    if (!el.isConnected || isProtected(el) || hasWordText(el)) continue;
    if (el.parentNode) el.parentNode.removeChild(el);
    if (el.tagName === 'BUTTON') stats.buttonsRemoved++;
    else stats.svgsRemoved++;
  }

  // ④ 有文本 button 降级：解包上提子节点——按钮自身 style 弃置（包装铬
  // 是装饰），内部文本/span 的样式保留；tab/手风琴标题的文本有信息量
  var buttons = document.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    var el = buttons[i];
    if (!el.isConnected || isProtected(el)) continue;
    unwrap(el);
    stats.buttonsUnwrapped++;
  }

  // ⑤ 非白名单协议 href 剥除：scheme ∉ {http,https,mailto,tel} 的 <a>
  // 解包。mailto/tel 短且 markdown 合法，保留；无 scheme（相对/#锚点）
  // 不匹配正则、保留
  var SCHEME_KEEP = /^(https?|mailto|tel)$/i;
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var el = links[i];
    if (!el.isConnected || isProtected(el)) continue;
    var href = el.getAttribute('href');
    var m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(href);
    if (m && !SCHEME_KEEP.test(m[1])) {
      unwrap(el);
      stats.linksStripped++;
    }
  }

  // ⑥ 空壳 span 拆包：属性只剩 data-u2m-id 的 span 解包。span 限定——
  // div 等块级可能承载 trans2img 模块边界，不碰。嵌套 token span 需
  // 迭代到不动点，防御性上限 10 轮（一轮内 parent 先解包、hoisted 的
  // 子 span 仍在静态列表内同轮处理，通常一轮收敛）
  for (var round = 0; round < 10; round++) {
    var spans = document.querySelectorAll('body span');
    var changed = false;
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      if (!el.isConnected || isProtected(el)) continue;
      var bare = true;
      for (var j = 0; j < el.attributes.length; j++) {
        if (el.attributes[j].name !== 'data-u2m-id') { bare = false; break; }
      }
      if (!bare) continue;
      unwrap(el);
      stats.spansUnwrapped++;
      changed = true;
    }
    if (!changed) break;
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    attrsDropped: stats.attrsDropped,
    mathReplaced: stats.mathReplaced,
    buttonsRemoved: stats.buttonsRemoved,
    buttonsUnwrapped: stats.buttonsUnwrapped,
    svgsRemoved: stats.svgsRemoved,
    linksStripped: stats.linksStripped,
    spansUnwrapped: stats.spansUnwrapped
  };
}
