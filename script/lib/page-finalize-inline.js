/**
 * 步骤 5 页面内清场函数。在浏览器 evaluate 中执行，签名
 * __u2mFinalizeInline(computedMap)——computedMap 来自
 * page-collect-fn-values.js + page-resolve-computed.js 的函数值真实化管线
 * （{ "<data-u2m-id>": { "<prop>": "<计算值>" } }），可为空对象。
 * 终态约束：样式仅存于内联 style 属性，只留明显结构化的样式，且零函数
 * 间接引用（var()/color-mix()/calc() 一律不出现在终态值里）。
 *  1. 白名单清理（逐元素遍历 CSSOM 声明，倒序删除防索引漂移）：
 *     仅保留——边框背景（border、outline、background、box-shadow）、
 *     flex 与 grid 布局（display、flex、grid、gap、对齐、order）、
 *     滚动裁剪（overflow、overflow-x/y）、transform、font-size 与
 *     font-weight（步骤 7 LLM 判标题层级的信号）；长属性按前缀匹配覆盖
 *     （如 border- 前缀同时覆盖 border-radius 等长属性）。
 *     其余全删：盒模型几何（box-sizing、宽高、min/max、margin、padding；
 *     唯一例外——<img> 的 width/height 保留，见下）、
 *     定位（position、inset、z-index）、浮动、多栏、
 *     替换元素几何（aspect-ratio、object-fit）、块级视觉（opacity、
 *     clip-path）、字体与文本类其余（font-family、font-style、
 *     line-height、letter-spacing、word-spacing、color、text、
 *     white-space、word-break、overflow-wrap、vertical-align 等）、交互
 *     （cursor、user-select）、动画（transition、animation）、厂商前缀、
 *     自定义属性；值为 inherit 的声明同样删除。清空后移除 style 属性。
 *     白名单按属性判定而非按元素——行内元素（如高亮 span）的背景同样
 *     保留；唯一元素级例外是 <img>：宽高保留（步骤 7 LLM 判图片权重的
 *     信号——小图标 / 大图 / 图片组）。
 *  1.5 函数值替换：声明值含 var()/color-mix()/calc() 时——白名单内且
 *     computedMap 有该元素该属性的计算值 → setProperty(真实值)（浏览器
 *     在原样式页上解析出的具体色值/solid/px）；否则（白名单外、或两版
 *     DOM 不一致导致无计算值）removeProperty——残留非法值（如 juice 弄丢
 *     颜色空间参数的 color-mix）浏览器会整条丢弃，不如删净，保证终态
 *     零函数间接引用。
 *  1.7 零值声明过滤：白名单内值等于全元素初始值的声明删除——边框按"边"
 *     语义（style none/缺省或 width 0 → 该边三件全删）、outline 同理、
 *     box-shadow:none、background-color:transparent（含 rgba(0,0,0,0)
 *     计算形）、background-image:none、border-image 初始值（简写展开的
 *     五个 longhand，四边全灭才删——边存活时留着维持 border: 简写紧凑
 *     序列化）、radius:0px、overflow:visible。font-size/weight 的相对
 *     对比与 flex 布局信号不是零值，保留；<img> 宽高例外不受影响。
 *     函数值替换出的初始值同受此表过滤——替换整趟先落定（1.5），过滤
 *     在落定后的块上整趟跑（带 var 的简写在 CSSOM 里 longhand 读作空串，
 *     同趟混跑会把尚未替换的边误判成缺省样式而连带删掉实边）
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
  // 零值声明：值等于全元素初始值——写与不写等价，纯非信息（参考页
  // 1,946 个元素的 style 值只有 border: 0px solid——Tailwind preflight
  // 被 juice 内联的产物）。边框按"边"语义：style none（显式或缺省——
  // 缺省即 initial none）或 width 0 → 该边三件全删，宽 0 或样式 none
  // 的边无论其余声明什么都不可见；style 实值 + width 缺省 =
  // medium+solid 可见边框，保留。font-size/weight 的相对对比与
  // flex 布局信号不是零值，不在本表
  function sideVoid(st, side) {
    var style = st.getPropertyValue('border-' + side + '-style');
    var width = st.getPropertyValue('border-' + side + '-width');
    return style === 'none' || style === '' || width === '0px' || width === '0';
  }
  function outlineVoid(st) {
    var style = st.getPropertyValue('outline-style');
    var width = st.getPropertyValue('outline-width');
    return style === 'none' || style === '' || width === '0px' || width === '0';
  }
  function isVoidDeclaration(prop, val, st) {
    var m = /^border-(top|right|bottom|left)-(width|style|color)$/.exec(prop);
    if (m) return sideVoid(st, m[1]);
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
    if (prop === 'background-color') {
      return val === 'transparent' || val === 'rgba(0, 0, 0, 0)';
    }
    if (prop === 'background-image') return val === 'none';
    if (prop === 'overflow' || prop === 'overflow-x' || prop === 'overflow-y') {
      return val === 'visible';
    }
    return false;
  }
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    var st = styled[i].style;
    // 唯一元素级例外：<img> 的宽高保留——步骤 7 LLM 判图片权重的
    // 语义信号（小图标 / 大图 / 图片组）；值为 inherit 的照样删
    var isImg = styled[i].tagName === 'IMG';
    var u2mId = styled[i].getAttribute('data-u2m-id');
    var dirty = false;
    for (var j = st.length - 1; j >= 0; j--) {
      var prop = st.item(j).toLowerCase();
      var val = st.getPropertyValue(prop);
      var keepThis = keep(prop) ||
        (isImg && (prop === 'width' || prop === 'height'));
      // 第一趟：函数值替换（白名单内且有计算值）或删净（否则）——机制见
      // 头注 1.5。空串值同路：简写属性带 var 在本页展开为 longhand 且值为
      // 空（收集侧见 page-collect-fn-values.js 头注），不替换就会把 var()
      // 文本漏进终态。必须整趟先落定再跑第二趟过滤：var 替换发生在同趟更
      // 早位置时，尚未替换的 style longhand 读作空串、会被零值表连带误删
      // 同边的 width/color
      if (FUNC_RE.test(val) || val === '') {
        var real = computedMap && computedMap[u2mId] && computedMap[u2mId][prop];
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
        (isImg && (prop2 === 'width' || prop2 === 'height'));
      if (!keepThis2 || val2 === 'inherit' || isVoidDeclaration(prop2, val2, st)) {
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
