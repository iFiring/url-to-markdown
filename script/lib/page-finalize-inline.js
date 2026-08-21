/**
 * 步骤 3.2 页面内清场函数。在浏览器 evaluate 中执行。
 * 终态约束：样式仅存于内联 style 属性，且只留有意义的声明。
 *  1. 噪声声明清理（逐元素遍历 CSSOM 声明，倒序删除防索引漂移）：
 *     - font-family
 *     - font-style（任意值，含 normal/italic/oblique）
 *     - -webkit- 前缀属性
 *     - 值为 inherit 的声明
 *     清空后的元素移除 style 属性
 *  2. 删除全部 <style> 标签与 class 属性
 * 供 juice 版输出收尾（juice 已内联规则并移除 <style>，此处清理与兜底）。
 * 在浏览器里删而非在 Node 里正则替换：正文若含字面 class="..." 等文本，
 * 正则会误伤；CSSOM 解析出的声明天然不会混入正文。
 */
function __u2mFinalizeInline() {
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    var st = styled[i].style;
    var dirty = false;
    for (var j = st.length - 1; j >= 0; j--) {
      var prop = st.item(j).toLowerCase();
      var val = st.getPropertyValue(prop);
      if (prop === 'font-family' ||
          prop === 'font-style' ||
          prop.indexOf('-webkit-') === 0 ||
          val === 'inherit') {
        st.removeProperty(prop);
        dirty = true;
      }
    }
    // 只在确有删除时改写：CSSOM 重序列化会把值归一化
    // （#f0f0f0 → rgb(240, 240, 240)、0 → 0px），无噪声的元素保持字面输出
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
