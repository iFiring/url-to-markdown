/**
 * 步骤 6 页面内提取函数。在浏览器 evaluate 中执行。
 * 从 5_juice_styles 纯内联视图（本文档）提取文章元素，新建一份 html：
 *  - titleIds / descriptionIds：元素本身（完整子树）
 *  - listFlowIds：遍历各容器 childNodes，元素子节点与非空白文本
 *    子节点按文档序交错迁入——裸文本没有 data-u2m-id，但可能是
 *    未包标签的正文，丢弃即内容损失；纯空白文本与注释不迁
 *    （容器本身与祖先骨架不入）
 *  - listFlowDeleteIds：列表流噪音（菜单/导航/广告/推荐）。迁移完成后
 *    按 id 在新 body 里整棵剔除（不限深度——直接子元素与嵌在迁移
 *    子元素内部的孙代同样生效）；id 在源文档未命中并入 missing 报错，
 *    在新 body 查不到则静默跳过（合法输入下已被步骤 4 裁掉，无法误删）
 * 按分组顺序（标题 → 说明 → 正文块）adoptNode 迁移进新 body，
 * 属性与内容一字不动；同一元素被指名两次（如 description 同时是
 * flow 子元素）只迁移一次；被指名元素若嵌套在另一被提取元素内部，
 * 会先迁出（原位留空），不会重复出现。
 * head 保留原文 <title>，<html lang> 照抄；新 <body> 带阅读布局内联
 * 样式 max-width:768px + margin:4rem auto（限宽水平居中，上下留白）。
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

  // 噪音 id 在源文档校验存在性——未命中说明 key_ids 与视图不匹配，
  // 与 key id 走同一条 missing 报错路径（存在≠迁入：未迁入的在新 body
  // 扫除时自然落空）
  var deleteIds = keyIds.listFlowDeleteIds || [];
  for (var i = 0; i < deleteIds.length; i++) {
    if (!document.querySelector('[data-u2m-id="' + deleteIds[i] + '"]')) {
      missing.push(deleteIds[i]);
    }
  }
  if (missing.length) return { missing: missing };

  var titleEl = document.querySelector('head > title');
  var doc = document.implementation.createHTMLDocument(
    titleEl ? titleEl.textContent : ''
  );
  var lang = document.documentElement.getAttribute('lang');
  if (lang) doc.documentElement.setAttribute('lang', lang);
  doc.body.setAttribute('style', 'max-width: 768px; margin: 4rem auto');

  var seen = [];
  for (var k = 0; k < picked.length; k++) {
    var dup = false;
    for (var m = 0; m < seen.length; m++) {
      if (seen[m] === picked[k]) { dup = true; break; }
    }
    if (dup) continue;
    seen.push(picked[k]);
    doc.body.appendChild(doc.adoptNode(picked[k]));
  }

  // 噪音剔除：迁移完成后按 id 在新 body 里整棵移除。
  // 迁移元素都是 body 直接子节点，children.length 即剔除后的元素数
  var removedNoise = 0;
  for (var i = 0; i < deleteIds.length; i++) {
    var noise = doc.body.querySelector('[data-u2m-id="' + deleteIds[i] + '"]');
    if (noise && noise.parentNode) {
      noise.parentNode.removeChild(noise);
      removedNoise++;
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML,
    count: doc.body.children.length,
    removedNoise: removedNoise
  };
}
