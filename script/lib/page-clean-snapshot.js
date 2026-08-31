/**
 * 步骤 2 页面内清洗函数。在浏览器 evaluate 中执行；clean_snapshot.mjs 对
 * 同一快照跑两趟，cfg.mode ∈ 'styled'（缺省）| 'clean' 分叉：
 *   styled 趟 —— 共享结构清洗 + 长文本占位 + SVG 瘦身为壳（仅留
 *                id/class/data-u2m-id）+ 属性白名单（22 静态属性 +
 *                <style> 选择器引用的动态属性集，<style> 豁免）
 *                → 带样式版 + 恢复清单（供步骤 4 裁剪与后续占位还原）
 *   clean 趟   —— 共享结构清洗 + SVG 清空/样式剥除 + 瘦身规则 → 清洗版
 * 两趟共享同一套结构清洗（步骤 1-9：link/meta/base 删除、骨架删除、播放器
 * 删除、控件删除、空元素级联 + KEEP_EMPTY、astro- 前缀解包）与长文本占位
 * （2026-08-31 修订：占位在共享段末尾同位执行，两版 {{LONG_TEXT_k|n_chars}}
 * 编号逐一对应；折叠统计——K5 hidden 规模、K7 pre 行数——在占位前预计算挂
 * expando，量的始终是原文）。
 *
 * 清洗版含 LONG_TEXT 占位符（与带样式版编号一致）；还原链只走带样式版——
 * 步骤 7 骨架引用来自文章视图（styled 路径），步骤 8 从 2_long_text.json
 * 回填，清洗版占位不被任何后续步骤消费。
 *
 * 清洗版瘦身规则 K1-K7/K9：class 语义过滤 K1 → 属性白名单 K2 →
 * SVG 清空 K3 → astro 解包 K4（两趟共享，见共享段）→ hidden 裸属性折叠 K5
 * （{{HIDDEN_TAG|n;构成}}）→ table 折叠 K6 → pre 折叠 K7 → 空白压缩 K9；
 * K8 行内 run token 化已废除（2026-08-31：run 整段折叠吞噬行内结构，按
 * 文本节点的共享占位保真行内骨架）。详见各步骤注释与 spec 修订记录。
 *
 * 带样式版简化（2026-08-28）：astro 解包两趟共享 + styled 属性白名单——
 * 带样式版是步骤 4-7 的输入源，脚手架标签与属性（astro props、data-v-*、
 * aria-* 等）曾一路流进 6_article.html（步骤 7 LLM 输入）。
 */
function __u2mCleanSnapshot(cfg) {
  cfg = cfg || {};
  var mode = cfg.mode === 'clean' ? 'clean' : 'styled';

  // CJK 统一表意文字基本区（U+4E00–U+9FFF）——两趟共用：styled 趟占位与
  // clean 趟 K5/K8 的中英文判据
  var CJK_RE = /[一-鿿]/;

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

  // 4. 按钮类控件保留（2026-08-25 起）：button 与 [role="button"]（div/span/a
  //    伪装）不再删除——FAQ 折叠头、CTA、卡片式 role=button 常是内容载体，
  //    整删或按字数取舍都会误伤正文，一律保留交步骤 3 语义判断。按钮型
  //    input[type=button|submit|reset] 仍随步骤 7 的表单控件删除（无子内容，
  //    value 文本极罕为正文）。

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
  //    （骨架/媒体/控件）之后，只含噪声的容器随之级联清除。
  //    video/audio/input 等已在前序步骤整体删除，不再列入白名单。
  //    表格结构元素（table/tr/td/col 等）即使为空也保留——删掉空单元格/
  //    空行/列定义会让行列错位，破坏表格整体显示；单元格内的噪声照删，
  //    留下空壳单元格（按钮自 2026-08-25 起保留，见步骤 4）。
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

  // 属性剥除 helper（svg 瘦身 / styled 白名单 / K2 三处共用）：keep(name)
  // 返回 false 的属性删除。统一"先快照属性名再删"——迭代 NamedNodeMap 的
  // 同时删属性会跳项
  function stripAttrsExcept(el, keep) {
    var names = [];
    for (var j = 0; j < el.attributes.length; j++) names.push(el.attributes[j].name);
    for (var j = 0; j < names.length; j++) {
      if (!keep(names[j])) el.removeAttribute(names[j]);
    }
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

  // astro 包装解包（K4，两趟共享）：astro- 前缀是 Astro 框架保留的脚手架
  //    命名空间（astro-island/astro-slot/astro-static-slot 及未来变体），按前缀
  //    匹配而非枚举；子元素原样上提，包装自身属性（含其 data-u2m-id 与巨量
  //    序列化 props）弃置。两趟共享的意义：步骤 3 引用集来自清洗版（从不引用
  //    包装 id），带样式版同步解包使两版 id 集对齐，脚手架不再流进步骤 4-7
  //    （曾实证 6_article.html 残留 59 个 astro 标签、27KB props 噪音）。
  //    置于空元素级联之后（与原清洗版执行顺序一致，清洗版输出逐字节不变）、
  //    K5-K8 折叠之前——折叠统计的是解包后的真实子树。
  var astroWraps = [];
  var allShared = document.querySelectorAll('*');
  for (var i = 0; i < allShared.length; i++) {
    if (allShared[i].tagName.toLowerCase().indexOf('astro-') === 0) astroWraps.push(allShared[i]);
  }
  for (var i = astroWraps.length - 1; i >= 0; i--) {
    var wrap = astroWraps[i];
    while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
    wrap.parentNode.removeChild(wrap);
  }

  // ---- 折叠统计预计算 + 长文本占位（两趟共享）----
  // 长文本占位上移至共享段（2026-08-31 修订，恢复 simplify 前"两版共享、
  // 编号逐一对应"的形态）：两趟在同一 DOM 状态、同一位置执行，清洗版从此
  // 携带与带样式版编号一致的 {{LONG_TEXT_k|n_chars}} 占位符；K8 行内 run
  // 整段折叠废除——run 吞噬行内结构（a/code 混排看不出来），而按文本节点
  // 占位只折叠超阈值的单个文本节点、行内结构保真。
  // K5 hidden 规模与 K7 pre 行数量的是子树原文，必须在占位之前预计算挂
  // expando：占位之后原文变成 {{LONG_TEXT_k|N_unit}} 语法串，届时再量会把
  // 语法当文本（规模虚高）、丢换行（行数塌缩为 1）。表格形状预计算不受
  // 占位影响（数 tr/td/colspan、不动文本），仍在 clean 趟 K2 之前。

  // 规模计量（K5 用）：含汉字按字符数、否则按词数
  function sizeSuffix(text) {
    var t = (text || '').trim();
    var cjk = CJK_RE.test(t);
    var n = cjk ? t.length : t.split(/\s+/).filter(Boolean).length;
    return { n: n, unit: cjk ? 'chars' : 'words' };
  }
  // pre 行数（K7 用）：换行切分与 div 行块数取较大——高亮 span 是语法 token
  // 不是行，行分隔符总以文本节点存在（纯代码 / Prism / hljs / Shiki 全覆盖）；
  // 编辑器式「每行一个 <div>」无换行文本节点，直接子 div 计数兜底，容器 div
  // 场景由换行法胜出、不虚增
  function countPreLines(pre) {
    var t = (pre.textContent || '').trim();
    var nl = t ? t.split(/\n/).length : 0;
    var shell = pre.querySelector('code') || pre;
    var blocks = 0;
    for (var pi = 0; pi < shell.childNodes.length; pi++) {
      var pn = shell.childNodes[pi];
      if (pn.nodeType === 1 && pn.tagName === 'DIV') blocks++;
    }
    return Math.max(nl, blocks);
  }
  var hiddenPre = document.querySelectorAll('[hidden]');
  for (var i = 0; i < hiddenPre.length; i++) {
    hiddenPre[i].__u2mHiddenSize = sizeSuffix(hiddenPre[i].textContent);
  }
  var prePre = document.querySelectorAll('pre');
  for (var i = 0; i < prePre.length; i++) {
    prePre[i].__u2mPreLines = countPreLines(prePre[i]);
  }

  // 9. 长文本占位（两趟共享，编号逐一对应；中英文分标准）：含汉字（CJK）→
  //    中文标准：字符数 > MIN_CHARS → {{LONG_TEXT_k|n_chars}}；不含汉字 →
  //    英文标准：单词数 > MIN_WORDS → {{LONG_TEXT_k|n_words}}。原文按占位
  //    编号收集进 longTexts，由 CLI 写 2_long_text.json 供后续恢复。
  //    纯空白文本节点（源码缩进/换行）不含语义内容，不占位——否则会在
  //    父子元素之间凭空捏造"长文本"，误导步骤 3 的结构识别。
  //    svg/style 子树内的文本不占位——两趟随后都会删 SVG 内容（styled 瘦身
  //    壳 / clean 清空），若占位，占位符会随之消失而编号留在清单里；
  //    <style> 文本在带样式版中原样保留，清洗版删除 <style> 标签
  var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16;
  var MIN_WORDS = typeof cfg.minWords === 'number' ? cfg.minWords : 12;
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

  // ---- mode 分叉：styled 趟 SVG 瘦身 + 属性白名单后返回；clean 趟继续剥样式 ----

  if (mode !== 'clean') {
    // （长文本占位已上移至两趟共享段——见上方步骤 9，两版编号逐一对应）

    // 10. SVG 瘦身（styled 趟）：只留 svg 标签及其 id/class/data-u2m-id，
    //     删除其余属性与全部子元素——完整 SVG 体积庞大，带样式版只需结构身份
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
      stripAttrsExcept(svg, function (nm) {
        return nm === 'id' || nm === 'class' || nm === 'data-u2m-id';
      });
    }

    // 11. 属性白名单（styled 趟）：只留级联、还原链与内容信号所需——
    //     (a) clean K2 八属性 + style（juice 输入）/href/src（步骤 7 链接与
    //     图片 URL 源、步骤 8 下载源）/width/height（img 权重信号，与 style
    //     声明互补）；
    //     (b) 内容信号：colspan/rowspan（步骤 7 判复杂跨格表格→trans2img）、
    //     start（ol 起始编号）、aria-label（icon-only 控件/链接的唯一可达名）、
    //     data-src/srcset（懒加载图片 URL 通道——步骤 1 只规范 img[src]）、
    //     datetime（time 日期原文）、open（details 展开态）、lang（语言信号，
    //     步骤 6 照抄 <html lang>）；
    //     (c) 动态集：<style> 选择器引用的属性——删属性即断 juice 级联
    //     （article-1 曾实测丢 45 条 border/background/display 声明，
    //     [data-theme]/[data-width]/Vue scoped [data-v-*] 一并覆盖）。
    //     其余（target/rel/tabindex/loading/未被引用的 data-* 等）删净。
    //     <style> 标签整体豁免——media 等属性是 juice 级联线索。置于 meta
    //     charset 注入之前，注入的 charset 属性天然存活。
    var STYLED_ATTR_KEEP = { 'class': 1, 'id': 1, 'style': 1, 'data-u2m-id': 1, 'data-language': 1,
      'hidden': 1, 'type': 1, 'role': 1, 'alt': 1, 'href': 1, 'src': 1, 'width': 1, 'height': 1,
      'colspan': 1, 'rowspan': 1, 'start': 1, 'aria-label': 1, 'data-src': 1, 'srcset': 1,
      'datetime': 1, 'open': 1, 'lang': 1 };
    var styleSelAttrs = {};
    var styleEls = document.querySelectorAll('style');
    for (var i = 0; i < styleEls.length; i++) {
      var cssText = styleEls[i].textContent || '';
      var SEL_ATTR_RE = /\[([a-zA-Z][a-zA-Z0-9_-]*)/g;
      var selM;
      while ((selM = SEL_ATTR_RE.exec(cssText))) styleSelAttrs[selM[1].toLowerCase()] = 1;
    }
    var allStyled = document.querySelectorAll('*');
    for (var i = 0; i < allStyled.length; i++) {
      var sel = allStyled[i];
      if (sel.tagName.toUpperCase() === 'STYLE') continue;
      stripAttrsExcept(sel, function (nm) {
        var n = nm.toLowerCase();
        return STYLED_ATTR_KEEP[n] === 1 || styleSelAttrs[n] === 1;
      });
    }

    // 注入 <meta charset="utf-8">（仅带样式版）：head 内 meta 已被共享清洗删除，而
    // extract_styled 以 file:// 加载本产物——无 charset 声明时解码依赖 chromium 嗅探，
    // 环境敏感（曾把 UTF-8 嗅成 Windows-1252 产出双重编码乱码）。清洗版无浏览器加载方，不注入。
    var metaCharset = document.createElement('meta');
    metaCharset.setAttribute('charset', 'utf-8');
    document.head.insertBefore(metaCharset, document.head.firstChild);

    return {
      html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
      longTextCount: k,
      longTexts: longTexts
    };
  }

  // （长文本占位已在两趟共享段执行——清洗版同样携带 {{LONG_TEXT_k|n_chars}}，
  //   编号与带样式版逐一对应；K8 行内 run token 化已废除）

  // 11. SVG 清空子树（仅清洗版）：属性由 K2 白名单统一裁剪，data-u2m-id 等存活
  var svgs = document.querySelectorAll('svg');
  for (var i = 0; i < svgs.length; i++) {
    while (svgs[i].firstChild) svgs[i].removeChild(svgs[i].firstChild);
  }

  // 12. 删除所有 style 属性（clean 趟）
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    styled[i].removeAttribute('style');
  }

  // 13. 删除所有 <style> 标签（clean 趟）
  var styles = document.querySelectorAll('style');
  for (var i = styles.length - 1; i >= 0; i--) {
    styles[i].parentNode.removeChild(styles[i]);
  }

  // K1. class 语义过滤（仅清洗版）：样式强相关 token 删、语义 token 留。
  //     原则：拿不准保留——漏删只费字节，误删语义 token 才伤步骤 3 判读。
  //     2026-08-27 在上版 class 过滤（2026-08-25 瘦身设计）基础上补漏：负号前缀位移类、
  //     CSS-modules、! important 变体、overflow/appearance、裸 border/shadow/prose、工具名类。
  var HASH_PREFIX_RE = /^(?:astro|css|sc|jsx|chakra|emotion|styled|mui|next|module)-[-0-9a-zA-Z]+$/;
  var CSS_MODULE_RE = /^_[A-Za-z][A-Za-z0-9]*_(?=[a-z0-9]*[0-9])[a-z0-9]+(?:_\d+)?$/;
  function isHashSuffix(s) {
    return s.length >= 5 && /^[0-9a-zA-Z]+$/.test(s) && /[0-9]/.test(s) && /[a-zA-Z]/.test(s);
  }
  var UTILITY_RES = [
    /^(?:[mp][trblxy]?)-.+$/,
    /^(?:w|h|min-w|min-h|max-w|max-h|size|basis|top|bottom|left|right|inset|z|order|gap|gap-x|gap-y|grow|shrink|flex|grid-cols|grid-rows|col-span|col-start|col-end|row-span|row-start|row-end)-.+$/,
    /^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|table|contents|flow-root|list-item|isolate)$/,
    /^(?:relative|absolute|fixed|sticky|static)$/,
    /^(?:items|justify|self|content|place|place-items|place-content|place-self|align)-.+$/,
    /^(?:rounded|shadow|opacity|ring|outline|divide|space)-?.*$/,
    /^(?:text|bg|border|from|to|via)-.+$/,
    /^(?:font|leading|tracking|indent|line-clamp|aspect|object|will-change|fill|stroke|transition|duration|ease|delay|animate|transform|scale|translate|rotate|origin|skew|pointer-events|cursor|select|resize|whitespace|break|overscroll|scroll|snap)-?.*$/,
    /^(?:uppercase|lowercase|capitalize|underline|overline|line-through|truncate|antialiased|italic|visible|invisible|collapse|sr-only|not-sr-only)$/,
    /^(?:overflow|appearance)-?[a-z0-9-]*$/,
    /^(?:prose|not-prose|border|shadow|shiki|shiki-themes|syntax-highlighter)(?:-[a-z0-9-]+)?$/
  ];
  function isClassNoise(tok) {
    if (tok.indexOf(':') !== -1 || tok.indexOf('[') !== -1 || tok.indexOf(']') !== -1) return true; // 变体前缀/任意值
    if (tok.charAt(0) === '!') return true;                    // !h-9 等 important 变体
    var body = tok.charAt(0) === '-' ? tok.slice(1) : tok;     // 负号前缀剥离后再判
    if (HASH_PREFIX_RE.test(tok) || CSS_MODULE_RE.test(tok)) return true;
    var dash = body.lastIndexOf('-');
    if (dash !== -1 && isHashSuffix(body.slice(dash + 1)) && /^[a-z][a-z0-9-]*$/i.test(body.slice(0, dash))) return true;
    for (var i = 0; i < UTILITY_RES.length; i++) if (UTILITY_RES[i].test(body)) return true;
    return false;
  }
  var withClass = document.querySelectorAll('[class]');
  for (var i = 0; i < withClass.length; i++) {
    var el = withClass[i];
    var kept = el.getAttribute('class').split(/\s+/).filter(function (t) { return t && !isClassNoise(t); });
    if (kept.length) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
  }

  // 表格形状预计算（供 K6）：网格列数依赖 colspan，而 K2 白名单会剥掉它——
  // 必须在属性删除前从原始 DOM 计算行数/列数。结果挂元素 expando（非属性、
  // 不序列化、不影响两版输出），K6 折叠时取用
  function tableRowsCols(tb) {
    var rows = 0, cols = 0;
    var trs = tb.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].closest('table') !== tb) continue;   // 行归属最近的 table
      rows++;
      var c = 0;
      var cells = trs[i].cells;
      for (var j = 0; j < cells.length; j++) {
        var cs = parseInt(cells[j].getAttribute('colspan'), 10);
        c += cs > 1 ? cs : 1;                         // colspan 展开为网格列
      }
      if (c > cols) cols = c;
    }
    return { rows: rows, cols: cols };
  }
  var shapeTables = document.querySelectorAll('table');
  for (var i = 0; i < shapeTables.length; i++) {
    shapeTables[i].__u2mTableShape = tableRowsCols(shapeTables[i]);
  }

  // K2. 属性白名单（仅清洗版）：全文档只留 LLM 可理解的最小属性集；
  //     href/src/aria-*/style/tabindex 等一律删除——a/img 的 URL 就此清空。
  //     SVG 特殊处理：仅保留 data-u2m-id（id/class 等由 styled 趟保留，clean 趟删净）
  var ATTR_KEEP = { 'class': 1, 'id': 1, 'data-u2m-id': 1, 'data-language': 1, 'hidden': 1, 'type': 1, 'role': 1, 'alt': 1 };
  var allEls = document.querySelectorAll('*');
  for (var i = 0; i < allEls.length; i++) {
    var el2 = allEls[i];
    var isSvg = el2.tagName && el2.tagName.toLowerCase() === 'svg';
    stripAttrsExcept(el2, function (nm) {
      var n = nm.toLowerCase();
      return isSvg ? n === 'data-u2m-id' : ATTR_KEEP[n] === 1;
    });
  }

  // （K4 astro 解包已上移至两趟共享段——见上方步骤 9；本趟不再重复执行）

  // K5. hidden 裸属性折叠（仅清洗版）：HTML 规范里属性存在即隐藏（任意值），
  //     无需样式计算。最外层折叠、子树清空放 HIDDEN_TAG 规模+构成 token
  //     （规模取共享段占位前预计算的原文——量占位符语法串会虚高）；根保留
  //     id 可引用，原文在带样式版（listFlow 引用即可还原 FAQ 折叠答案等）。
  function topTags(counts) {
    return Object.keys(counts)
      .map(function (t) { return counts[t] + '_' + t; })
      .sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); })
      .slice(0, 4).join('/');
  }
  var hiddenCount = 0;
  var hiddenEls = Array.prototype.slice.call(document.querySelectorAll('[hidden]'));
  for (var i = 0; i < hiddenEls.length; i++) {
    var he = hiddenEls[i];
    if (!he.parentNode || !document.body.contains(he)) continue;   // 已被前序折叠删除
    var anc = he.parentElement, nested = false;
    while (anc) { if (anc.hasAttribute && anc.hasAttribute('hidden')) { nested = true; break; } anc = anc.parentElement; }
    if (nested) continue;                                          // 只折最外层
    var tagCounts = {};
    var desc = he.querySelectorAll('*');
    for (var j = 0; j < desc.length; j++) {
      var dt = desc[j].tagName.toLowerCase();
      tagCounts[dt] = (tagCounts[dt] || 0) + 1;
    }
    var sz = he.__u2mHiddenSize;
    var comp = topTags(tagCounts);
    var token = '{{HIDDEN_TAG|' + sz.n + '_' + sz.unit + (comp ? ';' + comp : '') + '}}';
    while (he.firstChild) he.removeChild(he.firstChild);
    he.appendChild(document.createTextNode(token));
    hiddenCount++;
  }

  // K6. table 折叠（仅清洗版）：整树清空、折叠为行列 token——行 = 本表自身的
  //     <tr> 数（嵌套表格的行归属其最近的 table、不计入外层），列 = 各行
  //     「单元格 colspan 之和」的最大值（网格列数而非单元格个数）；形状在 K2
  //     前预计算（colspan 属性彼时尚在）。步骤 3 以行列规模判读表格；全表在
  //     后续步骤从带样式版保真。
  //     带 hidden 的 table 由 K5 独占折叠（其构成 token 已就位），跳过防二次覆盖
  var tables = document.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue;
    var shape = tb.__u2mTableShape;
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    tb.appendChild(document.createTextNode('{{TABLE_TAG|' + shape.rows + '_rows|' + shape.cols + '_cols}}'));
  }

  // K7. pre 折叠（仅清洗版）：data-language 从 code 壳提升到 pre；行数取共享段
  //     占位前预计算的原文换行/div 行块较大值（算法见共享段 countPreLines——
  //     长文本占位吞掉换行后再量会塌缩为 1）。
  //     带 hidden 的 pre 由 K5 独占折叠（其折叠 token 已就位），跳过防二次覆盖
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden')) continue;
    var langShell = pre.querySelector('code[data-language]');
    if (langShell && !pre.hasAttribute('data-language')) {
      pre.setAttribute('data-language', langShell.getAttribute('data-language'));
    }
    var lines = pre.__u2mPreLines;
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    pre.appendChild(document.createTextNode('{{PRE_CODE_TAG|' + lines + '_lines}}'));
  }

  // 行内标签集（K9 用）：判行间空白是否敏感
  var INLINE_TAGS = { A: 1, SPAN: 1, CODE: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, S: 1,
    MARK: 1, SMALL: 1, SUB: 1, SUP: 1, ABBR: 1, CITE: 1, Q: 1, KBD: 1, SAMP: 1, TIME: 1, IMG: 1, BR: 1 };

  // （K8 行内 run token 化已废除——2026-08-31：run 整段折叠吞噬行内结构
  //   （a/code 混排），步骤 3 看不到行内骨架；长文本占位已在两趟共享段
  //   按文本节点执行，行内结构保真）

  // K9. 保守空白压缩（仅清洗版）：删纯空白文本节点，当且仅当
  //     前后兄弟都不是行内文本敏感节点（非空白文本或行内元素）——行内相邻
  //     节点间的空白承载词间分隔，保留。pre 内部已被 K7 折叠清空，天然不涉及。
  function inlineSensitive(node) {
    if (!node) return false;
    if (node.nodeType === 3) return node.textContent.trim() !== '';
    return node.nodeType === 1 && INLINE_TAGS[node.tagName.toUpperCase()] === 1;
  }
  var wsWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  var wsNodes = [];
  var wn;
  while ((wn = wsWalker.nextNode())) {
    if (wn.textContent.trim() === '' && !inlineSensitive(wn.previousSibling) && !inlineSensitive(wn.nextSibling)) {
      wsNodes.push(wn);
    }
  }
  for (var i = 0; i < wsNodes.length; i++) wsNodes[i].parentNode.removeChild(wsNodes[i]);

  // （原步骤 19 R6 juice 隐藏折叠已废除：样式检测管线整体移除，隐藏折叠由
  //   上方 K5 以 hidden 裸属性零样式计算实现）

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    stats: { hiddenCount: hiddenCount }
  };
}
