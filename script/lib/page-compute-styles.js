/**
 * 步骤 3.2 页面内样式计算函数。在浏览器 evaluate 中执行。
 * cfg.mode:
 *   'compute'（默认）—— 在 3.1 产物上计算目标样式并内联，终态纯内联：
 *     1. 测量阶段：全量读取 getComputedStyle（此时 <style> 仍参与级联，
 *        原有内联样式原样生效）。必须先测后写——中途改任一元素的字体/
 *        颜色会污染后续元素依赖继承的计算值
 *     2. 写入阶段：style 属性整体替换为仅含目标属性；无目标属性的元素
 *        移除 style 属性
 *     3. 清场：删除全部 <style> 标签与 class 属性
 *   'strip' —— 仅执行第 3 步清场（供 juice 版输出使用：
 *     <style> 已由 juice 移除，class 在浏览器里删净）
 *
 * 目标属性（计算值为无意义默认时跳过）：
 *   - border 三属性 × 4 边：某边 border-style 为 none/hidden 整组跳过
 *   - background-color：完全透明 rgba(0, 0, 0, 0) 跳过
 *   - 纯文本元素（有非空白直接文本子节点）：font-size、font-weight 恒写；
 *     color 为黑 rgb(0, 0, 0) 跳过
 * getComputedStyle 的返回值本身就是 CSS 级联（UA/继承/特异性/!important/
 * 原内联）的最终裁决，天然符合优先级规则；var() 已解析、长度为 px、
 * 颜色为 rgb()/rgba() 归一形式。
 */
function __u2mComputeStyles(cfg) {
  cfg = cfg || {};
  var mode = cfg.mode || 'compute';

  if (mode === 'compute') {
    var BLACK = 'rgb(0, 0, 0)';
    var TRANSPARENT = 'rgba(0, 0, 0, 0)';
    var SIDES = ['top', 'right', 'bottom', 'left'];

    function isTextEl(el) {
      var nodes = el.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 3 && nodes[i].textContent.trim() !== '') return true;
      }
      return false;
    }

    // 1. 测量：先全量读计算值（<style> 与原内联此刻仍在生效）。
    //    范围限 body 及其后代——head 的 <title> 有直接文本但不是页面文本
    var plans = [];
    var all = [document.body];
    var bodyDescendants = document.body.querySelectorAll('*');
    for (var d = 0; d < bodyDescendants.length; d++) all.push(bodyDescendants[d]);
    var styledCount = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cs = window.getComputedStyle(el);
      var decls = [];

      for (var s = 0; s < SIDES.length; s++) {
        var side = SIDES[s];
        var style = cs.getPropertyValue('border-' + side + '-style');
        if (style === 'none' || style === 'hidden') continue; // 无边框的边不写
        decls.push('border-' + side + '-style: ' + style);
        decls.push('border-' + side + '-width: ' + cs.getPropertyValue('border-' + side + '-width'));
        decls.push('border-' + side + '-color: ' + cs.getPropertyValue('border-' + side + '-color'));
      }

      var bg = cs.getPropertyValue('background-color');
      if (bg !== TRANSPARENT) decls.push('background-color: ' + bg);

      if (isTextEl(el)) {
        decls.push('font-size: ' + cs.getPropertyValue('font-size'));
        decls.push('font-weight: ' + cs.getPropertyValue('font-weight'));
        var color = cs.getPropertyValue('color');
        if (color !== BLACK) decls.push('color: ' + color); // 黑色不写
      }

      plans.push([el, decls]);
      if (decls.length) styledCount++;
    }

    // 2. 写入：style 属性整体替换（无目标属性则移除）
    for (var i = 0; i < plans.length; i++) {
      var el = plans[i][0];
      var decls = plans[i][1];
      if (decls.length) el.setAttribute('style', decls.join('; ') + ';');
      else el.removeAttribute('style');
    }
  }

  // 3. 清场：删除全部 <style> 标签与 class 属性（compute/strip 两模式共用）
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
    styledCount: typeof styledCount === 'number' ? styledCount : 0
  };
}
