/**
 * 步骤 8 截图前逐 id 四段手术（spec §3.2-§3.5）。在浏览器 evaluate 中执行。
 * trans2img 模块可能处于折叠态（手风琴收起等）：步骤 2 只在清洗版折叠隐藏
 * 子树，带样式版保真——折叠内容合法流到步骤 7 并可被标 trans2img；而页 A
 * （快照，站点 CSS 已内联）与页 B（live，站点自身收起态）都把它渲染为
 * 隐藏：display:none（自身或祖先）盒为 null、max-height:0 盒高为 0，
 * el.screenshot() 自动等可见会挂到超时；更隐蔽的是被塌缩祖先裁剪的模块
 * ——自身盒正常但像素被裁空，不展开就截是空白图。
 * 对给定 data-u2m-id 的元素**无条件**自元素向 body 逐级扫一遍，**只覆写
 * 正在隐藏的属性**（行内 !important）——不能以元素自身盒作前置守卫：被
 * 塌缩祖先裁剪/visibility 隐藏的模块盒正常但像素全空，守卫会放行出空白图。
 * 四段（执行顺序）：
 *   1) 纵向强制展开（现状，spec §3.2）：自元素向 body（不含 body/html），
 *      只动正在隐藏的属性：
 *      - computed display:none → block（折叠包装几乎都是普通块；模块内部
 *        flex/grid 在更深层、不在覆写之列。若站点开合态本就是 flex/grid，
 *        截图按块堆叠降级——比截不出图强）
 *      - visibility:hidden|collapse → visible；opacity:0 → 1
 *      - HTML hidden 属性 → 移除（UA 规则打不过行内 !important）
 *      - max-height:0 → none
 *      - height:0（目标自身被压扁）→ auto + overflow:visible
 *      - 塌缩裁剪者：overflowY:hidden 且 clientHeight===0 且 scrollHeight>0
 *        → max-height:none + height:auto + overflow:visible（子代像素被裁空
 *        的元凶，computed height 可能报 auto、靠 clientHeight 才抓得住）
 *   2) 横向裁剪 reveal（spec §3.3）：自元素**向 html 逐级**（含 body/html
 *      ——真实盒裁剪最常在这两层，html 设 overflow-x:auto 时 body 的
 *      overflow-x:hidden 不上浮为视口裁剪而按普通盒裁剪），对确实在横向
 *      裁剪的祖先（overflow-x ∈ {hidden,clip,auto,scroll} 且
 *      clientWidth < scrollWidth）覆写 overflow:visible——简写一次覆写双轴，
 *      绕开规范把 visible+hidden 强制计算回 auto；本就不裁的零改动。
 *      captureBeyondViewport 救不了被盒裁掉的内容（Chromium 根本不绘制）。
 *   3) 留白扩盒（spec §3.4）：截图四边留 20px 呼吸位。单纯加 padding 会把
 *      内容挤窄 40px（auto 宽块的内容宽 = 可用宽 − padding，文字重排换行、
 *      表格被压），用负 margin 抵消：每侧 padding = 原值 + 20、margin =
 *      原值 − 20——盒四向外扩 20px（背景延伸成环）、内容像素级不动、页面
 *      其余布局不变（margin 盒尺寸不变，flex/grid 项同样不受扰动）。显式
 *      width/height/max-*（border-box 常态）会把盒钉住、padding 反吃内容
 *      ——复查内容宽高，缩水则补 width/height px + max-* none 自愈。
 *      data-u2m-pad 标记防重入。在遮挡者扫描之前执行：盒大了 20px，新
 *      碰到环区的邻居才会在本页后续扫描中被藏掉，环才是干净的。
 *   4) 遮挡者隐藏（spec §3.5）：body 下非亲族元素（双向 contains 排除——
 *      模块内的 fixed 徽标/吸顶表头是亲族，保留）：fixed/sticky 一律
 *      visibility:hidden（视口家具永远不是模块内容，顺带消灭
 *      captureBeyondViewport 的 fixed 重复绘制伪影）；其余一切定位形态
 *      （absolute/relative/transform/负 margin/浮动）与目标盒真实相交即
 *      隐藏（矩形判定）。选 visibility 而非 opacity：离散无过渡、不影响
 *      布局；父 hidden 子显式 visible 会穿透，可见后代一并覆写。
 *      不恢复——导航对同页后续所有截图同样该藏。跳过
 *      SCRIPT/STYLE/NOSCRIPT/TEMPLATE/LINK/META 控制成本。
 * 手术是截图前的渲染态修改：不动 tag/children/textContent，元素签名不受
 * 影响（签名在手术之前计算）。与分类层（page-exclude-noncontent.js）幂等
 * 共存：同写 visibility:hidden，重复覆写无冲突；已 hidden 的元素直接跳过。
 * 返回 {found, touched, wideTouched, occluders, box, boxless}——touched 为
 * 纵向覆写处数，wideTouched 为横向覆写处数，occluders 为隐藏的遮挡者数
 * （均仅供 U2M_DEBUG）；box 为手术后量得的 CSS px 尺寸（宽高均 >0 即可
 * 截图）；boxless=true 标记目标自身为 display:contents 透明包装——规范上
 * 永不生成盒（rect 恒 0×0，与隐藏无关、覆写救不了），调用方应跳过该 id，
 * 视觉由链上其余 id 承载。
 */
function __u2mRevealHidden(id) {
  var el = document.querySelector('[data-u2m-id="' + id + '"]');
  if (!el) return { found: false, touched: 0, wideTouched: 0, occluders: 0, box: null, boxless: false };

  function boxOf(e) {
    var r = e.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  // 1) 纵向强制展开（到 body 为止，不含 body/html）
  var touched = 0;
  for (var node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
    var cs = getComputedStyle(node);
    if (cs.display === 'none') { node.style.setProperty('display', 'block', 'important'); touched++; }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
      node.style.setProperty('visibility', 'visible', 'important'); touched++;
    }
    if (parseFloat(cs.opacity) === 0) { node.style.setProperty('opacity', '1', 'important'); touched++; }
    if (node.hasAttribute('hidden')) { node.removeAttribute('hidden'); touched++; }
    if (parseFloat(cs.maxHeight) === 0) { node.style.setProperty('max-height', 'none', 'important'); touched++; }
    // 目标自身被压扁：height:0 时子孙被裁（overflow:hidden）或溢出压扁
    if (node === el && parseFloat(cs.height) === 0) {
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      touched++;
    }
    // 塌缩裁剪者：盒高 0 却装着内容（子代盒正常但像素全被裁空）。
    // computed height 可能是 auto（flex-basis/min-height 压扁），靠
    // clientHeight 抓；只动确在裁剪的（scrollHeight>0）
    if (cs.overflowY === 'hidden' && node.clientHeight === 0 && node.scrollHeight > 0) {
      node.style.setProperty('max-height', 'none', 'important');
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      touched++;
    }
  }

  // 2) 横向裁剪 reveal（到 html，含 body/html）
  var wideTouched = 0;
  for (var anc = el; anc && anc.nodeType === 1; anc = anc.parentElement) {
    var ox = getComputedStyle(anc).overflowX;
    if ((ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll')
        && anc.clientWidth < anc.scrollWidth) {
      anc.style.setProperty('overflow', 'visible', 'important');
      wideTouched++;
    }
  }

  // display:contents：透明包装永不生成盒（rect 恒 0×0），非隐藏所致
  var boxless = getComputedStyle(el).display === 'contents';

  // 留白扩盒（spec §3.4）：机制见头注 3)
  function padForShot(target) {
    var PAD = 20;
    if (target.hasAttribute('data-u2m-pad')) return;
    target.setAttribute('data-u2m-pad', '1');
    var cs0 = getComputedStyle(target);
    var r0 = target.getBoundingClientRect();
    var pt = parseFloat(cs0.paddingTop), pr = parseFloat(cs0.paddingRight);
    var pb = parseFloat(cs0.paddingBottom), pl = parseFloat(cs0.paddingLeft);
    var mt = parseFloat(cs0.marginTop), mr = parseFloat(cs0.marginRight);
    var mb = parseFloat(cs0.marginBottom), ml = parseFloat(cs0.marginLeft);
    // 扩盒前的内容盒尺寸——自愈判据
    var cw0 = r0.width - pl - pr - parseFloat(cs0.borderLeftWidth) - parseFloat(cs0.borderRightWidth);
    var ch0 = r0.height - pt - pb - parseFloat(cs0.borderTopWidth) - parseFloat(cs0.borderBottomWidth);
    target.style.setProperty('padding',
      (pt + PAD) + 'px ' + (pr + PAD) + 'px ' + (pb + PAD) + 'px ' + (pl + PAD) + 'px', 'important');
    target.style.setProperty('margin',
      (mt - PAD) + 'px ' + (mr - PAD) + 'px ' + (mb - PAD) + 'px ' + (ml - PAD) + 'px', 'important');
    // 自愈：显式 width/height/max-* 钉住盒时 padding 反吃内容——内容缩水
    // 则补 width/height = 原盒 + 40（border-box）并解 max-* 约束
    var cs1 = getComputedStyle(target);
    var r1 = target.getBoundingClientRect();
    if (r1.width - parseFloat(cs1.paddingLeft) - parseFloat(cs1.paddingRight)
        - parseFloat(cs1.borderLeftWidth) - parseFloat(cs1.borderRightWidth) < cw0 - 0.5) {
      target.style.setProperty('box-sizing', 'border-box', 'important');
      target.style.setProperty('width', (r0.width + 2 * PAD) + 'px', 'important');
      target.style.setProperty('max-width', 'none', 'important');
    }
    if (r1.height - parseFloat(cs1.paddingTop) - parseFloat(cs1.paddingBottom)
        - parseFloat(cs1.borderTopWidth) - parseFloat(cs1.borderBottomWidth) < ch0 - 0.5) {
      target.style.setProperty('box-sizing', 'border-box', 'important');
      target.style.setProperty('height', (r0.height + 2 * PAD) + 'px', 'important');
      target.style.setProperty('max-height', 'none', 'important');
    }
  }

  // 4) 遮挡者隐藏（boxless 目标无盒可被遮挡，跳过）
  var occluders = 0;
  if (!boxless) {
    padForShot(el);
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1 };
    var tb = el.getBoundingClientRect();
    var cand = document.body.querySelectorAll('*');
    for (var i = 0; i < cand.length; i++) {
      var o = cand[i];
      if (SKIP[o.tagName]) continue;
      if (o === el || o.contains(el) || el.contains(o)) continue; // 亲族保留
      var ocs = getComputedStyle(o);
      if (ocs.visibility === 'hidden') continue; // 已藏（含分类层覆写）幂等跳过
      var hide = ocs.position === 'fixed' || ocs.position === 'sticky';
      if (!hide) {
        var r = o.getBoundingClientRect();
        hide = r.width > 0 && r.height > 0
          && r.left < tb.right && tb.left < r.right
          && r.top < tb.bottom && tb.top < r.bottom;
      }
      if (hide) {
        o.style.setProperty('visibility', 'hidden', 'important');
        // 父 hidden 子显式 visible 会穿透——可见后代一并覆写
        var kids = o.querySelectorAll('*');
        for (var k = 0; k < kids.length; k++) {
          if (getComputedStyle(kids[k]).visibility === 'visible') {
            kids[k].style.setProperty('visibility', 'hidden', 'important');
          }
        }
        occluders++;
      }
    }
  }

  return { found: true, touched: touched, wideTouched: wideTouched, occluders: occluders, box: boxOf(el), boxless: boxless };
}
