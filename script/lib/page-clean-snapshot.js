/**
 * 步骤 2 页面内清洗函数。在浏览器 evaluate 中执行。
 * 单趟清洗产出两份快照：
 *   html       —— 清洗版：剥样式、SVG 清空（步骤 3 的结构视图）
 *   styledHtml —— 带样式版：保留 style 属性与 <style> 标签，SVG 瘦身为壳
 *                 （仅留 id/class/data-u2m-id），其余与清洗版一致
 * 两版共享同一套结构清洗与长文本占位，占位符编号逐一对应；
 * 占位跳过 svg/style 子树文本（两版都会删除 SVG 内容与 <style>，若占位会产生孤儿编号）。
 * clean-only 段新增 R1-R6 瘦身规则，见各步骤注释与 spec。
 */
function __u2mCleanSnapshot(cfg) {
  cfg = cfg || {};
  var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16;

  // 1. 删除所有 <link> 标签（stylesheet/preconnect/icon 等，对结构识别是纯噪声）
  var links = document.querySelectorAll('link');
  for (var i = links.length - 1; i >= 0; i--) {
    links[i].parentNode.removeChild(links[i]);
  }

  // 2. 删除所有 <meta> 标签（charset/viewport/og:* 等，对结构识别是纯噪声）；
  //    <title> 保留，作步骤 3 的识别线索
  var metas = document.querySelectorAll('meta');
  for (var i = metas.length - 1; i >= 0; i--) {
    metas[i].parentNode.removeChild(metas[i]);
  }

  // 3. 删除 <base> 标签
  var bases = document.querySelectorAll('base');
  for (var i = bases.length - 1; i >= 0; i--) {
    bases[i].parentNode.removeChild(bases[i]);
  }

  // 4. 删除按钮类控件：<button>、role="button"（含 div/span/a 伪装）、
  //    input 按钮。交互 UI 与正文结构无关，整体删除
  var btns = document.querySelectorAll(
    'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]'
  );
  for (var i = btns.length - 1; i >= 0; i--) {
    btns[i].parentNode.removeChild(btns[i]);
  }

  // 5. 删除页面骨架标签：<nav>/<footer>/<form> 及其 role 等价物——
  //    导航/页脚/表单不属于文章正文（<article> 内嵌 footer 同样删除）；
  //    置于空元素级联之前，只含骨架标签的包装容器随之级联清除
  var skeletons = document.querySelectorAll(
    'nav, footer, form, [role="navigation"], [role="contentinfo"], [role="form"]'
  );
  for (var i = skeletons.length - 1; i >= 0; i--) {
    skeletons[i].parentNode.removeChild(skeletons[i]);
  }

  // 6. 删除媒体播放器标签 <video>/<audio>——播放器控件无正文结构价值，
  //     子元素 <source>/<track> 随之删除（分派不受影响：chunker 读 1_snapshot）
  var players = document.querySelectorAll('video, audio');
  for (var i = players.length - 1; i >= 0; i--) {
    players[i].parentNode.removeChild(players[i]);
  }

  // 7. 删除残余表单控件与模态框：<input>/<select>/<textarea>/<label>/<dialog>——
  //     <form> 已整体删除，这里兜住 form 外的搜索框、下拉、对话框等 UI 控件；
  //     <header>/<aside> 是正文结构（hero 含主标题、章节 header+aside 交替），不删
  var controls = document.querySelectorAll('input, select, textarea, label, dialog');
  for (var i = controls.length - 1; i >= 0; i--) {
    controls[i].parentNode.removeChild(controls[i]);
  }

  // 8. 删除空元素：子树内既无非空白文本、也无内容元素的空壳（含仅空白文本者）。
  //    级联：后序单趟——判定基于子树的真实内容，子空则父亦空，自然级联到任意深度。
  //    内容元素（img/br/svg/pre/h1-h6 等）本身即内容，即使无子节点也保留；
  //    含文本的 span/div 等天然不空，不受影响。置于各类噪声删除
  //    （按钮/骨架/媒体/控件）之后，只含噪声的容器随之级联清除。
  //    video/audio/input 等已在前序步骤整体删除，不再列入白名单。
  //    表格结构元素（table/tr/td/col 等）即使为空也保留——删掉空单元格/
  //    空行/列定义会让行列错位，破坏表格整体显示；单元格内的噪声（按钮等）
  //    照删，留下空壳单元格。
  var KEEP_EMPTY = {
    IMG: 1, IFRAME: 1, CANVAS: 1, OBJECT: 1, EMBED: 1,
    SOURCE: 1, PICTURE: 1,
    BR: 1, HR: 1, WBR: 1,
    SVG: 1, MATH: 1, PRE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    TABLE: 1, CAPTION: 1, COLGROUP: 1, COL: 1,
    THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1
  };

  // SVG/MathML 命名空间元素的 tagName 保留原大小写（如小写 'svg'），
  // 统一按大写查表
  function keepTag(el) {
    return KEEP_EMPTY[el.tagName.toUpperCase()] === 1;
  }

  function hasContent(el) {
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        if (n.textContent.trim() !== '') return true;
      } else if (n.nodeType === 1) {
        if (keepTag(n)) return true;
        if (hasContent(n)) return true;
      }
    }
    return false;
  }

  var empties = [];
  function collectEmpty(el) {
    var children = el.children;
    for (var i = 0; i < children.length; i++) collectEmpty(children[i]);
    if (!keepTag(el) && !hasContent(el)) empties.push(el);
  }
  var bodyChildren = document.body.children;
  for (var i = 0; i < bodyChildren.length; i++) collectEmpty(bodyChildren[i]);
  for (var i = empties.length - 1; i >= 0; i--) {
    var emp = empties[i];
    if (emp.parentNode) emp.parentNode.removeChild(emp);
  }

  // 9. 长文本占位（中英文分标准；两版共享，编号逐一对应）：
  //    含汉字（CJK）→ 中文标准：字符数 > MIN_CHARS → {{LONG_TEXT_k|n_chars}}
  //    不含汉字    → 英文标准：单词数 > MIN_WORDS → {{LONG_TEXT_k|n_words}}
  //    原文按占位编号收集进 longTexts，由 CLI 写 2_long_text.json 供后续恢复。
  //    纯空白文本节点（源码缩进/换行）不含语义内容，不占位——否则会在
  //    父子元素之间凭空捏造"长文本"，误导步骤 3 的结构识别。
  //    svg/style 子树内的文本不占位——两版都会删除 SVG 内容，清洗版还会删 <style>，
  //    若占位，占位符会随之消失而编号留在清单里；
  //    <style> 文本在带样式版中原样保留，SVG 文本两版都不保留
  var MIN_WORDS = typeof cfg.minWords === 'number' ? cfg.minWords : 12;
  var CJK_RE = /[一-鿿]/; // CJK 统一表意文字基本区（U+4E00–U+9FFF）
  function skipPlaceholder(textNode) {
    var p = textNode.parentElement;
    return !!(p && p.closest && p.closest('svg, style'));
  }
  var k = 0;
  var longTexts = {};
  var walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  var textNodes = [];
  var node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }
  for (var i = 0; i < textNodes.length; i++) {
    var tn = textNodes[i];
    if (skipPlaceholder(tn)) continue;
    var text = tn.textContent;
    if (text.trim() === '') continue;
    var n, unit;
    if (CJK_RE.test(text)) {
      if (text.length <= MIN_CHARS) continue;
      n = text.length;
      unit = 'chars';
    } else {
      n = text.trim().split(/\s+/).length;
      if (n <= MIN_WORDS) continue;
      unit = 'words';
    }
    k++;
    longTexts[String(k)] = text;
    tn.textContent = '{{LONG_TEXT_' + k + '|' + n + '_' + unit + '}}';
  }

  // 10. SVG 瘦身（带样式版）：只留 svg 标签及其 id/class/data-u2m-id，
  //    删除其余属性与全部子元素——完整 SVG 体积庞大，带样式版只需结构身份
  var svgs = document.querySelectorAll('svg');
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    var attrNames = [];
    for (var j = 0; j < svg.attributes.length; j++) attrNames.push(svg.attributes[j].name);
    for (var j = 0; j < attrNames.length; j++) {
      var name = attrNames[j];
      if (name !== 'id' && name !== 'class' && name !== 'data-u2m-id') {
        svg.removeAttribute(name);
      }
    }
  }

  // --- 此刻 DOM 为"带样式清洗态"（样式完整、SVG 已瘦身、占位已打）：先序列化带样式版 ---
  var styledHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  // 11. 清空 SVG 壳：剥掉瘦身壳上剩余的 id/class/data-u2m-id → 裸 <svg></svg>（仅清洗版）
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    while (svg.attributes.length > 0) {
      svg.removeAttribute(svg.attributes[0].name);
    }
  }

  // 12. 删除所有 style 属性（仅清洗版）
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    styled[i].removeAttribute('style');
  }

  // 13. 删除所有 <style> 标签（仅清洗版）
  var styles = document.querySelectorAll('style');
  for (var i = styles.length - 1; i >= 0; i--) {
    styles[i].parentNode.removeChild(styles[i]);
  }

  // 14. R2 class 噪声过滤（仅清洗版）：class 值按空白切 token，剥工具/哈希 token、
  //     留语义 token。原则：拿不准保留——漏删只费字节，误删语义 token（步骤 3 的
  //     正式识别线索）才伤识别。带样式版不动。
  var HASH_PREFIX_RE = /^(?:astro|css|sc|jsx|chakra|emotion|styled|mui|next|module)-[-0-9a-zA-Z]+$/;
  function isHashSuffix(s) {
    return s.length >= 5 && /^[0-9a-zA-Z]+$/.test(s) && /[0-9]/.test(s) && /[a-zA-Z]/.test(s);
  }
  var UTILITY_RES = [
    /^(?:[mp][trblxy]?)-.+$/, /^-(?:[mp][trblxy]?)-.+$/,
    /^(?:w|h|min-w|min-h|max-w|max-h|size|basis|top|bottom|left|right|inset|z|order|gap|gap-x|gap-y|grow|shrink|flex|grid-cols|grid-rows|col-span|col-start|col-end|row-span|row-start|row-end)-.+$/,
    /^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|table|contents|flow-root|list-item|isolate)$/,
    /^(?:relative|absolute|fixed|sticky|static)$/,
    /^(?:items|justify|self|content|place|place-items|place-content|place-self|align)-.+$/,
    /^(?:rounded|shadow|opacity|ring|outline|divide|space)-?.*$/,
    /^(?:text|bg|border|from|to|via)-.+$/,
    /^(?:font|leading|tracking|indent|line-clamp|aspect|object|will-change|fill|stroke|transition|duration|ease|delay|animate|transform|scale|translate|rotate|origin|skew|pointer-events|cursor|select|resize|whitespace|break|overscroll|scroll|snap)-?.*$/,
    /^(?:uppercase|lowercase|capitalize|underline|overline|line-through|truncate|antialiased|italic|visible|invisible|collapse|sr-only|not-sr-only)$/,
  ];
  function isClassNoise(tok) {
    if (tok.indexOf(':') !== -1 || tok.indexOf('[') !== -1 || tok.indexOf(']') !== -1) return true; // 变体前缀/任意值
    if (HASH_PREFIX_RE.test(tok)) return true;
    var dash = tok.lastIndexOf('-');
    if (dash !== -1 && isHashSuffix(tok.slice(dash + 1)) && /^[a-z][a-z0-9-]*$/i.test(tok.slice(0, dash))) return true;
    for (var i = 0; i < UTILITY_RES.length; i++) if (UTILITY_RES[i].test(tok)) return true;
    return false;
  }
  var withClass = document.querySelectorAll('[class]');
  for (var i = 0; i < withClass.length; i++) {
    var el = withClass[i];
    var kept = el.getAttribute('class').split(/\s+/).filter(function (t) { return t && !isClassNoise(t); });
    if (kept.length) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
  }

  // 15. R3 data-* 白名单（仅清洗版）：清洗版只留 data-u2m-id / data-language /
  //     data-u2m-hidden（R6 折叠标记）；其余 data-* 全是埋点/框架噪声。
  var DATA_KEEP = { 'data-u2m-id': 1, 'data-language': 1, 'data-u2m-hidden': 1 };
  var allEls = document.querySelectorAll('*');
  for (var i = 0; i < allEls.length; i++) {
    var el2 = allEls[i];
    var names = [];
    for (var j = 0; j < el2.attributes.length; j++) names.push(el2.attributes[j].name);
    for (var j = 0; j < names.length; j++) {
      var nm = names[j].toLowerCase();
      if (nm.indexOf('data-') === 0 && !DATA_KEEP[nm]) el2.removeAttribute(names[j]);
    }
  }

  // 16. R1 pre 内容替换（仅清洗版）：代码块对结构识别只是一个单元，内容全文在
  //     带样式版保真（步骤 7 于 6_article 写进骨架）。首个 code 壳保留（含
  //     data-language），其余子元素删除；行内 <code> 是句子成分，不动。
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    var codeShell = null;
    var nodes = Array.prototype.slice.call(pre.childNodes);
    for (var j = 0; j < nodes.length; j++) {
      if (!codeShell && nodes[j].nodeType === 1 && nodes[j].tagName === 'CODE') { codeShell = nodes[j]; continue; }
      pre.removeChild(nodes[j]);
    }
    var host = codeShell || pre;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(document.createTextNode('code...'));
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    styledHtml: styledHtml,
    longTextCount: k,
    longTexts: longTexts
  };
}
