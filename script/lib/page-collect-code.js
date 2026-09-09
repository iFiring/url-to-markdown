// script/lib/page-collect-code.js
// styled 趟收集 pass：在长文本折叠后、任何折叠前，按文档序收集每个 <pre>
// {k, dataIdx, lang, text, lines, renderedLines, hasNonText, textContentNoGutter,
//  blockContainers, gutterStripped, outerHTML}。跳过 [hidden] pre（K5 独占，
// 与 __u2mCollectTables 同款判定——hidden 在 pre 自身；祖先隐藏块照常收集，
// renderedLines=null 走纪元豁免）。walkLines：文本节点 \n 切分 + <br> 断行 +
// 非行内元素边界软断行（行已空不重复断）。空白守卫结构化（2026-09-03）：
// 仅块间隙纯空白（两侧紧邻块级/容器边缘、非行内独子）零贡献——CSS 块盒间
// 空白不渲染；行内流空白按 pre 语义保留（缩进 token/行尾 \n/空行）。
// 槽排除（层 1）：userSelect:none 且子树纯数字
// +分隔符文本 → 整棵跳过。双条件缺一不可：只有 user-select 会误杀复制保护
// 整块；只有数字条件会误杀纯数字代码行。computed display 在 display:none
// 祖先下仍返回计算值——隐藏子树（折叠展开器内）也能提取，innerText 做不到
// （退化为 textContent）。
// 槽壳传播（2026-09-03，OpenAI 实测）：行号槽壳自身 us:auto、us:none 只设在
// 数字 span 上（class 级 CSS）——全部子元素皆槽且自身无槽外文本的壳也整棵
// 视为槽。否则壳计入 blockContainers（文本侧剔槽、容器侧计槽）会让
// mixed_signal 双信号矛盾误杀；walkLines 还会对零内容壳触发幻影空行。
// ≥1 子命中防空传播：空行容器（textContent 空串过 RE 但零子命中）不算槽。
function __u2mCollectCode() {
  var INLINE_DISPLAY_RE = /^(inline|contents|ruby)/;
  var GUTTER_TEXT_RE = /^[\d\s.,;:)|·•\-–—]*$/;

  function isGutter(el) {
    if (!GUTTER_TEXT_RE.test(el.textContent || '')) return false;
    if (getComputedStyle(el).userSelect === 'none') return true;
    // 容器传播：余子皆槽元素或纯空白文本节点，且至少一个子命中
    var saw = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if (c.textContent.trim() !== '') return false;
      } else if (c.nodeType === 1) {
        if (!isGutter(c)) return false;
        saw = true;
      }
    }
    return saw;
  }
  function isInline(el) {
    return INLINE_DISPLAY_RE.test(getComputedStyle(el).display);
  }

  function walkLines(root) {
    var lines = [''];
    var gutter = false;
    var contentCount = 0; // 内容事件计数（文本追加/强制断行）——空容器判别用
    function brk(force) {
      if (force || lines[lines.length - 1] !== '') {
        lines.push('');
        if (force) contentCount++;
      }
    }
    // 块间隙侧：块级元素 / 容器边缘 / 纯空白文本（间隙延伸）。
    // BR 视作行内断行不算间隙侧——其旁空白按 pre 语义保留
    function gapSide(s) {
      if (!s) return true;
      if (s.nodeType === 3) return s.textContent.trim() === '';
      if (s.nodeType === 1) return s.tagName !== 'BR' && !isInline(s);
      return true; // 注释等它类节点
    }
    function visit(n, parentInline) {
      if (n.nodeType === 3) {
        var t = n.textContent;
        // 块间隙纯空白（2026-09-03 结构化修订）：两侧皆块间隙侧、且不是
        // 行内元素的独子 → 零贡献零断行（CSS 块盒间空白不渲染——防幻影
        // 空行）。行内流中的空白是 pre 语义内容——行首缩进 token、行尾
        // \n、空行——必须保留；旧「纯空白 + 当前行空」内容条件在每次断行
        // 后必命中，吞掉缩进与空行（OpenAI pre 2874/3127 实测）
        if (t.trim() === '' && gapSide(n.previousSibling) && gapSide(n.nextSibling) &&
            !(parentInline && !n.previousSibling && !n.nextSibling)) return;
        var parts = t.split('\n');
        for (var i = 0; i < parts.length; i++) {
          if (i > 0) brk(true);
          if (parts[i] !== '') contentCount++;
          lines[lines.length - 1] += parts[i];
        }
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') { brk(true); return; }
      if (isGutter(n)) { gutter = true; return; }
      var inline = isInline(n);
      if (!inline) {
        brk(false);
        var mark = contentCount;
        for (var c = n.firstChild; c; c = c.nextSibling) visit(c, false);
        // 空行容器（内部零内容事件）= 一行真实空行——强制断一行保真；
        // 计数随 brk(true) 传播，嵌套空容器各自占一行
        if (contentCount === mark) brk(true);
        else brk(false);
      } else {
        for (var ci = n.firstChild; ci; ci = ci.nextSibling) visit(ci, true);
      }
    }
    visit(root, false);
    // 弹掉尾随空行（末块退出的 pending 断行——CSS 无尾随空行盒，Node 层
    // 反正修剪；内部空行保留——代码保真）
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return { lines: lines, gutter: gutter };
  }

  var pres = document.querySelectorAll('pre');
  var out = [];
  var k = 0;
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden') || pre.__u2mChromeFold || pre.__u2mInChromeFold) continue; // K5/K5x 独占（同源 skip）
    k++;
    var code = pre.querySelector('code') || pre;

    var w = walkLines(code);

    // lang 链：code[data-language] → pre[data-language] → language-* class → ''
    var lang = code.getAttribute('data-language') || pre.getAttribute('data-language') || '';
    if (!lang) {
      var cls = (code.getAttribute('class') || '') + ' ' + (pre.getAttribute('class') || '');
      var lm = /(?:^|\s)language-([A-Za-z0-9._+-]+)/.exec(cls);
      if (lm) lang = lm[1];
    }

    // textContentNoGutter：pre 子树文本减槽元素（content_loss 比较基准）
    var tc = '';
    (function acc(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) tc += c.textContent;
        else if (c.nodeType === 1 && !isGutter(c)) acc(c);
      }
    })(pre);

    // renderedLines：distinct rect top 按 lineHeight 分桶（token 微高差去重）。
    // rects 为空（隐藏祖先 / 无布局 / jsdom 无 Range.getClientRects）→ null——
    // 交叉校验跳过、只信结构信号
    var rendered = null;
    if (typeof document.createRange === 'function') {
      var range = document.createRange();
      if (typeof range.getClientRects === 'function') {
        range.selectNodeContents(code);
        var rects = range.getClientRects();
        if (rects.length > 0) {
      var lh = parseFloat(getComputedStyle(pre).lineHeight);
      var tops = {};
      for (var r = 0; r < rects.length; r++) {
        var bucket = lh ? Math.round(rects[r].top / lh) : Math.round(rects[r].top);
        tops[bucket] = 1;
      }
      rendered = Object.keys(tops).length;
        }
      }
    }

    // blockContainers：code 壳直接子元素中非行内且非 <br> 的个数（行容器计数；
    // 槽整棵排除——display:block 的槽壳计入会让 mixed_signal 的文本/容器两侧
    // 对槽不对称，OpenAI 实测形态由此误杀）
    var blocks = 0;
    for (var ci = code.firstChild; ci; ci = ci.nextSibling) {
      if (ci.nodeType === 1 && ci.tagName !== 'BR' && !isInline(ci) && !isGutter(ci)) blocks++;
    }

    var hasNonText = !!pre.querySelector(
      'img,svg,math,iframe,canvas,object,embed,video,audio,table');

    out.push({
      k: k,
      dataIdx: pre.getAttribute('data-idx') || '',
      lang: lang,
      text: w.lines.join('\n'),
      lines: w.lines.length,
      renderedLines: rendered,
      hasNonText: hasNonText,
      textContentNoGutter: tc,
      blockContainers: blocks,
      gutterStripped: w.gutter,
      outerHTML: pre.outerHTML,
    });
  }
  return out;
}
