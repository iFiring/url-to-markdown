/**
 * 步骤 5 前置：隐藏声明剥离。在浏览器 evaluate 中执行，就地改写 DOM/CSSOM
 * 后返回统计——收起的元素（手风琴收起面板、折叠区、抽屉）展开为可见，
 * 内容与自然样式流进步骤 7。
 * 三层剥除（隐藏来源全覆盖）：
 *  1. 样式表层（class 规则与 <style> 规则的统一载体）：CSSOM 递归遍历全部
 *     样式表规则（含 @media / 嵌套块），删除 display:none / visibility:hidden
 *     声明——只删隐藏声明，规则其余声明保留：`.row{display:flex}` +
 *     `.collapse{display:none}` 的元素剥除后自然恢复 display:flex（不是
 *     display:block 盲改），flex/grid 结构信号完整流到步骤 7。
 *  2. 内联 style 属性：同样经 CSSOM 删（其余声明保留）。
 *  3. 兜底层：剥完仍 computed 隐藏的来源——
 *     - 裸 hidden 属性（UA 的 [hidden]{display:none} 不在可遍历的作者样式
 *       表里）：摘除属性；
 *     - 变量驱动（display:var(--gone)，静态值非 none 不可规则级判别）：
 *       内联覆写 display:block / visibility:visible（inline 优先级高于类规则）。
 *     规范上不渲染的元数据元素（style/script/template/source 等，UA 即
 *     display:none）跳过——它们不是「被收起的内容」，body 内 <style> 是
 *     juice 级联输入。
 * 置于 normalize/unwrap 之前：CSSOM 改写即时反映到 <style> 序列化文本，
 * 后续 unwrap 与 juice 看到的即剥除后的样式表。
 */
function __u2mStripHidden() {
  var stats = { decl: 0, attrs: 0, fallback: 0 };

  // 1. 样式表层：递归删 display:none / visibility:hidden 声明
  function walkRules(rules) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.style) {
        if (r.style.getPropertyValue('display') === 'none') {
          r.style.removeProperty('display');
          stats.decl++;
        }
        if (r.style.getPropertyValue('visibility') === 'hidden') {
          r.style.removeProperty('visibility');
          stats.decl++;
        }
      }
      if (r.cssRules) {
        try { walkRules(r.cssRules); } catch (e) { /* 跨域 import 等不可达即跳过 */ }
      }
    }
  }
  for (var s = 0; s < document.styleSheets.length; s++) {
    try { walkRules(document.styleSheets[s].cssRules); } catch (e) { /* 同上 */ }
  }

  // 1.5 写回：CSSOM 改写不回写 <style> 的文本节点——后续 unwrap 与 outerHTML
  //     序列化读的都是文本，不物化即被还原（剥了等于没剥）。逐 style 元素把
  //     规则集 cssText 序列化回 textContent，剥除效果落到 juice 输入上
  var styleTags = document.querySelectorAll('style');
  for (var t = 0; t < styleTags.length; t++) {
    var sheet = styleTags[t].sheet;
    if (!sheet) continue;
    var ruleTexts = [];
    for (var q = 0; q < sheet.cssRules.length; q++) ruleTexts.push(sheet.cssRules[q].cssText);
    styleTags[t].textContent = ruleTexts.join('\n');
  }

  // 2. 内联 style 属性：同样删（其余声明保留）
  var inline = document.querySelectorAll('[style]');
  for (var i = 0; i < inline.length; i++) {
    var st = inline[i].style;
    if (st.getPropertyValue('display') === 'none') {
      st.removeProperty('display');
      stats.decl++;
    }
    if (st.getPropertyValue('visibility') === 'hidden') {
      st.removeProperty('visibility');
      stats.decl++;
    }
    if (st.length === 0) inline[i].removeAttribute('style');
  }

  // 3. 兜底：摘裸 hidden 属性、var 驱动内联覆写（文档序 = 祖先在前，
  //    祖先覆写后子代 getComputedStyle 即时反映、逐个复核不再命中）
  var NON_RENDER = { STYLE: 1, SCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, BASE: 1,
    TITLE: 1, NOSCRIPT: 1, SOURCE: 1, TRACK: 1, PARAM: 1, AREA: 1, DATALIST: 1 };
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (NON_RENDER[el.tagName.toUpperCase()]) continue;
    if (el.hasAttribute('hidden') && getComputedStyle(el).display === 'none') {
      el.removeAttribute('hidden');
      stats.attrs++;
    }
    if (getComputedStyle(el).display === 'none') {
      el.style.setProperty('display', 'block');
      stats.fallback++;
    }
    if (getComputedStyle(el).visibility === 'hidden') {
      el.style.setProperty('visibility', 'visible');
      stats.fallback++;
    }
  }

  return stats;
}
