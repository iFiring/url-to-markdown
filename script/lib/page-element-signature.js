/**
 * 步骤 8 元素签名（live 重渲染页与 1_snapshot 页共用）。
 * 对给定 data-u2m-id 列表计算 {tag, text, childCount} 签名：text 为折叠
 * 空白后截断 300 字符的 textContent。两侧用同一函数、Node 侧逐字段比对——
 * 全等才允许 live 截图，失配即降级快照兜底（假阴性偏向：时间戳/计数等
 * 任何文本差异都判失配，宁降级不出错图）。
 */
function __u2mElementSignature(ids) {
  var collapse = function (s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  };
  var out = {};
  for (var i = 0; i < ids.length; i++) {
    var el = document.querySelector('[data-u2m-id="' + ids[i] + '"]');
    out[ids[i]] = el === null ? null : {
      tag: el.tagName,
      text: collapse(el.textContent),
      childCount: el.children.length
    };
  }
  return out;
}
