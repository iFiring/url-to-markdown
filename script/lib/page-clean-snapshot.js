/**
 * 步骤 2 页面内清洗函数。在浏览器 evaluate 中执行。
 * 单趟清洗产出两份快照：
 *   html       —— 清洗版：剥样式、SVG 清空（步骤 3 的结构视图）
 *   styledHtml —— 带样式版：保留 style 属性与 <style> 标签，SVG 瘦身为壳
 *                 （仅留 id/class/data-u2m-id），其余与清洗版一致
 * 两版共享同一套结构清洗与长文本占位，占位符编号逐一对应；
 * 占位跳过 svg/style 子树文本（两版都会删除 SVG 内容与 <style>，若占位会产生孤儿编号）。
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

  // 5. 删除空元素：子树内既无非空白文本、也无内容元素的空壳（含仅空白文本者）。
  //    级联：后序单趟——判定基于子树的真实内容，子空则父亦空，自然级联到任意深度。
  //    内容元素（img/br/svg/pre/h1-h6 等）本身即内容，即使无子节点也保留；
  //    含文本的 span/div 等天然不空，不受影响。置于按钮删除之后，
  //    只含按钮的容器随之级联清除。
  var KEEP_EMPTY = {
    IMG: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, OBJECT: 1, EMBED: 1,
    SOURCE: 1, TRACK: 1, PICTURE: 1,
    BR: 1, HR: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, WBR: 1,
    SVG: 1, MATH: 1, PRE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1
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

  // 6. 长文本占位（中英文分标准；两版共享，编号逐一对应）：
  //    含汉字（CJK）→ 中文标准：字符数 > MIN_CHARS → {{LONG_TEXT_k|N_chars}}
  //    不含汉字    → 英文标准：单词数 > MIN_WORDS → {{LONG_TEXT_k|N_words}}
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

  // 7. SVG 瘦身（带样式版）：只留 svg 标签及其 id/class/data-u2m-id，
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

  // 8. 清空 SVG 壳：剥掉瘦身壳上剩余的 id/class/data-u2m-id → 裸 <svg></svg>（仅清洗版）
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    while (svg.attributes.length > 0) {
      svg.removeAttribute(svg.attributes[0].name);
    }
  }

  // 9. 删除所有 style 属性（仅清洗版）
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    styled[i].removeAttribute('style');
  }

  // 10. 删除所有 <style> 标签（仅清洗版）
  var styles = document.querySelectorAll('style');
  for (var i = styles.length - 1; i >= 0; i--) {
    styles[i].parentNode.removeChild(styles[i]);
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    styledHtml: styledHtml,
    longTextCount: k,
    longTexts: longTexts
  };
}
