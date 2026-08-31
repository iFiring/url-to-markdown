/**
 * 步骤 4 页面内裁剪函数。在浏览器 evaluate 中执行。
 * 基于 3_key_ids.json 四键契约（titleId/descriptionIds/paragraphIds/dumpIds；
 * paragraphIds 嵌套已由调用方展开为 blockIds 扁平清单），把带样式版快照
 * 裁剪为只含文章主体的样式视图：
 *   - 完整保留（一字不动，含全部标签属性与样式属性）：title/description/
 *     block 元素的子树 + 它们到 <body> 的祖先链——祖先上下文不变，CSS
 *     选择器照常生效
 *   - dumpIds：折叠为空元素——清空全部子节点，属性仅留 id/class/data-idx。
 *     壳占住流内位置（步骤 5 juice 求值 nth-child/相邻选择器时兄弟结构
 *     不失真），内容与冗余属性消失；落在保留区外的 dump 随所属分支
 *     删除、不计错不计数
 *   - <head> 完全不动（title + 全部 <style> 原地保留）；body 里即将删除
 *     或折叠的分支中若有 <style>，先挪入 <head> 再处理，样式标签零丢失
 *     （挪入按原文档序追加到 head 末尾，相对优先级不变）
 *   - 删除：其余全部 body 元素（页面 chrome、流外噪音）
 * key id 未命中时返回 {missing}；dumpId 是任一 key 元素的祖先（折叠会摧毁
 * key 子树）时返回 {conflict}。两者均不改动 DOM。
 */
function __u2mExtractStyled(keyIds) {
  var ids = [];
  if (keyIds.titleId != null) ids.push(keyIds.titleId);
  ids = ids.concat(keyIds.descriptionIds || []).concat(keyIds.blockIds || []);

  var missing = [];
  var keyEls = [];
  for (var i = 0; i < ids.length; i++) {
    var found = document.querySelector('[data-idx="' + ids[i] + '"]');
    if (found) keyEls.push(found);
    else missing.push(ids[i]);
  }
  if (missing.length) return { missing: missing };

  var dumpIds = keyIds.dumpIds || [];
  var dumpEls = [];
  for (var i = 0; i < dumpIds.length; i++) {
    var d = document.querySelector('[data-idx="' + dumpIds[i] + '"]');
    if (d) dumpEls.push(d);
  }

  // 冲突检测：dump 折叠的是自身子树，若是任一 key 元素的祖先则折叠会摧毁
  // key 内容——属自相矛盾标记，原样返回不改动 DOM
  for (var i = 0; i < dumpEls.length; i++) {
    for (var j = 0; j < keyEls.length; j++) {
      if (dumpEls[i].contains(keyEls[j])) {
        return { conflict: { dump: dumpIds[i], key: ids[j] } };
      }
    }
  }

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

  // body 分支里的 <style>：保留区内的不动；即将删除的分支与 dump 子树内
  // 的（折叠会清空子节点）先挪入 head——删除与折叠都不吞样式表
  var bodyStyles = document.body.querySelectorAll('style');
  for (var i = 0; i < bodyStyles.length; i++) {
    var s = bodyStyles[i];
    var inDump = false;
    for (var j = 0; j < dumpEls.length; j++) {
      if (dumpEls[j].contains(s)) { inDump = true; break; }
    }
    if (keep.indexOf(s) === -1 || inDump) document.head.appendChild(s);
  }

  // 删除保留集合与 dump 之外的所有 body 元素。
  // querySelectorAll 返回静态快照，可边遍历边删；
  // 已删元素的子节点随祖先脱离 DOM，parentNode 判空跳过
  var all = document.body.querySelectorAll('*');
  var removed = 0;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (keep.indexOf(el) === -1 && dumpEls.indexOf(el) === -1 && el.parentNode) {
      el.parentNode.removeChild(el);
      removed++;
    }
  }

  // 折叠：幸存的 dump 清空全部子节点，属性仅留 id/class/data-idx
  // （随已删分支脱离 DOM 的 dump 跳过、不计入折叠数）
  var dumpCollapsed = 0;
  for (var i = 0; i < dumpEls.length; i++) {
    var el = dumpEls[i];
    if (!el.isConnected) continue;
    while (el.firstChild) el.removeChild(el.firstChild);
    var attrs = Array.prototype.slice.call(el.attributes);
    for (var j = 0; j < attrs.length; j++) {
      var name = attrs[j].name;
      if (name !== 'id' && name !== 'class' && name !== 'data-idx') {
        el.removeAttribute(name);
      }
    }
    dumpCollapsed++;
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    removed: removed,
    kept: document.body.querySelectorAll('*').length,
    dumpCollapsed: dumpCollapsed
  };
}
