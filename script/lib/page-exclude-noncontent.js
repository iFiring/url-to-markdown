/**
 * 步骤 8 分类层：非文章内容元素页面级排除（spec §3.1，双层第一层）。
 * 在浏览器 evaluate 中执行，每页一次（页 A gotoSettled 后、页 B prepare
 * 重标记 + 签名计算之后、截图循环之前）——visibility 不动
 * tag/children/textContent，签名不受影响；零重排，模块位置与 boundingBox
 * 择优不受影响。
 * 事实源是步骤 3 的 LLM 分类 + 步骤 7 的 trans2img 标记：
 *   keep = titleIds ∪ descriptionIds ∪ standaloneIds ∪ listFlowIds
 *          ∪ trans2img id 全集（调用侧拼好传入）
 *   隐藏 = 页内 data-idx 全集 − keep − keep 的祖先 − keep 的子孙
 *          ∪ listFlowDeleteIds（LLM 明判的菜单/导航/广告/推荐噪音，
 *          keep 子树内的也藏——步骤 7 是在噪音已删的 6_article.html 上
 *          标记模块的，截图应还原 LLM 所见的模块形态）
 * 保护规则：
 *   - keep 的子孙不藏：模块/正文内部元素是模块视觉本身，naive 补集会把
 *     模块内部挖空；
 *   - keep 的祖先是容器与背景，藏了就毁模块；
 *   - 保优先：任何隐藏候选（含 delete id）与 keep 或 keep 祖先重叠时一律
 *     不藏——步骤 3 理论上可产出 delete id 是 keep 祖先的坏分类。
 * 落地手段 visibility:hidden !important：与 DOM 删除像素等价、零重排、
 * 页 A（无 JS 的 file://）同样适用。keep 穿透按构造封闭（被藏元素子树内
 * 不可能有 keep 元素）；子代显式 visibility:visible 规则的穿透与几何层
 * （page-reveal-hidden.js 遮挡者段）同式处理——可见后代一并覆写。
 * 与几何层幂等共存：同写 visibility:hidden，重复覆写无冲突。
 * 返回 {hidden, kept}——hidden 为实际隐藏的打标元素数，kept 为 keep 集
 * 在页内命中的元素数（A/B 结构漂移时 kept < keepIds.length，可观测）。
 */
function __u2mExcludeNonContent(keepIds, deleteIds) {
  var keep = {};
  var del = {};
  for (var i = 0; i < keepIds.length; i++) keep[keepIds[i]] = true;
  for (var j = 0; j < deleteIds.length; j++) del[deleteIds[j]] = true;

  var tagged = document.querySelectorAll('[data-idx]');

  // keep 命中 + 祖先集（含未打标的 body/html——不在 tagged 内本就非候选）+ 子孙集
  var keepEls = [];
  var ancSet = new Set();
  var subSet = new Set();
  for (var t = 0; t < tagged.length; t++) {
    var e = tagged[t];
    if (!keep[parseInt(e.getAttribute('data-idx'), 10)]) continue;
    keepEls.push(e);
    for (var a = e.parentElement; a; a = a.parentElement) ancSet.add(a);
    var desc = e.querySelectorAll('*');
    for (var d = 0; d < desc.length; d++) subSet.add(desc[d]);
  }

  var hidden = 0;
  for (var u = 0; u < tagged.length; u++) {
    var el = tagged[u];
    var id = parseInt(el.getAttribute('data-idx'), 10);
    if (keep[id]) continue;                    // keep 自身
    if (ancSet.has(el)) continue;              // keep 祖先——保优先（delete 也不例外）
    if (!del[id] && subSet.has(el)) continue;  // keep 子孙保护；delete 噪音例外
    el.style.setProperty('visibility', 'hidden', 'important');
    // 子代显式 visible 穿透：可见后代一并覆写（未打标子代不在 hidden 计数内）
    var kids = el.querySelectorAll('*');
    for (var k = 0; k < kids.length; k++) {
      if (getComputedStyle(kids[k]).visibility === 'visible') {
        kids[k].style.setProperty('visibility', 'hidden', 'important');
      }
    }
    hidden++;
  }
  return { hidden: hidden, kept: keepEls.length };
}
