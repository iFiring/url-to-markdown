// script/lib/page-collect-code.js
// styled 趟收集 pass：在长文本折叠后、任何折叠前，按文档序收集每个 <pre>
// {k, dataIdx, lang, text, lines, renderedLines, hasNonText, textContentNoGutter,
//  blockContainers, gutterStripped, outerHTML}。跳过 [hidden] pre（K5 独占，
// 与 __u2mCollectTables 同款判定——hidden 在 pre 自身；祖先隐藏块照常收集，
// renderedLines=null 走纪元豁免）。walkLines：文本节点 \n 切分 + <br> 断行 +
// 非行内元素边界软断行（行已空不重复断——块间纯空白文本节点天然吞掉，与 CSS
// 渲染语义一致；内部空行保留）。槽排除（层 1）：userSelect:none 且子树纯数字
// +分隔符文本 → 整棵跳过。双条件缺一不可：只有 user-select 会误杀复制保护
// 整块；只有数字条件会误杀纯数字代码行。computed display 在 display:none
// 祖先下仍返回计算值——隐藏子树（折叠展开器内）也能提取，innerText 做不到
// （退化为 textContent）。
function __u2mCollectCode() {
  var INLINE_DISPLAY_RE = /^(inline|contents|ruby)/;
  var GUTTER_TEXT_RE = /^[\d\s.,;:)|·•\-–—]*$/;

  function isGutter(el) {
    if (getComputedStyle(el).userSelect !== 'none') return false;
    return GUTTER_TEXT_RE.test(el.textContent || '');
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
    function visit(n) {
      if (n.nodeType === 3) {
        var t = n.textContent;
        // 块间纯空白文本节点：当前行已空（块边界刚断行）→ 零贡献零断行
        // （CSS 块盒间空白不渲染——防幻影空行）；当前行非空（行内词间空白/
        // 缩进）→ 正常切分追加
        if (t.trim() === '' && lines[lines.length - 1] === '') return;
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
        for (var c = n.firstChild; c; c = c.nextSibling) visit(c);
        // 空行容器（内部零内容事件）= 一行真实空行——强制断一行保真；
        // 计数随 brk(true) 传播，嵌套空容器各自占一行
        if (contentCount === mark) brk(true);
        else brk(false);
      } else {
        for (var ci = n.firstChild; ci; ci = ci.nextSibling) visit(ci);
      }
    }
    visit(root);
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
    if (pre.hasAttribute('hidden')) continue; // K5 独占
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

    // blockContainers：code 壳直接子元素中非行内且非 <br> 的个数（行容器计数）
    var blocks = 0;
    for (var ci = code.firstChild; ci; ci = ci.nextSibling) {
      if (ci.nodeType === 1 && ci.tagName !== 'BR' && !isInline(ci)) blocks++;
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
