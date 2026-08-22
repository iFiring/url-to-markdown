/**
 * 步骤 4 页面内裁剪函数。在浏览器 evaluate 中执行。
 * 基于 3_key_ids.json 的关键 ID，把带样式版快照裁剪为只含文章主体的样式视图：
 *   - key 元素（titleIds/descriptionIds/listFlowIds）的完整子树一字不动——
 *     标签、属性、后代、文本全部原样保留
 *   - key 元素到 <body> 的祖先链（骨架）保留，链上属性同样不动——
 *     祖先上下文不变，CSS 选择器照常生效
 *   - <head> 完全不动（title + <style> 原地保留）；body 即将删除的分支里
 *     若有 <style>，先挪入 head 再删分支——样式标签零丢失
 *     （挪入按原文档序追加到 head 末尾，相对优先级不变）
 *   - 其余 body 内元素全部删除
 * key id 未命中时返回 {missing}，不改动 DOM。
 */
function __u2mExtractStyled(keyIds) {
  var ids = []
    .concat(keyIds.titleIds || [])
    .concat(keyIds.descriptionIds || [])
    .concat(keyIds.listFlowIds || []);

  var missing = [];
  var keyEls = [];
  for (var i = 0; i < ids.length; i++) {
    var found = document.querySelector('[data-u2m-id="' + ids[i] + '"]');
    if (found) keyEls.push(found);
    else missing.push(ids[i]);
  }
  if (missing.length) return { missing: missing };

  // 保留集合 = key 元素 + 全部后代 + 到 body 的祖先链（向上封闭：
  // 保留元素的所有祖先必然也在集合内，删除时不会产生悬空保留）
  var keep = [];
  function markKeep(el) {
    if (keep.indexOf(el) === -1) keep.push(el);
  }
  for (var i = 0; i < keyEls.length; i++) {
    var el = keyEls[i];
    for (var p = el; p; p = p.parentElement) {
      markKeep(p);
      if (p === document.body) break;
    }
    var descendants = el.querySelectorAll('*');
    for (var j = 0; j < descendants.length; j++) markKeep(descendants[j]);
  }

  // body 分支里的 <style>：保留区内的不动，区外的先挪入 head 再删分支
  var bodyStyles = document.body.querySelectorAll('style');
  for (var i = 0; i < bodyStyles.length; i++) {
    var s = bodyStyles[i];
    if (keep.indexOf(s) === -1) document.head.appendChild(s);
  }

  // 删除保留集合之外的所有 body 元素。
  // querySelectorAll 返回静态快照，可边遍历边删；
  // 已删元素的子节点随祖先脱离 DOM，parentNode 判空跳过
  var all = document.body.querySelectorAll('*');
  var removed = 0;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (keep.indexOf(el) === -1 && el.parentNode) {
      el.parentNode.removeChild(el);
      removed++;
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    removed: removed,
    kept: document.body.querySelectorAll('*').length
  };
}
