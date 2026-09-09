/**
 * 步骤 5 页面内清场函数。在浏览器 evaluate 中执行，签名
 * __u2mFinalizeInline(computedMap)——computedMap 来自
 * page-collect-fn-values.js + page-resolve-computed.js 的函数值真实化管线
 * （{ "<data-idx>": { "<prop>": "<计算值>" } }），可为空对象。
 * 终态约束：样式仅存于内联 style 属性，只留明显结构化的样式，且零函数
 * 间接引用（var()/color-mix()/calc() 一律不出现在终态值里）。
 *  1. 白名单清理（逐元素遍历 CSSOM 声明，倒序删除防索引漂移）：
 *     仅保留——边框背景（border、outline、background、box-shadow）、
 *     flex 与 grid 布局（display、flex、grid、gap、对齐、order）、
 *     滚动裁剪（overflow、overflow-x/y）、transform、font-size 与
 *     font-weight（步骤 7 LLM 判标题层级的信号）、position:absolute
 *     （步骤 7 LLM 判特殊定位元素的信号——浮层/装饰/trans2img 候选；
 *     唯一按值门控的白名单项，仅 absolute 存活，relative/fixed/
 *     sticky/static 一律删）；长属性按前缀匹配覆盖（如 border- 前缀
 *     同时覆盖 border-radius 等长属性）。
 *     其余全删：盒模型几何（box-sizing、宽高、min/max、margin、padding；
 *     唯一例外——<img> 的 width/height 保留，见下）、
 *     定位其余（relative/fixed/sticky/static、inset、z-index）、浮动、
 *     多栏、替换元素几何（aspect-ratio、object-fit）、块级视觉
 *     （opacity、clip-path）、字体与文本类其余（font-family、
 *     font-style、line-height、letter-spacing、word-spacing、color、
 *     text、white-space、word-break、overflow-wrap、vertical-align 等）、
 *     交互（cursor、user-select）、动画（transition、animation）、厂商
 *     前缀、自定义属性；值为 inherit 的声明同样删除。清空后移除 style
 *     属性。白名单按属性判定而非按元素——行内元素（如高亮 span）的背景
 *     同样保留；唯一元素级例外是 <img>：宽高保留（步骤 7 LLM 判图片权重
 *     的信号——小图标 / 大图 / 图片组）。
 *  1.5 函数值替换：声明值含 var()/color-mix()/calc() 时——白名单内且
 *     computedMap 有该元素该属性的计算值 → setProperty(真实值)（浏览器
 *     在原样式页上解析出的具体色值/solid/px）；否则（白名单外、或两版
 *     DOM 不一致导致无计算值）removeProperty——残留非法值（如 juice 弄丢
 *     颜色空间参数的 color-mix）浏览器会整条丢弃，不如删净，保证终态
 *     零函数间接引用。
 *  1.7 零值声明过滤：白名单内值等于全元素初始值的声明删除——边框按"边"
 *     语义（style none/缺省/initial/unset 或 width 0 → 该边三件全删；
 *     bare 简写 border-width/style/color 按四边全灭判——border-color:
 *     currentcolor 只在四边全灭时删，边存活时留着维持 border: 简写紧凑
 *     序列化）、outline 同理、box-shadow:none、background-color:
 *     transparent（含 rgba(0,0,0,0) 计算形）、background-image:none、
 *     border-image 初始值（简写展开的五个 longhand，四边全灭才删）、
 *     radius:0px、overflow:visible、transform:none、<img> 宽高值 auto
 *     （auto 是初始值无信号量，真实像素宽高保留——步骤 7 图片权重信号）。
 *     flex 布局信号不是零值，保留；font-size/weight 见 1.11 继承等值修剪。
 *     函数值替换出的初始值同受此表过滤——替换整趟先落定（1.5），过滤
 *     在落定后的块上整趟跑（带 var 的简写在 CSSOM 里 longhand 读作空串，
 *     同趟混跑会把尚未替换的边误判成缺省样式而连带删掉实边）
 *  1.8 CSS 关键字零值：非继承属性上 initial/unset = 写了等于没写——
 *     finalize 末尾 <style>/class 已删净、内联样式是唯一级联源，关键字
 *     声明与不声明计算结果恒同，删。白名单内唯一继承属性 font-size/
 *     font-weight 例外分流：unset≡inherit（默认行为，同既有 inherit
 *     删除）、initial 阻断继承（有意义，保留）；display 不走本规则
 *     （display:initial=inline 在块级标签上是真布局信号，行内标签见 1.9）
 *  1.9 UA 默认 display：行内为 UA 默认的标签集（span/a/strong/em/code
 *     等 INLINE_DEFAULT_TAGS）上 display:inline 删——写了等于没写；
 *     div 等块级标签上的 inline 是真信号、inline-block 等非默认值一律保留
 *  1.10 背景噪音两组（微信页面实测每 chunk ~14KB 长手簇 + ~4KB 白底）：
 *     - 无图长手簇——无有效 background-image 时 position(含 -x/-y)/size/
 *       repeat/attachment/origin 无论何值全删（无图可绘制则零视觉效果，
 *       含非初始的 no-repeat/left top），clip 仅删初始 border-box（clip
 *       同时影响纯色绘制，padding-box/text 等保留）；有图时按初始值形删
 *       （0% 0%/left top/auto/repeat/scroll/padding-box）
 *     - 画布等值——元素 background-color（或 bare background 简写的纯色
 *       值/none）与有效背景精确相等则删：白底页面刷白、黑卡上黑 span 都是
 *       视觉零效果。有效背景 = 最近祖先非透明 background-color，全透明则
 *       画布白（浏览器默认底色）；灰卡上的白 span 保留（其背景是卡片而
 *       非画布）；body 自身声明对 html/白比较，深色画布源不被误删。
 *       修剪与顺序无关：只删与有效背景相等的声明，祖先行修剪后有效背景
 *       不变（其被删声明本就等于更上层的背景）
 *  1.11 继承等值 font 修剪：font-size/font-weight 是继承属性——声明与
 *     继承有效值相等的是纯重复，删（normal≡400、bold≡700、medium≡16px
 *     归一比较，最近祖先声明链上溯、根默认 16px/400）。只删重复、对比点
 *     全保留：bold 下的 400 重置、17px 下的 18px 等步骤 7 需要的层级/
 *     强调信号零损失；em/%/bolder 等不可比形态保守保留。修剪与顺序无关：
 *     只删与有效值相等的声明，祖先行修剪后有效值不变
 *  2. 删除全部 <style> 标签与 class 属性
 * 供 juice 版输出收尾（juice 已内联规则并移除 <style>，此处清理与兜底）。
 * 在浏览器里删而非在 Node 里正则替换：正文若含字面 class="..." 等文本，
 * 正则会误伤；CSSOM 解析出的声明天然不会混入正文。
 */
function __u2mFinalizeInline(computedMap) {
  // 函数间接引用检测：与 page-collect-fn-values.js 的 FUNC_RE 保持一致
  var FUNC_RE = /var\(|color-mix\(|calc\(/i;
  // 结构化样式白名单：前缀匹配（border- 覆盖 border-radius 等长属性）
  var KEEP_PREFIX = ['border-', 'outline-', 'background-',
    'flex-', 'grid-', 'align-', 'justify-', 'place-'];
  var KEEP_EXACT = {
    'display': 1,
    'border': 1, 'outline': 1, 'background': 1, 'box-shadow': 1,
    'flex': 1, 'gap': 1, 'row-gap': 1, 'column-gap': 1, 'order': 1,
    'justify-content': 1, 'align-items': 1, 'align-content': 1, 'align-self': 1,
    'place-items': 1, 'place-content': 1, 'place-self': 1,
    // overflow 精确到 x/y：overflow- 前缀会把文本换行的 overflow-wrap 放进来
    'overflow': 1, 'overflow-x': 1, 'overflow-y': 1,
    'transform': 1,
    // 字体类仅留这两个：步骤 7 LLM 判 div→h2 层级的信号
    'font-size': 1, 'font-weight': 1
  };
  function keep(prop) {
    if (KEEP_EXACT[prop]) return true;
    for (var k = 0; k < KEEP_PREFIX.length; k++) {
      if (prop.indexOf(KEEP_PREFIX[k]) === 0) return true;
    }
    return false;
  }
  // position 按值门控：仅 absolute 保留（步骤 7 特殊定位元素信号）。
  // 其余 position 值（relative/fixed/sticky/static）不在此返 true，落入
  // 第二趟「不在白名单」删除。val 取该趟已落定的值——第一趟用解析后的
  // real（var() 驱动时按计算值判定，与其他白名单属性解析 var() 一致），
  // 第二趟用 val2（字面或已被第一趟替换为字面的绝对值）。
  function keepPosition(prop, val) {
    return prop === 'position' && val === 'absolute';
  }
  // 零值声明：值等于全元素初始值——写与不写等价，纯非信息（参考页
  // 1,946 个元素的 style 值只有 border: 0px solid——Tailwind preflight
  // 被 juice 内联的产物）。边框按"边"语义：style none（显式或缺省——
  // 缺省即 initial none；initial/unset 关键字计算后同为 none）或 width 0
  // → 该边三件全删，宽 0 或样式 none 的边无论其余声明什么都不可见；
  // style 实值 + width 缺省 = medium+solid 可见边框，保留。
  // flex 布局信号不是零值；font-size/weight 走 1.11 继承等值修剪
  var NO_STYLE = {'none': 1, '': 1, 'initial': 1, 'unset': 1};
  function sideVoid(st, side) {
    var style = st.getPropertyValue('border-' + side + '-style');
    var width = st.getPropertyValue('border-' + side + '-width');
    return NO_STYLE[style] === 1 || width === '0px' || width === '0';
  }
  function outlineVoid(st) {
    var style = st.getPropertyValue('outline-style');
    var width = st.getPropertyValue('outline-width');
    return NO_STYLE[style] === 1 || width === '0px' || width === '0';
  }
  // 1.8 CSS 关键字零值：内联是唯一级联源后（<style>/class 已删净），
  // 非继承属性上 initial/unset 与不声明计算结果恒同。font-size/font-weight
  // （白名单内唯一继承属性）分流：unset≡inherit 删、initial 阻断继承保留；
  // display 不走本规则（见 1.9 标签门控）
  var INHERITED_PROPS = {'font-size': 1, 'font-weight': 1};
  function keywordVoid(prop, val) {
    if (val !== 'initial' && val !== 'unset') return false;
    if (prop === 'display') return false;
    if (INHERITED_PROPS[prop]) return val === 'unset';
    return true;
  }
  // 1.9 UA 默认 display:inline 的行内标签集——写了等于没写；button/input
  // 等 UA 默认 inline-block 的标签不在集内（inline 对它们是改布局的真信号）
  var INLINE_DEFAULT_TAGS = {
    'span': 1, 'a': 1, 'strong': 1, 'b': 1, 'em': 1, 'i': 1, 'code': 1,
    'small': 1, 'big': 1, 'mark': 1, 'sub': 1, 'sup': 1, 'kbd': 1, 'samp': 1,
    'var': 1, 'label': 1, 'abbr': 1, 'cite': 1, 'q': 1, 's': 1, 'u': 1,
    'del': 1, 'ins': 1, 'time': 1, 'data': 1, 'bdi': 1, 'bdo': 1, 'ruby': 1,
    'rt': 1, 'rp': 1, 'output': 1, 'font': 1, 'nobr': 1, 'br': 1,
    'svg': 1, 'math': 1
  };
  // 1.10 背景长手簇：这些属性只服务于 background-image 的绘制——无图时
  // 无论何值零视觉效果；有图时仅初始值形是零效果。clip 例外单判（影响纯色）
  var BG_IMAGE_DEPS = {
    'background-position': 1, 'background-position-x': 1, 'background-position-y': 1,
    'background-size': 1, 'background-repeat': 1, 'background-attachment': 1,
    'background-origin': 1
  };
  var BG_INITIAL_FORMS = {
    'background-position': {'0% 0%': 1, 'left top': 1, '0px 0px': 1},
    'background-position-x': {'0%': 1, 'left': 1, '0px': 1},
    'background-position-y': {'0%': 1, 'top': 1, '0px': 1},
    'background-size': {'auto': 1},
    'background-repeat': {'repeat': 1},
    'background-attachment': {'scroll': 1},
    'background-origin': {'padding-box': 1}
  };
  function hasRealImage(st) {
    var img = st.getPropertyValue('background-image');
    return img !== '' && img !== 'none';
  }
  // 1.10 画布等值：有效背景 = 最近祖先非透明 background-color，全透明则
  // 浏览器默认画布白。值比较靠 CSSOM 归一（两侧同经 getPropertyValue 读出）
  function normColor(v) { return (v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  var TRANSPARENT_BG = {'': 1, 'transparent': 1, 'rgba(0, 0, 0, 0)': 1};
  function backdropOf(el) {
    var p = el.parentElement;
    while (p) {
      var v = p.style ? normColor(p.style.getPropertyValue('background-color')) : '';
      if (TRANSPARENT_BG[v] !== 1) return v;
      p = p.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }
  // 1.11 继承等值 font 修剪：normal≡400、bold≡700、medium≡16px 归一后与
  // 最近祖先声明（无则根默认）比较；em/%/bolder 等不可比形态保守保留
  var FONT_NORM = {'normal': '400', 'bold': '700', 'medium': '16px'};
  function normFont(v) { v = (v || '').trim().toLowerCase(); return FONT_NORM[v] || v; }
  function inheritedFont(el, prop) {
    var p = el.parentElement;
    while (p) {
      var v = p.style ? p.style.getPropertyValue(prop) : '';
      if (v !== '') return normFont(v);
      p = p.parentElement;
    }
    return prop === 'font-weight' ? '400' : '16px';
  }
  function fontVoid(el, prop, val) {
    var n = normFont(val);
    if (prop === 'font-weight') {
      if (!/^[0-9]+$/.test(n)) return false;
    } else if (!/^[0-9.]+px$/.test(n)) return false;
    return n === inheritedFont(el, prop);
  }
  function isVoidDeclaration(el, prop, val, st) {
    if (keywordVoid(prop, val)) return true;
    if (prop === 'display') {
      return val === 'inline' && INLINE_DEFAULT_TAGS[el.tagName.toLowerCase()] === 1;
    }
    // 1.7 img 宽高例外中的 auto 值：初始值且无信号量（真实像素才判权重）
    if ((prop === 'width' || prop === 'height') && val === 'auto') return true;
    if (prop === 'transform') return val === 'none';
    // bare 简写（无方位捕获组）按四边全灭判；逐边形态按该边判。
    // currentcolor 是 border-color 初始值：边灭时纯残渣，边存活时留着
    // 维持简写紧凑序列化（镜像 border-image 逻辑）
    var m = /^border-(?:(top|right|bottom|left)-)?(width|style|color)$/.exec(prop);
    if (m) {
      if (m[1]) return sideVoid(st, m[1]);
      return sideVoid(st, 'top') && sideVoid(st, 'right') &&
        sideVoid(st, 'bottom') && sideVoid(st, 'left');
    }
    if (prop === 'outline-style' || prop === 'outline-width' || prop === 'outline-color') {
      return outlineVoid(st);
    }
    if (prop === 'border-image' || prop.indexOf('border-image-') === 0) {
      // border/border-image 简写在 CSSOM 展开为五个初始值 longhand（source
      // none / slice 100% / width 1 / outset 0 / repeat stretch），逐件判初始
      // 值后还要过"四边全灭"闸门：边全灭时它们是纯残渣，删了 style 属性才
      // 清得空；边存活的元素必须留着——cssText 靠 17 件齐全才维持 border: X
      // 简写紧凑形，删任一件都会退化成 border-width/style/color 逐件序列化
      var imgInitial = val === 'none' ||
        (prop === 'border-image-slice' && val === '100%') ||
        (prop === 'border-image-width' && val === '1') ||
        (prop === 'border-image-outset' && (val === '0' || val === '0px')) ||
        (prop === 'border-image-repeat' && val === 'stretch');
      return imgInitial && sideVoid(st, 'top') && sideVoid(st, 'right') &&
        sideVoid(st, 'bottom') && sideVoid(st, 'left');
    }
    if (prop === 'border-radius' ||
        /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.test(prop)) {
      return val === '0px';
    }
    if (prop === 'box-shadow') return val === 'none';
    if (prop === 'background-clip') return val === 'border-box';
    if (BG_IMAGE_DEPS[prop]) return !hasRealImage(st) || BG_INITIAL_FORMS[prop][val] === 1;
    if (prop === 'background-color' || prop === 'background') {
      // bare background 简写只有纯色值/none 会命中等值比较，含图/多件形态保留
      var nv = normColor(val);
      return TRANSPARENT_BG[nv] === 1 || nv === 'none' || nv === backdropOf(el);
    }
    if (prop === 'background-image') return val === 'none';
    if (prop === 'font-size' || prop === 'font-weight') return fontVoid(el, prop, val);
    if (prop === 'overflow' || prop === 'overflow-x' || prop === 'overflow-y') {
      return val === 'visible';
    }
    return false;
  }
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    // pre 子树内样式对最终 markdown 无语义——仅文本与 data-language 是步骤 7
    // 所需。高亮 token span 携 font-weight/background/border 等白名单内幸存
    // 样式，若流进步骤 7 会让 LLM 误产 **bold** 损坏代码。pre 子树内直接剥净
    // 全部内联样式（跳过白名单/函数值/零值三趟），token span 变 bare 由步骤 6
    // 规则⑥（既有、不改）解包为纯文本。pre 外的 font-weight（标题层级信号）
    // 不受影响、仍按白名单保留。
    if (styled[i].closest('pre')) {
      styled[i].removeAttribute('style');
      continue;
    }
    // table 子树内全部内联样式删净（表格占位符设计）：成功表已折叠为文本节点、
    // 无 [style] 单元格子树 → 此分支对它们 no-op；仅命中失败 live 表
    //（data-u2m-table="fail" 或 styled 趟保留 live 的表）——剥净 border/
    // background/box-shadow 等，到 6_article.html 只剩结构+文本+长文本占位符
    // 供步骤 7 LLM 语义还原。
    if (styled[i].closest('table')) {
      styled[i].removeAttribute('style');
      continue;
    }
    var st = styled[i].style;
    // 唯一元素级例外：<img> 的宽高保留——步骤 7 LLM 判图片权重的
    // 语义信号（小图标 / 大图 / 图片组）；值为 inherit 的照样删
    var isImg = styled[i].tagName === 'IMG';
    var idx = styled[i].getAttribute('data-idx');
    var dirty = false;
    for (var j = st.length - 1; j >= 0; j--) {
      var prop = st.item(j).toLowerCase();
      var val = st.getPropertyValue(prop);
      // real 提到 if 外：position 按值门控要用解析后的计算值判定
      // （var() 驱动时取真实值，与 border 等白名单属性解析 var() 一致）
      var real = computedMap && computedMap[idx] && computedMap[idx][prop];
      var keepThis = keep(prop) ||
        (isImg && (prop === 'width' || prop === 'height')) ||
        keepPosition(prop, real);
      // 第一趟：函数值替换（白名单内且有计算值）或删净（否则）——机制见
      // 头注 1.5。空串值同路：简写属性带 var 在本页展开为 longhand 且值为
      // 空（收集侧见 page-collect-fn-values.js 头注），不替换就会把 var()
      // 文本漏进终态。必须整趟先落定再跑第二趟过滤：var 替换发生在同趟更
      // 早位置时，尚未替换的 style longhand 读作空串、会被零值表连带误删
      // 同边的 width/color
      if (FUNC_RE.test(val) || val === '') {
        if (keepThis && real) st.setProperty(prop, real);
        else st.removeProperty(prop);
        dirty = true;
      }
    }
    // 第二趟：白名单 / inherit / 零值过滤（头注 1 与 1.7）——在函数值已
    // 落定的块上判定，var 解析出的 none/0px/transparent 等初始值同受
    // 零值表约束，不因替换趟的顺序存活
    for (var j2 = st.length - 1; j2 >= 0; j2--) {
      var prop2 = st.item(j2).toLowerCase();
      var val2 = st.getPropertyValue(prop2);
      var keepThis2 = keep(prop2) ||
        (isImg && (prop2 === 'width' || prop2 === 'height')) ||
        keepPosition(prop2, val2);
      if (!keepThis2 || val2 === 'inherit' || isVoidDeclaration(styled[i], prop2, val2, st)) {
        st.removeProperty(prop2);
        dirty = true;
      }
    }
    // 只在确有删除时改写：CSSOM 重序列化会把值归一化
    // （#f0f0f0 → rgb(240, 240, 240)、0 → 0px），全合规的元素保持字面输出
    if (dirty && st.length === 0) styled[i].removeAttribute('style');
  }

  var styleEls = document.querySelectorAll('style');
  for (var i = styleEls.length - 1; i >= 0; i--) {
    styleEls[i].parentNode.removeChild(styleEls[i]);
  }
  var withClass = document.querySelectorAll('[class]');
  for (var i = 0; i < withClass.length; i++) {
    withClass[i].removeAttribute('class');
  }
  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    styledCount: document.querySelectorAll('[style]').length
  };
}
