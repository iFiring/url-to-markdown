/**
 * 步骤 5 函数值解析。在浏览器 evaluate 中执行，运行于「原始
 * 4_styled_extract.html」页面（完整 <style> + class + @property——浏览器
 * 真实渲染上下文），接收 page-collect-fn-values.js 收集的声明对，逐对取
 * getComputedStyle 计算值，返回 map：
 *   { "<data-u2m-id>": { "<prop>": "<计算值>", … }, … }
 * 计算值是浏览器把 var()/color-mix()/calc() 全部解析后的真实值：
 * @property 注册的 --tw-border-style → solid；两级 var→color-mix → 具体
 * color(srgb …)/rgb(…) 色值；calc() → 具体 px。元素缺失（两版 DOM 不一
 * 致）时跳过该对——finalize 侧对无值的函数声明直接删除，终态零残留。
 */
function __u2mResolveComputed(pairs) {
  var byId = {};
  var all = document.querySelectorAll('[data-u2m-id]');
  var elById = {};
  for (var i = 0; i < all.length; i++) {
    elById[all[i].getAttribute('data-u2m-id')] = all[i];
  }
  for (var k = 0; k < pairs.length; k++) {
    var el = elById[pairs[k].id];
    if (!el) continue;
    var cs = getComputedStyle(el);
    var m = {};
    for (var t = 0; t < pairs[k].props.length; t++) {
      m[pairs[k].props[t]] = cs.getPropertyValue(pairs[k].props[t]);
    }
    byId[pairs[k].id] = m;
  }
  return byId;
}
