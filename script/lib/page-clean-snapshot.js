/**
 * 步骤 2 页面内清洗函数。在浏览器 evaluate 中执行。
 * 保留 DOM 结构 + data-u2m-id + class，剥尽样式、SVG 内容、长文本占位。
 */
function __u2mCleanSnapshot(cfg) {
  cfg = cfg || {};
  var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16;

  // 1. 删除所有 style 属性
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    styled[i].removeAttribute('style');
  }

  // 2. 删除所有 <style> 标签
  var styles = document.querySelectorAll('style');
  for (var i = styles.length - 1; i >= 0; i--) {
    styles[i].parentNode.removeChild(styles[i]);
  }

  // 3. 删除所有 <link rel="stylesheet"> 标签
  var links = document.querySelectorAll('link[rel="stylesheet"]');
  for (var i = links.length - 1; i >= 0; i--) {
    links[i].parentNode.removeChild(links[i]);
  }

  // 4. 删除 <base> 标签
  var bases = document.querySelectorAll('base');
  for (var i = bases.length - 1; i >= 0; i--) {
    bases[i].parentNode.removeChild(bases[i]);
  }

  // 5. 清空 SVG：删除所有属性和子元素，仅保留空 <svg></svg>
  var svgs = document.querySelectorAll('svg');
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    // 删除所有属性
    while (svg.attributes.length > 0) {
      svg.removeAttribute(svg.attributes[0].name);
    }
    // 删除所有子元素
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  }

  // 6. 长文本占位：textContent.length > MIN_CHARS → {{LONG_TEXT_k|N_CHARS}}
  //    纯空白文本节点（源码缩进/换行）不含语义内容，不占位——否则会在
  //    父子元素之间凭空捏造"长文本"，误导步骤 3 的结构识别
  var k = 0;
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
    var text = tn.textContent;
    if (text.length > MIN_CHARS && text.trim() !== '') {
      k++;
      tn.textContent = '{{LONG_TEXT_' + k + '|' + text.length + '_CHARS}}';
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    longTextCount: k
  };
}
