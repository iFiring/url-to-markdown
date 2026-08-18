function __u2mClassify(cfg) {
  cfg = cfg || {};
  const SVG_MIN = cfg.svgMinSize || 24;          // 大尺寸 svg 阈值（>24×24 非图标）
  const MIN_W = cfg.minW || 200, MIN_H = cfg.minH || 150;  // 启发式最小可见尺寸
  const DENSITY = cfg.textDensity || 0.005;      // 文本密度阈值（字符/px²）
  const MIN_NON_TEXT = cfg.minNonText || 3;      // 非文本子元素最少数量
  const MIN_IFRAME_TEXT = cfg.minIframeText || 200;        // 同源内容型 iframe 文本量
  const SELECTORS = ['canvas', 'video', 'iframe', 'svg',
    '.MathJax', '.MathJax_Display', '.katex', '.katex-display',
    '.chart', '.echarts', '.highcharts', '[data-chart]', '[role="img"]',
    'div', 'section'].join(', ');

  function classify(el) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'CANVAS' || tag === 'VIDEO') return 'screenshot';
    if (tag === 'IFRAME') {
      let doc = null;
      try { doc = el.contentDocument; } catch (e) { /* 跨域 */ }
      if (doc && doc.body && (doc.body.innerText || '').trim().length >= MIN_IFRAME_TEXT) return 'same_origin_iframe';
      return 'screenshot';
    }
    if (tag === 'SVG') {
      const r = el.getBoundingClientRect();
      if (r.width > SVG_MIN || r.height > SVG_MIN) return 'passthrough_svg';
      return null;
    }
    if (el.matches('.MathJax,.MathJax_Display,.katex,.katex-display')) return 'latex';
    if (el.matches('.chart,.echarts,.highcharts,[data-chart],[role="img"]')) return 'svg_convert';
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_W && r.height >= MIN_H) {
      const text = el.textContent || '';
      if (text.length / (r.width * r.height) < DENSITY) {
        const nonText = el.querySelectorAll('img,svg,canvas,video,iframe,table,figure').length;
        if (nonText >= MIN_NON_TEXT) return 'svg_convert';
      }
    }
    return null;
  }

  const picked = [];
  for (const el of document.querySelectorAll(SELECTORS)) {
    if (el.closest('[data-u2m-type]')) continue; // 父子都命中只取最外层（文档序=先父后子）
    const t = classify(el);
    if (t) { el.setAttribute('data-u2m-type', t); picked.push({ type: t }); }
  }
  return picked;
}
