/**
 * 步骤 3.3 页面内提取函数。在浏览器 evaluate 中执行。
 * 从 3.2 纯内联视图（本文档）提取文章元素，新建一份 html：
 *  - titleIds / descriptionIds：元素本身（完整子树）
 *  - listFlowIds：遍历各容器 childNodes，元素子节点与非空白文本
 *    子节点按文档序交错迁入——裸文本没有 data-u2m-id，但可能是
 *    未包标签的正文，丢弃即内容损失；纯空白文本与注释不迁
 *    （容器本身与祖先骨架不入）
 * 按分组顺序（标题 → 说明 → 正文块）adoptNode 迁移进新 body，
 * 属性与内容一字不动；同一元素被指名两次（如 description 同时是
 * flow 子元素）只迁移一次；被指名元素若嵌套在另一被提取元素内部，
 * 会先迁出（原位留空），不会重复出现。
 * head 保留原文 <title>，<html lang> 照抄。
 * 注意：chunker 的列表流遍历仍是 el.children（裸文本不入块），
 * 两处语义有意不同——如需对齐另行决策。
 */
function __u2mExtractArticle(keyIds) {
  var picked = [];
  var missing = [];

  function collectIds(ids, asChildren) {
    for (var i = 0; i < ids.length; i++) {
      var el = document.querySelector('[data-u2m-id="' + ids[i] + '"]');
      if (!el) { missing.push(ids[i]); continue; }
      if (asChildren) {
        // 先收齐再迁移：adoptNode 会把节点移出源文档，边遍历边收会漏
        for (var j = 0; j < el.childNodes.length; j++) {
          var node = el.childNodes[j];
          if (node.nodeType === 1) {
            picked.push(node);
          } else if (node.nodeType === 3 && !/^\s*$/.test(node.nodeValue)) {
            picked.push(node);
          }
          // 注释等其余节点类型不迁
        }
      } else {
        picked.push(el);
      }
    }
  }

  collectIds(keyIds.titleIds || [], false);
  collectIds(keyIds.descriptionIds || [], false);
  collectIds(keyIds.listFlowIds || [], true);
  if (missing.length) return { missing: missing };

  var titleEl = document.querySelector('head > title');
  var doc = document.implementation.createHTMLDocument(
    titleEl ? titleEl.textContent : ''
  );
  var lang = document.documentElement.getAttribute('lang');
  if (lang) doc.documentElement.setAttribute('lang', lang);

  var seen = [];
  var count = 0;
  for (var k = 0; k < picked.length; k++) {
    var dup = false;
    for (var m = 0; m < seen.length; m++) {
      if (seen[m] === picked[k]) { dup = true; break; }
    }
    if (dup) continue;
    seen.push(picked[k]);
    doc.body.appendChild(doc.adoptNode(picked[k]));
    if (picked[k].nodeType === 1) count++;
  }

  return {
    html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    count: count
  };
}
