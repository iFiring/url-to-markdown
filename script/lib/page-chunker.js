/**
 * 步骤 4 页面内分块函数。在浏览器 evaluate 中执行。
 * 基于 key_ids 定位列表流，对子元素进行 Phrasing/Flow/MultiLayer 分类。
 * 对 MultiLayer 块计算 computed style 并内联。
 */
function __u2mChunk(cfg) {
  cfg = cfg || {};
  var keyIds = cfg.keyIds || {};
  var titleIds = keyIds.titleIds || [];
  var descriptionIds = keyIds.descriptionIds || [];
  var listFlowIds = keyIds.listFlowIds || [];

  // HTML 标准 Phrasing content 标签（行内元素）
  var PHRASING_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA',
    'DFN', 'EM', 'I', 'IMG', 'INPUT', 'KBD', 'LABEL', 'MAP', 'MARK',
    'METER', 'OBJECT', 'OUTPUT', 'PICTURE', 'PROGRESS', 'Q', 'RUBY',
    'S', 'SAMP', 'SELECT', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP',
    'TEXTAREA', 'TIME', 'U', 'VAR', 'WBR'
  ]);

  // HTML 标准 Flow content 标签（块级元素）
  var FLOW_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG',
    'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
    'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'TABLE', 'UL'
  ]);

  function isPhrasing(el) {
    return PHRASING_TAGS.has(el.tagName);
  }

  function hasNestedFlow(el) {
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      if (FLOW_TAGS.has(children[i].tagName)) return true;
    }
    return false;
  }

  /** 对元素及其子树计算并内联 computed style */
  function inlineComputedStyles(el) {
    var computed = window.getComputedStyle(el);
    var styleStr = '';
    for (var i = 0; i < computed.length; i++) {
      var prop = computed[i];
      styleStr += prop + ':' + computed.getPropertyValue(prop) + ';';
    }
    el.setAttribute('style', styleStr);
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      inlineComputedStyles(children[i]);
    }
  }

  var chunks = [];
  var id = 0;

  // 处理标题块
  titleIds.forEach(function (uid) {
    var el = document.querySelector('[data-u2m-id="' + uid + '"]');
    if (!el) return;
    id++;
    chunks.push({
      id: id,
      type: 'phrasing',
      dataU2mId: uid,
      html: el.outerHTML,
      needsLLM: false,
    });
  });

  // 处理说明块
  descriptionIds.forEach(function (uid) {
    var el = document.querySelector('[data-u2m-id="' + uid + '"]');
    if (!el) return;
    id++;
    chunks.push({
      id: id,
      type: 'phrasing',
      dataU2mId: uid,
      html: el.outerHTML,
      needsLLM: false,
    });
  });

  // 处理列表流
  listFlowIds.forEach(function (uid) {
    var parent = document.querySelector('[data-u2m-id="' + uid + '"]');
    if (!parent) return;
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      id++;

      if (isPhrasing(child)) {
        // 纯 Phrasing 内容
        chunks.push({
          id: id,
          type: 'phrasing',
          dataU2mId: parseInt(child.getAttribute('data-u2m-id') || '0', 10),
          html: child.outerHTML,
          needsLLM: false,
        });
      } else if (hasNestedFlow(child)) {
        // Multi-layer Flow 内容：计算并内联样式
        var clone = child.cloneNode(true);
        inlineComputedStyles(clone);
        chunks.push({
          id: id,
          type: 'multiLayer',
          dataU2mId: parseInt(child.getAttribute('data-u2m-id') || '0', 10),
          html: child.outerHTML,
          styledHtml: clone.outerHTML,
          needsLLM: true,
        });
      } else {
        // 单层 Flow 内容
        chunks.push({
          id: id,
          type: 'flow',
          dataU2mId: parseInt(child.getAttribute('data-u2m-id') || '0', 10),
          html: child.outerHTML,
          needsLLM: false,
        });
      }
    }
  });

  return { chunks: chunks };
}
