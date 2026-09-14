// page-detect-captcha.js —— 人机验证挑战检测 + 稀薄内容测量（判定规则唯一事实源）
// 普通非模块文件：恰好一个具名函数，Node 侧（detector-captcha.mjs）以文本读入注入页面执行：
//   page.evaluate(`(${src})(${JSON.stringify(cfg)})`)
// cfg（选择器/关键词/阈值全部由 detector-captcha.mjs 唯一数据源提供——数据注入而非逻辑分叉，
// page-detect-iframe.js 的 cfg 注入同款先例）:
//   vendors        [{vendor, sel:[...], successSel:[...]}] 厂商挑战标记清单
//   prefixTags     ['geetest-'] 自定义元素标签前缀（极验 4.x shadow host 在 light DOM 可见）
//   titleKeywords  标题关键词（小写子串匹配 document.title）
//   frameUrlPatterns [{vendor, pattern}] 跨域 iframe 的 URL 挑战特征（字符串正则，i 标志）——
//                  跨域 frame 内部 DOM 不可达，但主文档侧对其 <iframe> 元素自身的
//                  src/可见性/面积测量完全可行（2026-09-14 自 Node 侧 frameElement 通道
//                  迁入——判定归一，且主文档侧可见性过滤覆盖隐藏 iframe）
//   frameHits      [{vendor, sel, area}] Node 侧同源 sub-frame 预采集的命中（并入占优判定）
//   areaRatio      占优面积通道比例（默认 0.35）
//   textThreshold  占优文本通道 / 稀薄阈值（默认 200 归一字符）
//   textChannelMinArea 占优文本通道的命中面积下限（默认 200×200）——表单内嵌 widget /
//                  passive badge 配稀薄正文不构成「整页是挑战」
//   viewportRefHeight 面积参照高度上限（默认 1000——管线 1280×3000 懒加载视口会把
//                  挑战卡面积占比稀释到 <10%，参照系取 min(clientHeight, 1000) 修正）
// 返回 {captcha:{hits,dominant,success,areaChannel,textChannel}, titleHit,
//        sparse:{textLen,hasMain,hasFrame,thin}}
//   （hasFrame = 存在可见可导航 iframe ≥200px——iframe 壳页的稀薄归重定向门管，稀薄兜底不截胡；
//    thin = textLen<阈值 ∧ !hasMain ∧ !hasFrame——稀薄判定唯一事实源，.mjs 层只消费不复算）
// 占优双通道：面积（最大命中 ≥ areaRatio × 参照视口）∨ 文本（任一 ≥ textChannelMinArea 的
// 可见命中 ∧ 正文 <阈值）——interstitial 挑战页靠文本通道兜住，全屏 overlay 靠面积通道，
// 长文内嵌 demo / 短页内嵌表单 widget（badge）双通道都不命中。
// 已知边界：不穿透 shadow DOM（极验 4.x 自定义元素内部结构不可见，靠宿主标签名前缀兜底）；
// 稀薄度只量主文档 innerText——同源 iframe 承载全部正文的页面归重定向门管，不在本脚本职责内。
function __u2mDetectCaptcha(cfg) {
  cfg = cfg || {};
  const vendors = cfg.vendors || [];
  const prefixTags = cfg.prefixTags || [];
  const titleKeywords = cfg.titleKeywords || [];
  const frameHits = (cfg.frameHits || []).filter((h) => h && h.area > 0);
  const frameUrlPatterns = (cfg.frameUrlPatterns || []).map((p) => ({
    vendor: p.vendor, re: new RegExp(p.pattern, 'i'),
  }));
  const areaRatio = cfg.areaRatio ?? 0.35;
  const textThreshold = cfg.textThreshold ?? 200;
  const textChannelMinArea = cfg.textChannelMinArea ?? 200 * 200;
  const refHeight = cfg.viewportRefHeight ?? 1000;

  const vw = document.documentElement.clientWidth;
  const vh = Math.min(document.documentElement.clientHeight, refHeight);

  // 可见性 + 面积（checkVisibility 优先，回退 getClientRects；不可见返回 null）。
  // opacity:0 手查——checkVisibility 默认不查 opacity，badge 渐隐隐藏常用；
  // 负向远端坐标（left/top ≤ -1000）手查——CSS 钉隐藏惯用法（-9999），checkVisibility
  // 不查几何位置；下方/右侧超出视口不判——懒加载内容合法
  const visibleArea = (el) => {
    try {
      if (el.checkVisibility) { if (!el.checkVisibility()) return null; }
      else if (el.getClientRects().length === 0) return null;
    } catch { return null; }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    if (r.left <= -1000 || r.top <= -1000) return null;
    return Math.round(r.width * r.height);
  };

  const hits = [];
  let success = false;
  for (const spec of vendors) {
    // 成功态优先：该厂商成功 widget 可见 → 视为已通过，不收其活跃标记
    // （滑块通过后面板常带成功类残留，不应再触发占优）
    let succ = false;
    for (const s of spec.successSel || []) {
      let els;
      try { els = document.querySelectorAll(s); } catch { continue; }
      for (const el of els) { if (visibleArea(el) !== null) { succ = true; break; } }
      if (succ) break;
    }
    if (succ) { success = true; continue; }
    for (const s of spec.sel || []) {
      let els;
      try { els = document.querySelectorAll(s); } catch { continue; }
      for (const el of els) {
        const area = visibleArea(el);
        if (area !== null) hits.push({ vendor: spec.vendor, sel: s, area });
      }
    }
  }
  // 自定义元素标签前缀扫描（所有前缀共享一次全元素遍历）
  if (prefixTags.length) {
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      let matched = null;
      for (const p of prefixTags) { if (tag.indexOf(p) === 0) { matched = tag; break; } }
      if (!matched) continue;
      const area = visibleArea(el);
      if (area !== null) hits.push({ vendor: matched, sel: matched, area });
    }
  }
  // 跨域 iframe URL 特征：主文档侧对 <iframe> 元素自身测量（内部 DOM 不可达也无需）。
  // src 用 property（绝对化 URL）——相对 src（如 /content.html）也须正确参与协议
  // 判定与特征匹配；attribute 只做存在性门控（无 src 时 property 会返回页面自身 URL）
  const iframeSrc = (f) => {
    if (!f.getAttribute('src')) return null;
    try { return f.src || null; } catch { return null; }
  };
  for (const p of frameUrlPatterns) {
    let ifrs;
    try { ifrs = document.querySelectorAll('iframe'); } catch { break; }
    for (const f of ifrs) {
      const src = iframeSrc(f);
      if (!src || !p.re.test(src)) continue;
      const area = visibleArea(f);
      if (area !== null) hits.push({ vendor: p.vendor, sel: `frame:${src.slice(0, 120)}`, area });
    }
  }
  const allHits = [...hits, ...frameHits];

  // 稀薄度（归一口径与重定向门 measureTextLen 一致：空白折叠后 trim 长度）
  const raw = document.body ? (document.body.innerText || '') : '';
  const textLen = raw.replace(/\s+/g, ' ').trim().length;
  const hasMain = !!document.querySelector('main, article, [role="main"]');
  // 可见可导航 iframe ≥200px（重定向门 MIN_BOX 同款尺度）——iframe 壳页的「稀薄」
  // 是重定向门的领地（占优内容 iframe 会自动跳转真实 URL），稀薄兜底不截胡；
  // 隐藏/离屏 iframe（广告位、预挂载登录挑战 frame）不算——与命中同口径可见性
  let hasFrame = false;
  for (const f of document.querySelectorAll('iframe')) {
    const src = iframeSrc(f); // 绝对化 URL：相对 src 的同源/跨域壳页都须正确判协议
    if (!src || !/^https?:/i.test(src)) continue;
    if (visibleArea(f) === null) continue;
    const r = f.getBoundingClientRect();
    if (r.width >= 200 && r.height >= 200) { hasFrame = true; break; }
  }
  // 稀薄判定唯一事实源（.mjs 编排层只消费 thin，不再复算——防两处口径漂移）
  const thin = textLen < textThreshold && !hasMain && !hasFrame;

  const title = (document.title || '').toLowerCase();
  const titleHit = titleKeywords.some((k) => title.includes(k));

  let maxArea = 0;
  for (const h of allHits) if (h.area > maxArea) maxArea = h.area;
  const areaChannel = maxArea >= areaRatio * vw * vh;
  // 文本通道的命中须够大：小面积 widget/badge 配稀薄正文不构成「整页是挑战」
  let bigHit = false;
  for (const h of allHits) if (h.area >= textChannelMinArea) { bigHit = true; break; }
  const textChannel = bigHit && textLen < textThreshold;

  return {
    captcha: { hits: allHits, dominant: areaChannel || textChannel, success, areaChannel, textChannel },
    titleHit,
    sparse: { textLen, hasMain, hasFrame, thin },
  };
}
