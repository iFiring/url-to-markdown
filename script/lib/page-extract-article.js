/**
 * 步骤 6 页面内提取函数。在浏览器 evaluate 中执行。
 * 四键契约（titleId/descriptionIds/paragraphIds/dumpIds；paragraphIds
 * 嵌套已由调用方经 lib/key-ids.mjs 展开为 blockIds 扁平清单）——
 * 块模型：title/description/block **全部按元素本身**收选（完整子树，
 * 属性与内容一字不动）。流容器、非流包装层、到 body 的祖先骨架不在
 * 任何键、自然不入文章；dumpIds 不被步骤 6 消费——步骤 4 已把流内
 * 噪音折叠为空壳，壳不在任何键、同样不入（无迁移后剔除 pass）。
 * 收选节点先同节点去重、再做最外层优先嵌套去重——title/description
 * 落在段落块子树内合法（四键只约束 ID 不相交），被包含者跳过、内容
 * 随外层整块带入、结构不拆散；最后按文档序（compareDocumentPosition）
 * 统一排序——paragraphIds 的列举顺序与嵌套层级都不影响输出顺序——
 * 逐个 adoptNode 迁入新 body。
 * key id 未命中时返回 {missing}，不改 DOM。
 * head 保留原文 <title>，<html lang> 照抄；新 <body> 带阅读布局内联
 * 样式 max-width:768px + margin:4rem auto（限宽水平居中，上下留白）。
 */
function __u2mExtractArticle(keyIds) {
  var ids = [];
  if (keyIds.titleId != null) ids.push(keyIds.titleId);
  ids = ids.concat(keyIds.descriptionIds || []).concat(keyIds.blockIds || []);

  var picked = [];
  var missing = [];
  for (var i = 0; i < ids.length; i++) {
    var el = document.querySelector('[data-idx="' + ids[i] + '"]');
    if (!el) missing.push(ids[i]);
    else picked.push(el);
  }
  if (missing.length) return { missing: missing };

  var titleEl = document.querySelector('head > title');
  var doc = document.implementation.createHTMLDocument(
    titleEl ? titleEl.textContent : ''
  );
  var lang = document.documentElement.getAttribute('lang');
  if (lang) doc.documentElement.setAttribute('lang', lang);
  doc.body.setAttribute('style', 'max-width: 768px; margin: 4rem auto');

  // 同一节点只保留首次出现
  var unique = [];
  for (var k = 0; k < picked.length; k++) {
    var dup = false;
    for (var m = 0; m < unique.length; m++) {
      if (unique[m] === picked[k]) { dup = true; break; }
    }
    if (!dup) unique.push(picked[k]);
  }

  // 嵌套去重（最外层优先）：被另一收选节点包含的跳过——如 description
  // 落在段落块子树内，再迁只会把它从原位拔出、追加到文末
  var outermost = [];
  for (var i = 0; i < unique.length; i++) {
    var inside = false;
    for (var j = 0; j < unique.length; j++) {
      if (i !== j && unique[j].contains(unique[i])) { inside = true; break; }
    }
    if (!inside) outermost.push(unique[i]);
  }

  // 文档序统一排序（在源文档上排，全部节点尚未迁移、位置真实）
  outermost.sort(function (a, b) {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  for (var n = 0; n < outermost.length; n++) {
    doc.body.appendChild(doc.adoptNode(outermost[n]));
  }

  // 迁移元素都是 body 直接子节点，children.length 即文章元素数
  return {
    html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    count: doc.body.children.length
  };
}
