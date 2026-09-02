/**
 * 步骤 2 页面内清洗函数。在浏览器 evaluate 中执行；clean_snapshot.mjs 对
 * 同一快照跑两趟，cfg.mode ∈ 'styled'（缺省）| 'clean' 分叉：
 *   styled 趟 —— 共享结构清洗 + 长文本占位 + SVG 瘦身为壳（仅留
 *                id/class/data-idx）+ 属性白名单（22 静态属性 +
 *                <style> 选择器引用的动态属性集，<style> 豁免）
 *                → 带样式版 + 恢复清单（供步骤 4 裁剪与后续占位还原）
 *   clean 趟   —— 共享结构清洗 + SVG 清空/样式剥除 + 瘦身规则 → 清洗版
 * 两趟共享同一套结构清洗（步骤 1-9：link/meta/base 删除、骨架删除、播放器
 * 删除、控件删除、空元素级联 + KEEP_EMPTY、astro- 前缀解包）与折叠统计预
 * 计算（K5 hidden 规模、K7 pre 行数量原文挂 expando）。长文本占位自
 * 2026-09-03 起移出共享段、两趟各自执行：styled 趟带编号 {{LONG_TEXT_k|n_chars}}
 * （还原链消费），clean 趟在 K11 之后执行且无编号 {{LONG_TEXT|n_chars}}——
 * 唯一消费者步骤 3 只看结构+体量信号。
 *
 * 清洗版含无编号 LONG_TEXT 占位符（K11 纯视图折叠先于占位执行、可吞模块内
 * 长文本——孪生守卫为 clean LT 后缀 ⊆ styled，步骤 3 少看见模块内 LT，
 * 还原链不受影响）；
 * 还原链只走带样式版——步骤 7 骨架引用来自文章视图（styled 路径），步骤 8
 * 从 2_long_text.json 回填，清洗版占位不被任何后续步骤消费。
 *
 * 清洗版瘦身规则 K1-K7/K9-K11：class 语义过滤 K1 → 属性白名单 K2 →
 * SVG 清空 K3 → astro 解包 K4（两趟共享，见共享段）→ hidden 裸属性折叠 K5
 * （{{HIDDEN_TAG|n;构成}}）→ table 折叠 K6 → pre 折叠 K7 → 空白压缩 K9 →
 * 空壳 span 拆包 K10 → 纯视图文本折叠 K11（{{VIEW_TEXT|n_chars}}，两道
 * 门槛：文本量 ≥8 汉字/≥6 词、结构量纯 div 树内部 div>6 / 含 span 树
 * 合计>4（p 根只含 text/span、同 span 档），含 LT 模块整棵折，见 K11 段
 * 注释）；K8 行内 run token
 * 化已废除（2026-08-31：run 整段折叠吞噬行内结构，按文本节点的共享占位
 * 保真行内骨架）。详见各步骤注释与 spec 修订记录。
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
        // pre 子树内空白是语义内容：shiki/hljs 逐 token 高亮把空格也包成
        // <span style="color"> </span>（行内 token），trim 判空会把这种仅含
        // 空白的 span 当空壳删掉，丢失空格致代码粘连（constclient=…）。
        // <pre> 白空保留是 HTML 语义，pre 子树内一律计为内容。scoped 到 pre
        // ——块级仅含空白的元素（缩进 filler）照删，既有空元素级联行为不变。
        // 级联在两趟共享段执行，带样式版（喂步骤 4-7 的路径）同样受益。
        if (el.closest('pre')) return true;
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
  //    匹配而非枚举；子元素原样上提，包装自身属性（含其 data-idx 与巨量
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

  // ---- 折叠统计预计算（两趟共享）+ 长文本占位函数定义 ----
  // 长文本占位（2026-09-03 修订）移出共享段、两趟各自调用 foldLongText：
  // styled 趟在分支开头执行（带编号，原文按编号收集 → 2_long_text.json）；
  // clean 趟在 K11 之后执行（无编号——步骤 3 只看结构+体量；K11 先整棵折叠
  // 纯视图模块，幸存文本节点再占位）。阈值/豁免/中英文标准两趟同源。
  // K5 hidden 规模与 K7 pre 行数量的是子树原文，必须在占位之前预计算挂
  // expando：占位之后原文变成 {{LONG_TEXT…N_unit}} 语法串，届时再量会把
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

  // 9. 长文本占位（foldLongText；中英文分标准）：含汉字（CJK）→ 中文标准
  //    字符数 > MIN_CHARS；不含汉字 → 英文标准单词数 > MIN_WORDS。
  //    numbered=true（styled 趟，分支开头调用）：占位 {{LONG_TEXT_k|n_unit}}、
  //    原文按编号收集进 longTexts 由 CLI 写 2_long_text.json 供后续恢复；
  //    numbered=false（clean 趟，K11 之后调用）：占位 {{LONG_TEXT|n_unit}}、
  //    不收集——清洗版唯一消费者是步骤 3（结构+体量信号），编号无意义，
  //    恢复清单只来自带样式版。
  //    纯空白文本节点（源码缩进/换行）不含语义内容，不占位——否则会在
  //    父子元素之间凭空捏造"长文本"，误导步骤 3 的结构识别。
  //    svg/style 子树内的文本不占位——两趟随后都会删 SVG 内容（styled 瘦身
  //    壳 / clean 清空），若占位，占位符会随之消失而编号留在清单里；
  //    <style> 文本在带样式版中原样保留，清洗版删除 <style> 标签。
  //    H1/H2/H3 整子树内的文本不占位（2026-08-31 修订）——标题是层级锚点，
  //    占位成 {{LONG_TEXT_k|N}} 会让步骤 3 的 LLM 看不到真实标题文本、无从
  //    判标题层级与 key id 取舍（与 <title> 不占位同款 rationale，title 因
  //    treewalker 只走 body 而天然不占位，这里是把同款豁免扩到正文标题）。
  //    整子树豁免——嵌套 span/a/code 等后代文本节点一并保留原文、子树结构
  //    原样；H4/H5/H6 仍按阈值占位（字面取 H1/H2/H3，深层子标题不当结构锚点）。
  var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16;
  var MIN_WORDS = typeof cfg.minWords === 'number' ? cfg.minWords : 12;
  function skipPlaceholder(textNode) {
    var p = textNode.parentElement;
    return !!(p && p.closest && p.closest('svg, style, h1, h2, h3'));
  }
  function foldLongText(numbered) {
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
      if (numbered) {
        k++;
        longTexts[String(k)] = text;
        tn.textContent = '{{LONG_TEXT_' + k + '|' + n + '_' + unit + '}}';
      } else {
        tn.textContent = '{{LONG_TEXT|' + n + '_' + unit + '}}';
      }
    }
    return { count: k, texts: longTexts };
  }

  // 9b. aria-label 值截断（两趟共享）：保留首句+末句，中间省略为 …。
  //     aria-label 是 icon-only 控件/链接的唯一可达名信号——clean 趟白名单
  //     保留它、styled 趟亦保留，但某些站点把整段描述塞进 aria-label，全量
  //     流到步骤 7 LLM 输入费 token。按完整句末标点切句：终止符 = 。！？；
  //     与 .!?;（不含逗号/顿号这类句中停顿）；≥3 句才截断，≤2 句（含无终止
  //     符的长单句）原样保留。共享段同位执行→两版截断值天然一致（孪生守卫
  //     不受影响）；aria-label 是元数据、不流入最终 markdown，无需进恢复清单。
  function truncateAriaLabel(val) {
    if (!val) return val;
    var SENT_RE = /[^。！？；.!?;]*[。！？；.!?;]+|[^。！？；.!?;]+$/g;
    var parts = val.match(SENT_RE);
    if (!parts) return val;
    parts = parts.map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
    if (parts.length < 3) return val;
    return parts[0] + '…' + parts[parts.length - 1];
  }
  var ariaEls = document.querySelectorAll('[aria-label]');
  for (var i = 0; i < ariaEls.length; i++) {
    var al = ariaEls[i].getAttribute('aria-label');
    var tl = truncateAriaLabel(al);
    if (tl !== al) ariaEls[i].setAttribute('aria-label', tl);
  }

  // ---- mode 分叉：styled 趟 SVG 瘦身 + 属性白名单后返回；clean 趟继续剥样式 ----

  if (mode !== 'clean') {
    // 长文本占位（styled 趟，带编号）：在共享清洗后的同一文本状态执行（共享段
    // 时代该步在 aria 截断前——aria 截断只动属性不动文本节点，DOM 文本状态
    // 等价，产物逐字节不变）；恢复清单 longTexts 由此趟收集，表格/代码块
    // 收集（分支末尾）看到的 {{LONG_TEXT_k}} 占位符形态不变
    var ltStyled = foldLongText(true);

    // 10. SVG 瘦身（styled 趟）：只留 svg 标签及其 id/class/data-idx，
    //     删除其余属性与全部子元素——完整 SVG 体积庞大，带样式版只需结构身份
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
      stripAttrsExcept(svg, function (nm) {
        return nm === 'id' || nm === 'class' || nm === 'data-idx';
      });
    }

    // 11. 属性白名单（styled 趟）：只留级联、还原链与内容信号所需——
    //     (a) clean K2 八属性 + style（juice 输入）/href/src（步骤 7 链接与
    //     图片 URL 源、步骤 8 下载源）/width/height（img 权重信号，与 style
    //     声明互补）；
    //     (b) 内容信号：colspan/rowspan（步骤 7 判复杂跨格表格→trans2img）、
    //     start（ol 起始编号）、aria-label（icon-only 控件/链接的唯一可达名，值已在共享段截断为首末句）、
    //     data-src/srcset（懒加载图片 URL 通道——步骤 1 只规范 img[src]）、
    //     datetime（time 日期原文）、open（details 展开态）、lang（语言信号，
    //     步骤 6 照抄 <html lang>）；
    //     (c) 动态集：<style> 选择器引用的属性——删属性即断 juice 级联
    //     （article-1 曾实测丢 45 条 border/background/display 声明，
    //     [data-theme]/[data-width]/Vue scoped [data-v-*] 一并覆盖）。
    //     其余（target/rel/tabindex/loading/未被引用的 data-* 等）删净。
    //     <style> 标签整体豁免——media 等属性是 juice 级联线索。置于 meta
    //     charset 注入之前，注入的 charset 属性天然存活。
    var STYLED_ATTR_KEEP = { 'class': 1, 'id': 1, 'style': 1, 'data-idx': 1, 'data-language': 1,
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

    // 收集表格元数据（折叠前、长文本占位已就位）供 Node 层跑转换引擎。
    // __u2mCollectTables 由 clean_snapshot.mjs 把 page-collect-tables.js 源码拼在
    // 本函数前注入 evaluate 作用域；单独跑本函数时（无注入）退化为空列表。
    var tablesCollected = (typeof __u2mCollectTables === 'function') ? __u2mCollectTables() : [];

    // 收集代码块元数据（折叠前、与表格同场——LONG_TEXT 占位已就位）。
    // __u2mCollectCode 由 clean_snapshot.mjs 把 page-collect-code.js 源码拼在
    // 本函数前注入 evaluate 作用域；单独跑本函数时（无注入）退化为空列表。
    var codesCollected = (typeof __u2mCollectCode === 'function') ? __u2mCollectCode() : [];

    return {
      html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
      longTextCount: ltStyled.count,
      longTexts: ltStyled.texts,
      tables: tablesCollected,
      codes: codesCollected
    };
  }

  // （长文本占位在 clean 趟由 K11 之后的 foldLongText(false) 执行——无编号
  //   {{LONG_TEXT|n_unit}}，见文件头注与 K11 段末尾）

  // 11. SVG 清空子树（仅清洗版）：属性由 K2 白名单统一裁剪，data-idx 等存活
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
  //     href/src/style/tabindex 等一律删除——a/img 的 URL 就此清空。aria-label
  //     例外保留（已在共享段截断为首末句，icon-only 控件/链接的可达名信号），
  //     其余 aria-* 一并删。
  //     SVG 特殊处理：仅保留 data-idx（id/class 等由 styled 趟保留，clean 趟删净）
  var ATTR_KEEP = { 'class': 1, 'id': 1, 'data-idx': 1, 'data-language': 1, 'hidden': 1, 'type': 1, 'role': 1, 'alt': 1, 'aria-label': 1 };
  var allEls = document.querySelectorAll('*');
  for (var i = 0; i < allEls.length; i++) {
    var el2 = allEls[i];
    var isSvg = el2.tagName && el2.tagName.toLowerCase() === 'svg';
    stripAttrsExcept(el2, function (nm) {
      var n = nm.toLowerCase();
      return isSvg ? n === 'data-idx' : ATTR_KEEP[n] === 1;
    });
  }

  // （K4 astro 解包已上移至两趟共享段——见上方步骤 9；本趟不再重复执行）

  // K5. hidden 裸属性折叠（仅清洗版）：HTML 规范里属性存在即隐藏（任意值），
  //     无需样式计算。最外层折叠、子树清空放 HIDDEN_TAG 规模+构成 token
  //     （规模取共享段占位前预计算的原文——量占位符语法串会虚高）；根保留
  //     id 可引用，原文在带样式版（步骤 3 把 hidden 块标进 paragraphIds
  //     即可还原 FAQ 折叠答案等）。
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

  // K6. table 折叠（仅清洗版）：整树清空、折叠为 {{TABLE_k|rows×cols}} 占位符
  //     ——k = 文档序编号（1 起、跳过 [hidden] 表，与 styled 趟 __u2mCollectTables
  //     /__u2mFoldTables 一致，保证两版 k 对齐）。行 = 本表自身的 <tr> 数（嵌套
  //     表格的行归属其最近的 table、不计入外层），列 = 各行「单元格 colspan 之和」
  //     的最大值（网格列数而非单元格个数）；形状在 K2 前预计算（colspan 属性彼时
  //     尚在）。步骤 3 以行列规模判读表格；成功表的原文存 2_tables.json、步骤 8
  //     还原，全表在后续步骤从带样式版保真（成功表带样式版也折叠为同形占位符）。
  //     带 hidden 的 table 由 K5 独占折叠（其构成 token 已就位），跳过防二次覆盖
  var tables = document.querySelectorAll('table');
  var tableK = 0;
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue;
    tableK++;
    var shape = tb.__u2mTableShape;
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    tb.appendChild(document.createTextNode('{{TABLE_' + tableK + '|' + shape.rows + '×' + shape.cols + '}}'));
  }

  // K7. pre 折叠（仅清洗版，map 驱动）：codeFold 由 clean_snapshot.mjs 按收集
  //     结果构造（含 failed 条目——clean 无条件折叠全部非 hidden pre，镜像 K6
  //     对表的处理）。map 未命中（防御分支，编排层保证收集全覆盖，理论不可达）
  //     → 退回 {{PRE_CODE_TAG|n_lines}} 局部计数（__u2mPreLines 占位前预计算），
  //     不占 k 编号、不参与还原链。clean 趟 <style> 已删、computed display 退化
  //     为 UA 默认，无法本地重算 walkLines——行数必须来自 styled 趟收集结果
  //     （附带修正：grid 行容器形态不再塌缩为 1 行）。
  //     带 hidden 的 pre 由 K5 独占折叠（其折叠 token 已就位），跳过防二次覆盖
  var codeFold = cfg.codeFold || {};
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden')) continue;
    var langShell = pre.querySelector('code[data-language]');
    if (langShell && !pre.hasAttribute('data-language')) {
      pre.setAttribute('data-language', langShell.getAttribute('data-language'));
    }
    var fr = codeFold[pre.getAttribute('data-idx') || ''];
    if (fr) {
      if (fr.lang && !pre.hasAttribute('data-language')) {
        pre.setAttribute('data-language', fr.lang);
      }
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(document.createTextNode('{{CODE_' + fr.k + '|' + fr.lines + '_lines}}'));
    } else {
      var lines = pre.__u2mPreLines;
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(document.createTextNode('{{PRE_CODE_TAG|' + lines + '_lines}}'));
    }
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

  // K10. 空壳 span 拆包（仅清洗版）：K2 已剥 style/class 等，「只剩
  //     data-idx」一个属性的 span 是纯行内包装，对步骤 3（key id 识别）
  //     无语义；解包把子节点并入父块——内容不丢、只粒度变粗，省 step 3
  //     输入字节（实测微信页 ~133KB clean 省 ~30KB）。与步骤 6 规则⑥同款
  //     拆包机制，但彼处带保护集（key 元素不拆）、此处 step 2
  //     在 step 3 之前无保护集——裸 span 是行内包装、内容流入可选块级父
  //     （p/section/h2-h6 等，实测占绝大多数），无内容丢失。
  //     仅 clean 趟执行：带样式版保留这些 span——其 style 携 font-weight/
  //     color 供步骤 5 finalize 保留与步骤 7 LLM 判粗体/颜色，不能拆。孪生
  //     id 集由此由「相等」放宽为 clean ⊆ styled（step 3 在子集挑、step 4
  //     在超集查恒命中）；clean 趟长文本占位在 K10 之后才执行（2026-09-03
  //     后置），拆包挪的是原文文本节点；styled 趟不受影响（K10 仅 clean）。
  //     嵌套空壳 span 迭代到不动点（≤10 轮）。
  //     span 限定——div 等块级可能承 trans2img 模块边界，不碰。
  for (var round = 0; round < 10; round++) {
    var bareSpans = document.querySelectorAll('span');
    var changed = false;
    for (var i = 0; i < bareSpans.length; i++) {
      var sp = bareSpans[i];
      if (!sp.isConnected) continue;
      var bare = true;
      for (var j = 0; j < sp.attributes.length; j++) {
        if (sp.attributes[j].name !== 'data-idx') { bare = false; break; }
      }
      if (!bare) continue;
      var spPar = sp.parentNode;
      if (!spPar) continue;
      while (sp.firstChild) spPar.insertBefore(sp.firstChild, sp);
      spPar.removeChild(sp);
      changed = true;
    }
    if (!changed) break;
  }

  // K11. 纯视图文本折叠（仅清洗版，2026-09-02；2026-09-03 门槛修订 + 去 LT
  //     限制 + p>span 形态 + 行内允许集扩展）：极大「纯视图子树」——子树只含
  //     div + 行内文本类元素 + 文本/注释节点（div 根档），或 p 根的「仅行内
  //     集」子树（图表轴刻度、图解步骤、对比卡片、KaTeX 视觉孪生等可视模块
  //     的内部文本碎片）——整棵内容折叠为单个 {{VIEW_TEXT|n_chars/n_words}}
  //     占位符。对步骤 3 这些碎片是噪声（可视模块整棵标记、内部不拆）。机制
  //     照 K5 HIDDEN_TAG：壳保留（标签 + K2 白名单属性——data-idx 可引用、
  //     class/aria-label 标识模块身份），仅清空子树换占位符；无编号、不进恢
  //     复清单——原文在带样式版（步骤 4-8 输入源完全不动，trans2img/还原链
  //     零影响），clean 版占位符不被任何后续步骤消费。
  //     极大性 = 父不纯 → 折叠永不吸收纯结构之外的兄弟/内容（div>p/table 等
  //     语义标签是天然边界）。
  //     行内允许集（2026-09-03 四次修订）：a/strong/b/em/i/code/br/MathML +
  //     同族 u/s/mark/small/sub/sup/abbr/cite/q/kbd/samp/time（与 K9
  //     INLINE_TAGS 同族、剔 img——图片是"此处有图"内容信号，不入允许集仍
  //     阻断）。math 整棵放行：MathML 内部（mi/mo/mn/semantics 等）不逐一检
  //     查——公式渲染内容，LaTeX 还原链走带样式版（步骤 6 才是 math 消费
  //     者），clean 版整块可折。扩展仅限行内元素——块级/语义标签（ul/table/
  //     pre/h4-h6 等）不入允许集、天然阻断，步骤 3 的结构判读不受影响。
  //     折叠门槛（两道，2026-09-03——只折「结构脚手架明显 + 文本量达标」的
  //     子树，短小内容如 {{VIEW_TEXT|3_words}} 不再产生）：
  //     ① 文本量：被折部分 ≥8 汉字 / ≥6 词（viewTextSize 逐节点求和语义，
  //       与占位符后缀同源；K11 先于 LT 执行，量的就是原文）；
  //     ② 结构量（按形态分档）：纯 div 树内部 div > 6；含行内元素的树
  //       div/行内合计 > 4（span 包裹内容如 katex 孪生更易达标）——结构门
  //       槛同时保证折叠恒有字节收益（≥5 个内部元素的序列化远超占位符
  //       ~20B），不再需要独立的 innerHTML 阈值。
  //     含长文本的模块整棵折叠、原文随折吞没（2026-09-03 四次修订：K11 先于
  //     LT 执行——clean 版根本不为模块内长文本生成占位符；三次修订的「LT
  //     随折吞没」是同效的旧实现）——孪生守卫为 clean LT 后缀 ⊆ styled：
  //     步骤 3 少看见模块内 LT（可视模块整块标记、内部本就不拆），还原链走
  //     带样式版不受影响。纯 LT 文本行（0 内部元素）过不了结构门槛、天然不折。
  //     p>span 形态（2026-09-03 新增）：p 通常不嵌 p、只含 text 或行内元素
  //     ——p 作为折叠根独立一档，纯性 = 子树只含文本与行内集（div/p/img 等
  //     任何其他标签阻断），结构门槛沿用行内档（行内 > 4）。p 不入纯树的
  //     允许集——否则正文段落流 <div><p>…</p><p>…</p></div> 会因 p 变纯而
  //     整块折叠（正文段落是步骤 3 的判读对象）；p 含纯行内树（如行内
  //     katex）时由 p 根整棵折叠、内部行内元素不再单独入选（折叠循环的
  //     isConnected 守卫挡掉随 p 折叠而脱离文档的候选，防双重计数）。
  //     豁免与阻断：a/button/h1-h3 后代不折（链接文本、控件可达名、标题锚点
  //     是步骤 3 的判读信号，H1-H3 豁免镜像长文本占位规则）；hidden 元素是
  //     阻断标签——K5 领地（FAQ 折叠答案等需步骤 3 标记还原），纯性判定不穿
  //     透；svg/img 等非允许标签同为天然阻断（svg/img 是步骤 3 识别
  //     "此处有图"的信号）。
  var INLINE_VIEW = { SPAN: 1, A: 1, STRONG: 1, B: 1, EM: 1, I: 1, CODE: 1, BR: 1,
    U: 1, S: 1, MARK: 1, SMALL: 1, SUB: 1, SUP: 1, ABBR: 1, CITE: 1, Q: 1, KBD: 1,
    SAMP: 1, TIME: 1 };
  // 结构门槛计数选择器：div + 行内集全集 + math（math/br 各计 1——每个公式
  // /换行都是序列化字节；与 INLINE_VIEW 同集另加 math）
  var VIEW_COUNT_SEL = 'div, span, a, strong, b, em, i, code, br, u, s, mark, small, sub, sup, abbr, cite, q, kbd, samp, time, math';
  function pureView(node, spanOnly, isRoot) {
    if (node.nodeType === 3 || node.nodeType === 8) return true;
    if (node.nodeType !== 1) return false;
    if (node.hasAttribute && node.hasAttribute('hidden')) return false;
    var tag = node.tagName.toUpperCase();
    if (tag === 'MATH') return true;                                // MathML 整棵放行（内部不逐一检查）
    if (spanOnly) { if (INLINE_VIEW[tag] !== 1 && !isRoot) return false; }  // p 根：根放行、子树仅行内集
    else if (tag !== 'DIV' && INLINE_VIEW[tag] !== 1) return false;        // p 不入纯树（正文保护）
    var kids = node.childNodes;
    for (var vi = 0; vi < kids.length; vi++) {
      if (!pureView(kids[vi], spanOnly, false)) return false;
    }
    return true;
  }
  // 视图子树规模：逐文本节点求和——K9 已删 div 间空白，textContent 连接会把
  // 刻度行 "0/2.5k/5k…" 并成无分隔串、词数塌缩为 1；按节点计词/计字才反映
  // 真实文本量（单文本节点时与 sizeSuffix 语义一致）
  function viewTextSize(root) {
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var texts = [], tn;
    while ((tn = tw.nextNode())) {
      var t = tn.textContent.trim();
      if (t !== '') texts.push(t);
    }
    var joined = texts.join('');
    var n = 0, i;
    if (CJK_RE.test(joined)) {
      for (i = 0; i < texts.length; i++) n += texts[i].length;
      return { n: n, unit: 'chars' };
    }
    for (i = 0; i < texts.length; i++) n += texts[i].split(/\s+/).length;
    return { n: n, unit: 'words' };
  }
  var viewAll = document.querySelectorAll('div, span, p');
  var viewRoots = [];
  for (var i = 0; i < viewAll.length; i++) {
    var vr = viewAll[i];
    if (!vr.isConnected || vr.hasAttribute('hidden')) continue;
    var spanOnly = vr.tagName.toUpperCase() === 'P';
    if (!pureView(vr, spanOnly, true)) continue;                   // 子树不纯
    var vp = vr.parentElement;
    if (vp && pureView(vp, false, false)) continue;                // 非极大——随上层折叠（p 根父必含 p → 恒极大）
    if (vr.closest('a, button, h1, h2, h3')) continue;             // 豁免：判读信号载体
    var vs = viewTextSize(vr);
    if (vs.n < (vs.unit === 'chars' ? 8 : 6)) continue;            // ① 文本量门槛
    var innerDivs = vr.querySelectorAll('div').length;             // ② 结构门槛（形态分档）
    var innerAll = vr.querySelectorAll(VIEW_COUNT_SEL).length;     // 行内集全集计入（math/br 各 1）
    if (innerDivs === innerAll ? innerDivs <= 6 : innerAll <= 4) continue;
    vr.__u2mViewFold = { n: vs.n, unit: vs.unit };                 // 门槛用过的规模，折叠直接复用
    viewRoots.push(vr);
  }
  var viewTextCount = 0;
  for (var i = 0; i < viewRoots.length; i++) {
    var ve = viewRoots[i];
    if (!ve.isConnected) continue;                                 // 已随外层折叠（p 根与内部 span 同时入选）
    var fold = ve.__u2mViewFold;
    while (ve.firstChild) ve.removeChild(ve.firstChild);
    ve.appendChild(document.createTextNode('{{VIEW_TEXT|' + fold.n + '_' + fold.unit + '}}'));
    viewTextCount++;
  }

  // 9c. 长文本占位（clean 趟，无编号，K11 之后执行）：纯视图模块已整棵折叠
  //     （viewTextSize 量的就是原文），幸存文本节点再按阈值占位——
  //     {{LONG_TEXT|n_unit}}，步骤 3 只看结构+体量信号；恢复清单只来自
  //     带样式版（styled 趟 foldLongText(true)），此趟不收集。K6/K7 已把
  //     table/pre 全折（clean 无条件折叠），幸存者 = 段落/标题/列表等流文本
  foldLongText(false);

  // （原步骤 19 R6 juice 隐藏折叠已废除：样式检测管线整体移除，隐藏折叠由
  //   上方 K5 以 hidden 裸属性零样式计算实现）

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    stats: { hiddenCount: hiddenCount, viewTextCount: viewTextCount }
  };
}
