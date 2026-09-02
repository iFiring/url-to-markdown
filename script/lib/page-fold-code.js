// script/lib/page-fold-code.js
// styled 趟折叠 pass：在 __u2mFoldTables 之后执行（被成功表格吸收的 pre 已
// detach，!parentNode 守卫自然跳过；含 pre 的表本就因嵌套块级内容判 failed
// 保 live）。ok → data-language 提升 + 清空子树 + {{CODE_k|n_lines}} 文本
// 节点（n_lines 取 2_code.json 修剪后行数）；failed → 保 live、打
// data-u2m-code="fail"（诊断 + 步骤 7 信号；样式剥离由步骤 5 现有
// closest('pre') 分支覆盖）。与 clean 趟 K7 的 map 折叠同形、k 一致。
function __u2mFoldCode(resultByDataIdx) {
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden')) continue; // K5 独占
    var r = resultByDataIdx[pre.getAttribute('data-idx') || ''];
    if (r && r.status === 'ok') {
      if (r.lang && !pre.hasAttribute('data-language')) {
        pre.setAttribute('data-language', r.lang);
      }
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(document.createTextNode('{{CODE_' + r.k + '|' + r.lines + '_lines}}'));
    } else if (r) {
      pre.setAttribute('data-u2m-code', 'fail');
    }
    // map 未命中：不动（防御——编排层保证全部收集）
  }
}
