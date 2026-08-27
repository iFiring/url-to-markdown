/**
 * 步骤 8 隐藏模块强制展开。在浏览器 evaluate 中执行。
 * trans2img 模块可能处于折叠态（手风琴收起等）：步骤 2 只在清洗版折叠隐藏
 * 子树，带样式版保真——折叠内容合法流到步骤 7 并可被标 trans2img；而页 A
 * （快照，站点 CSS 已内联）与页 B（live，站点自身收起态）都把它渲染为
 * 隐藏：display:none（自身或祖先）盒为 null、max-height:0 盒高为 0，
 * el.screenshot() 自动等可见会挂到超时；更隐蔽的是被塌缩祖先裁剪的模块
 * ——自身盒正常但像素被裁空，不展开就截是空白图。
 * 对给定 data-u2m-id 的元素**无条件**自元素向 body 逐级扫一遍，**只覆写
 * 正在隐藏的属性**（行内 !important）——不能以元素自身盒作前置守卫：被
 * 塌缩祖先裁剪/visibility 隐藏的模块盒正常但像素全空，守卫会放行出空白图。
 * 各子句只在真实隐藏态触发，本就可见的链零改动：
 *   - computed display:none → block（折叠包装几乎都是普通块；模块内部
 *     flex/grid 在更深层、不在覆写之列。若站点开合态本就是 flex/grid，
 *     截图按块堆叠降级——比截不出图强）
 *   - visibility:hidden|collapse → visible；opacity:0 → 1
 *   - HTML hidden 属性 → 移除（UA 规则打不过行内 !important）
 *   - max-height:0 → none
 *   - height:0（目标自身被压扁）→ auto + overflow:visible
 *   - 塌缩裁剪者：overflowY:hidden 且 clientHeight===0 且 scrollHeight>0
 *     → max-height:none + height:auto + overflow:visible（子代像素被裁空
 *     的元凶，computed height 可能报 auto、靠 clientHeight 才抓得住）
 * 展开是截图前的渲染态修改：不动 tag/children/textContent，元素签名不受
 * 影响（签名在展开之前计算）。
 * 返回 {found, touched, box:{width,height}, boxless}——touched 为覆写处数，
 * box 为展开后量得的 CSS px 尺寸（宽高均 >0 即可截图）；boxless=true 标记
 * 目标自身为 display:contents 透明包装——规范上永不生成盒（rect 恒 0×0，
 * 与隐藏无关、覆写救不了），调用方应跳过该 id，视觉由链上其余 id 承载。
 */
function __u2mRevealHidden(id) {
  var el = document.querySelector('[data-u2m-id="' + id + '"]');
  if (!el) return { found: false, touched: 0, box: null };

  function boxOf(e) {
    var r = e.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  var touched = 0;
  for (var node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
    var cs = getComputedStyle(node);
    if (cs.display === 'none') { node.style.setProperty('display', 'block', 'important'); touched++; }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
      node.style.setProperty('visibility', 'visible', 'important'); touched++;
    }
    if (parseFloat(cs.opacity) === 0) { node.style.setProperty('opacity', '1', 'important'); touched++; }
    if (node.hasAttribute('hidden')) { node.removeAttribute('hidden'); touched++; }
    if (parseFloat(cs.maxHeight) === 0) { node.style.setProperty('max-height', 'none', 'important'); touched++; }
    // 目标自身被压扁：height:0 时子孙被裁（overflow:hidden）或溢出压扁
    if (node === el && parseFloat(cs.height) === 0) {
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      touched++;
    }
    // 塌缩裁剪者：盒高 0 却装着内容（子代盒正常但像素全被裁空）。
    // computed height 可能是 auto（flex-basis/min-height 压扁），靠
    // clientHeight 抓；只动确在裁剪的（scrollHeight>0）
    if (cs.overflowY === 'hidden' && node.clientHeight === 0 && node.scrollHeight > 0) {
      node.style.setProperty('max-height', 'none', 'important');
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      touched++;
    }
  }

  // display:contents：透明包装永不生成盒（rect 恒 0×0），非隐藏所致
  var boxless = getComputedStyle(el).display === 'contents';
  return { found: true, touched: touched, box: boxOf(el), boxless: boxless };
}
