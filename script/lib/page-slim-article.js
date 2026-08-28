/**
 * 步骤 6 页面内瘦身函数。在浏览器 evaluate 中执行，签名
 * __u2mSlimArticle(protectedIds)——在 __u2mExtractArticle 迁移与噪音
 * 剔除之后、序列化之前对文章视图执行六条结构规则（spec：
 * docs/superpowers/specs/2026-08-29-step6-article-slimming-design.md §5，
 * 固定执行顺序——前面的规则改变后面规则看到的输入）：
 *  ① data-* 清理：保留 {data-u2m-id, data-language}（后者是步骤 7 判
 *     代码语言的机械信号），其余 data-*（组件库脚手架/交互状态）全删。
 *     白名单而非黑名单——陌上站点的 data-* 安全默认删除
 *  ② MathML→LaTeX：annotation 有 LaTeX 源才替换（KaTeX 双胞胎结构整体
 *     替换消灭 katex-html 重复；结构不匹配只换 <math>；无源保留原树）
 *  ③ 无文本/纯符号 button 与无文本 svg 删除（/[\p{L}\p{N}]/u 不命中
 *     的纯符号交互件如 ⋮/✕ 同删；含字母数字者走 ④）
 *  ④ 有文本 button 降级（解包上提子节点，包装铬的 style 弃置）
 *  ⑤ 非白名单协议 href 剥除（scheme ∉ http/https/mailto/tel 的 <a>
 *     解包——参考页 codex:// 营销链接单个 ~1KB prompt 曾漏进 9_markdown）
 *  ⑥ 空壳 span 拆包（属性只剩 data-u2m-id，迭代到不动点——pre 内语法
 *     高亮 token span 的样式已被步骤 5 清空，结构在、信息不在）
 * 保护集 protectedIds = titleIds ∪ descriptionIds ∪ standaloneIds
 * （listFlowIds 不入——容器本身不迁移）：删除/解包类（③④⑤⑥）跳过
 * 保护元素本身、其后代照常瘦身；保真替换类（②）不受约束——替换保留
 * 内容只换形态。id 随元素消失只影响 6/7 血统：步骤 8 用 1_snapshot/
 * live 的 id 对位，零影响。
 */
function __u2mSlimArticle(protectedIds) {
  var stats = {
    attrsDropped: 0, mathReplaced: 0, buttonsRemoved: 0,
    buttonsUnwrapped: 0, svgsRemoved: 0, linksStripped: 0, spansUnwrapped: 0
  };
  var protectedSet = {};
  for (var i = 0; i < (protectedIds || []).length; i++) protectedSet[protectedIds[i]] = true;
  function isProtected(el) {
    var id = el.getAttribute && el.getAttribute('data-u2m-id');
    return !!(id && protectedSet[id]);
  }
  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  // ① data-* 清理：白名单之外的 data-* 全删
  var KEEP_DATA = { 'data-u2m-id': 1, 'data-language': 1 };
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    for (var j = el.attributes.length - 1; j >= 0; j--) {
      var name = el.attributes[j].name;
      if (name.indexOf('data-') === 0 && !KEEP_DATA[name]) {
        el.removeAttribute(name);
        stats.attrsDropped++;
      }
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    attrsDropped: stats.attrsDropped,
    mathReplaced: stats.mathReplaced,
    buttonsRemoved: stats.buttonsRemoved,
    buttonsUnwrapped: stats.buttonsUnwrapped,
    svgsRemoved: stats.svgsRemoved,
    linksStripped: stats.linksStripped,
    spansUnwrapped: stats.spansUnwrapped
  };
}
