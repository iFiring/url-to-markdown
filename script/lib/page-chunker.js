/**
 * 步骤 4 页面内分块函数。在浏览器 evaluate 中执行。
 * 基于 key_ids 定位列表流，对子元素进行 Phrasing/Flow/MultiLayer 分类。
 * 对 MultiLayer 块内联"有效样式"：白名单视觉属性的计算值（var() 已解析），
 * 且与无样式空白文档中同标签元素的 UA 默认值差分、相同则丢弃；class 属性剥离。
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

  // 视觉有效属性白名单。每项为一个条目的"备选"列表，每个备选是一起输出的属性名；
  // 取 live 值首个非空的备选（简写不可序列化时回退 longhand）。
  // border/outline/background 有可见性与紧凑性特判，见 effectiveStyle。
  var STYLE_ENTRIES = [
    [['display']],
    [['position']],
    [['inset'], ['top', 'right', 'bottom', 'left']],
    [['float']],
    [['z-index']],
    [['width']],
    [['height']],
    [['min-width']],
    [['min-height']],
    [['max-width']],
    [['max-height']],
    [['margin']],
    [['padding']],
    [['box-sizing']],
    [['overflow'], ['overflow-x', 'overflow-y']],
    [['visibility']],
    [['opacity']],
    [['aspect-ratio']],
    [['flex-flow'], ['flex-direction', 'flex-wrap']],
    [['justify-content']],
    [['justify-items']],
    [['align-items']],
    [['align-content']],
    [['align-self']],
    [['flex'], ['flex-grow', 'flex-shrink', 'flex-basis']],
    [['gap'], ['row-gap', 'column-gap']],
    [['grid-template-columns']],
    [['grid-template-rows']],
    [['color']],
    // 字体名（font-family）对下游 LLM 转化无用（Markdown 不带字体、SVG 用系统字体栈），
    // 不保留；只保留字号/字重/字形/行高的计算值。不用 font 简写（其序列化含字体名）。
    [['font-size']],
    [['font-weight']],
    [['font-style']],
    [['line-height']],
    [['letter-spacing']],
    [['text-align']],
    [['text-decoration'], ['text-decoration-line']],
    [['text-transform']],
    [['white-space']],
    [['vertical-align']],
    [['text-indent']],
    [['text-shadow']],
    [['border-radius']],
    [['box-shadow']],
    [['transform']],
    [['filter']],
    [['list-style'], ['list-style-type']],
    [['object-fit']],
    [['border-collapse']],
    [['table-layout']],
    [['fill']],
    [['stroke']],
    [['stroke-width']]
  ];

  // CSS 继承属性（子元素自然继承父值）：与父元素计算值相同则无需重复声明。
  // fill/stroke/stroke-width 在 SVG 中同样是继承属性。font-family 不输出（见白名单注释）。
  var INHERITED_PROPS = {
    'color': 1, 'font-size': 1, 'font-weight': 1,
    'font-style': 1, 'line-height': 1, 'letter-spacing': 1, 'text-align': 1,
    'text-transform': 1, 'white-space': 1, 'text-indent': 1, 'text-shadow': 1,
    'visibility': 1, 'list-style': 1, 'list-style-type': 1,
    'border-collapse': 1, 'table-layout': 1,
    'fill': 1, 'stroke': 1, 'stroke-width': 1
  };

  // 预格式化上下文（其内空白有渲染意义，缩进清理须跳过）
  var PREFORMATTED_WS = { 'pre': 1, 'pre-wrap': 1, 'pre-line': 1, 'break-spaces': 1 };

  // 无样式空白参照文档（隐藏 iframe，about:blank 不含任何作者样式）：
  // 提供各标签的 UA 默认 computed style，用于差分剔除默认值。
  var refFrame = document.createElement('iframe');
  refFrame.setAttribute('aria-hidden', 'true');
  refFrame.style.cssText = 'position:absolute;left:-9999px;top:0;width:1024px;height:10px;border:0;';
  document.body.appendChild(refFrame);
  var refDoc = refFrame.contentDocument || (refFrame.contentWindow && refFrame.contentWindow.document);
  var refWin = refFrame.contentWindow;
  var refBody = refDoc && refDoc.body;
  var refCache = {};

  function getRefComputed(liveEl) {
    var key = (liveEl.namespaceURI || '') + '|' + liveEl.tagName;
    if (Object.prototype.hasOwnProperty.call(refCache, key)) return refCache[key];
    var computed = null;
    try {
      // 跨 realm：iframe 文档的元素不匹配顶层窗口的构造器，须用参照窗口自身的构造器判断。
      // HTML 元素用 createElement；SVG/MathML 等外来命名空间用 createElementNS 获得其 UA 默认值；
      // 未知元素（如自定义标签）无参照可做差分（ref=null → 白名单全量输出）
      var el = null;
      if (liveEl.namespaceURI === 'http://www.w3.org/1999/xhtml') {
        var htmlEl = refDoc.createElement(liveEl.tagName);
        if (htmlEl && refWin.HTMLElement && htmlEl instanceof refWin.HTMLElement &&
            !(refWin.HTMLUnknownElement && htmlEl instanceof refWin.HTMLUnknownElement)) {
          el = htmlEl;
        }
      } else if (liveEl.namespaceURI && refDoc.createElementNS) {
        el = refDoc.createElementNS(liveEl.namespaceURI, liveEl.tagName);
      }
      if (el && refBody) {
        refBody.appendChild(el);
        computed = refWin.getComputedStyle(el);
      }
    } catch (e) { computed = null; }
    refCache[key] = computed;
    return computed;
  }

  /** 读取属性计算值（简写不可序列化时返回 ''） */
  function readProp(computed, prop) {
    if (!computed) return '';
    var v = computed.getPropertyValue(prop);
    return v || '';
  }

  /** 差分基线：继承属性以父元素计算值为基线（clone 层级保留、值自然继承），
   *  其余以同标签 UA 默认值为基线；根元素（无父）一律以 UA 默认值为基线 */
  function baselineFor(name, parentComputed, ref) {
    if (parentComputed && INHERITED_PROPS[name]) return readProp(parentComputed, name);
    return readProp(ref, name);
  }

  /** 输出单属性（与基线差分）；返回是否输出 */
  function emitProp(parts, computed, name, baseline) {
    var liveVal = readProp(computed, name);
    if (liveVal === '') return false;
    if (liveVal === baseline) return false;
    parts.push(name + ':' + liveVal);
    return true;
  }

  /** border：所有边 style 均为 none 时无可见边框，整体跳过 */
  function emitBorder(parts, computed, parentComputed, ref) {
    var bs = readProp(computed, 'border-style');
    if (!bs) return;
    var sides = bs.split(/\s+/);
    var visible = false;
    for (var i = 0; i < sides.length; i++) {
      if (sides[i] !== 'none' && sides[i] !== 'hidden') { visible = true; break; }
    }
    if (!visible) return;
    var b = readProp(computed, 'border');
    if (b) {
      emitProp(parts, computed, 'border', baselineFor('border', parentComputed, ref));
      return;
    }
    var sideNames = ['border-top', 'border-right', 'border-bottom', 'border-left'];
    for (var j = 0; j < sideNames.length; j++) {
      var st = readProp(computed, sideNames[j] + '-style');
      if (!st || st === 'none' || st === 'hidden') continue;
      emitProp(parts, computed, sideNames[j], readProp(ref, sideNames[j]));
    }
  }

  /** outline：style 为 none 时不可见，跳过 */
  function emitOutline(parts, computed, ref) {
    var os = readProp(computed, 'outline-style');
    if (!os || os === 'none') return;
    emitProp(parts, computed, 'outline', readProp(ref, 'outline'));
  }

  /** background：无图像时只输出 background-color（省掉简写的固定尾巴）；
   *  有图像（含渐变）时输出完整简写以保留 position/size */
  function emitBackground(parts, computed, ref) {
    var img = readProp(computed, 'background-image');
    if (img && img !== 'none') {
      var bg = readProp(computed, 'background');
      if (bg) { emitProp(parts, computed, 'background', readProp(ref, 'background')); return; }
      var props = ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat'];
      for (var i = 0; i < props.length; i++) emitProp(parts, computed, props[i], readProp(ref, props[i]));
      return;
    }
    emitProp(parts, computed, 'background-color', readProp(ref, 'background-color'));
  }

  /** 计算单个元素的"有效样式"：白名单属性、与基线差分、简写优先 */
  function effectiveStyle(liveEl, parentComputed) {
    var computed = window.getComputedStyle(liveEl);
    var ref = getRefComputed(liveEl);
    var parts = [];
    for (var i = 0; i < STYLE_ENTRIES.length; i++) {
      var alts = STYLE_ENTRIES[i];
      for (var a = 0; a < alts.length; a++) {
        var props = alts[a];
        var available = false;
        for (var p = 0; p < props.length; p++) {
          if (readProp(computed, props[p]) !== '') { available = true; break; }
        }
        if (!available) continue;
        for (var q = 0; q < props.length; q++) {
          emitProp(parts, computed, props[q], baselineFor(props[q], parentComputed, ref));
        }
        break; // 已采用该备选，不再回退
      }
    }
    emitBorder(parts, computed, parentComputed, ref);
    emitOutline(parts, computed, ref);
    emitBackground(parts, computed, ref);
    return parts.join(';');
  }

  /** 从 live DOM 读取有效样式并写入对应 clone 节点（detached 节点 getComputedStyle 返回空）；
   *  样式已全量内联，class 属性对下游无意义，剥离；
   *  含换行的纯空白文本节点（源码缩进）折叠为单个空格——white-space:normal 下任意空白串
   *  至多渲染为一个空格（块级/flex/grid 边界处不可见），故折叠是渲染等价变换；
   *  预格式化上下文（inPre）内空白有渲染意义，原样保留。 */
  function copyComputedToClone(liveEl, cloneEl, parentComputed, inPre) {
    var computed = window.getComputedStyle(liveEl);
    var styleStr = effectiveStyle(liveEl, parentComputed);
    if (styleStr) cloneEl.setAttribute('style', styleStr);
    else cloneEl.removeAttribute('style');
    cloneEl.removeAttribute('class');
    var pre = inPre || PREFORMATTED_WS[computed.whiteSpace] === 1;
    if (!pre) {
      var nodes = cloneEl.childNodes;
      for (var t = 0; t < nodes.length; t++) {
        var n = nodes[t];
        if (n.nodeType === 3 && n.data.indexOf('\n') !== -1 && /^\s+$/.test(n.data)) {
          n.data = ' ';
        }
      }
    }
    var liveChildren = liveEl.children;
    var cloneChildren = cloneEl.children;
    for (var i = 0; i < liveChildren.length; i++) {
      copyComputedToClone(liveChildren[i], cloneChildren[i], computed, pre);
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
      dataU2mId: parseInt(uid, 10),
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
      dataU2mId: parseInt(uid, 10),
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
      } else if (!FLOW_TAGS.has(child.tagName) || hasNestedFlow(child)) {
        // 未知标签（svg/canvas/video/iframe/math 等）或含嵌套 Flow → multiLayer
        var clone = child.cloneNode(true);
        // 块根无父上下文：继承属性与 UA 默认差分，作为 clone 子树的继承基点
        copyComputedToClone(child, clone, null, false);
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

  // 清理参照 iframe
  if (refFrame && refFrame.parentNode) refFrame.parentNode.removeChild(refFrame);

  return { chunks: chunks };
}
