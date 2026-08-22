// page-resolve-placeholders.js
// 步骤 8 页面脚本：遍历文档所有文本节点，把 {{LONG_TEXT_k}} / {{LONG_TEXT_k|suffix}}
// 占位符替换为 longTextMap[k] 里的真实文本。返回替换计数与未定义引用列表。
function __u2mResolvePlaceholders(longTextMap) {
  const PH_RE = /\{\{LONG_TEXT_(\d+)(?:\|[^}]*)?\}\}/g;
  let replaced = 0;
  const undefinedRefs = new Set();

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const tnode of textNodes) {
    const original = tnode.textContent;
    if (!original || !original.includes('{{LONG_TEXT_')) continue;

    const updated = original.replace(PH_RE, (match, id) => {
      if (Object.prototype.hasOwnProperty.call(longTextMap, id)) {
        replaced++;
        return longTextMap[id];
      }
      undefinedRefs.add(id);
      return match;
    });

    if (updated !== original) tnode.textContent = updated;
  }

  return { replaced, undefined: [...undefinedRefs].sort((a, b) => +a - +b) };
}
