/**
 * 步骤 2 隐藏子树检测。在浏览器 evaluate 中执行，跑在 juice 内联后的 DOM 上
 * （每元素的级联胜出声明已写入 style 属性、<style> 标签已移除）。
 * 语义（spec §4.2，按 CSS 规范补全 juice 不做的继承推导）：
 *   - display 不继承，但祖先 display:none 使整棵子树不生成盒 → 有效 display:none
 *     ⟺ 自身或任一祖先声明为 none；该子树不可被后代翻案，记录后停止下钻。
 *   - HTML hidden 属性 = 显式 display:none（其 UA/preflight 规则如
 *     [hidden]:where(...) juice 无法内联，故在检测器侧直接认定）。
 *   - visibility 继承，后代可 visibility:visible 重新可见 → 有效值 = 自身显式
 *     声明，否则沿用父级有效值；visibility:hidden 顶层记录后继续下钻找翻案后代。
 *   - 顶层隐藏子树：有效隐藏且父级上下文未隐藏——折叠只打在最外层。
 *   - 读值只认字面声明：值先剥 !important 后缀再字面匹配（juice 内联 <style>
 *     规则时会自己剥，但快照里作者手写的行内 style 属性原样透传，
 *     display:none !important 也是显式 none）；var() 等不可解析值按可见处理
 *     （失败方向安全——任何不完备都把元素推向保留，正文零误删）。
 * 返回 { items: [{id, chars, fixed}], totalChars, hiddenChars }：
 *   items[].id     data-u2m-id（无 id 的隐藏根不可定位，不产出）
 *   items[].chars  textContent.trim().length（真实全文规模，供 R6 标记）
 *   fixed          根声明 position:fixed|absolute（UI 脚手架提示）
 *   totalChars/hiddenChars  非空白字符数（护栏用；body 全文 / 顶层隐藏子树合计）
 */
function __u2mDetectHidden() {
  function parseDecls(styleStr) {
    var out = {};
    if (!styleStr) return out;
    var parts = styleStr.split(';');
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].indexOf(':');
      if (c === -1) continue;
      var prop = parts[i].slice(0, c).trim().toLowerCase();
      var val = parts[i].slice(c + 1).trim().toLowerCase();
      val = val.replace(/\s*!important\s*$/, '');
      if (prop) out[prop] = val;
    }
    return out;
  }
  function nonWsChars(el) {
    return (el.textContent || '').replace(/\s+/g, '').length;
  }
  var items = [];
  var hiddenChars = 0;
  function walk(el, ctx) {
    var d = parseDecls(el.getAttribute('style'));
    // HTML hidden 属性本身即「不渲染」声明，按显式 display:none 认定；
    // 其 UA/preflight 规则（如 [hidden]:where(...)）juice 无法内联，
    // 不在检测器侧认定就会整片漏折叠（与 display:none 同：不可被后代翻案）
    var displayNone = ctx.displayNone || d.display === 'none' || el.hasAttribute('hidden');
    var visHidden = d.visibility === 'hidden' ? true : (d.visibility === 'visible' ? false : ctx.visHidden);
    var hidden = displayNone || visHidden;
    if (hidden && !ctx.hidden) {
      hiddenChars += nonWsChars(el);
      var id = el.getAttribute('data-u2m-id');
      if (id !== null) {
        items.push({
          id: id,
          chars: (el.textContent || '').trim().length,
          fixed: d.position === 'fixed' || d.position === 'absolute',
        });
      }
      if (displayNone) return; // display:none 子树不可翻案
      var cc = { displayNone: displayNone, visHidden: visHidden, hidden: true };
      for (var i = 0; i < el.children.length; i++) walk(el.children[i], cc);
      return;
    }
    var c2 = { displayNone: displayNone, visHidden: visHidden, hidden: hidden };
    for (var j = 0; j < el.children.length; j++) walk(el.children[j], c2);
  }
  var ctx0 = { displayNone: false, visHidden: false, hidden: false };
  var bodyChildren = document.body.children;
  for (var k = 0; k < bodyChildren.length; k++) walk(bodyChildren[k], ctx0);
  return { items: items, totalChars: nonWsChars(document.body), hiddenChars: hiddenChars };
}
