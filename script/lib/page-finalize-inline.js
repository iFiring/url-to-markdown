/**
 * 步骤 5 页面内清场函数。在浏览器 evaluate 中执行。
 * 终态约束：样式仅存于内联 style 属性，且只留明显结构化的样式。
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
 *  2. 删除全部 <style> 标签与 class 属性
 * 供 juice 版输出收尾（juice 已内联规则并移除 <style>，此处清理与兜底）。
 * 在浏览器里删而非在 Node 里正则替换：正文若含字面 class="..." 等文本，
 * 正则会误伤；CSSOM 解析出的声明天然不会混入正文。
 */
function __u2mFinalizeInline() {
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
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    var st = styled[i].style;
    // 唯一元素级例外：<img> 的宽高保留——步骤 7 LLM 判图片权重的
    // 语义信号（小图标 / 大图 / 图片组）；值为 inherit 的照样删
    var isImg = styled[i].tagName === 'IMG';
    var dirty = false;
    for (var j = st.length - 1; j >= 0; j--) {
      var prop = st.item(j).toLowerCase();
      var val = st.getPropertyValue(prop);
      var keepThis = keep(prop) ||
        (isImg && (prop === 'width' || prop === 'height'));
      if (!keepThis || val === 'inherit') {
        st.removeProperty(prop);
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
