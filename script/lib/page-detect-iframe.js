// page-detect-iframe.js —— 占优内容 iframe 判定规则（唯一事实源）
// 普通非模块文件：恰好一个具名函数，Node 侧以文本读入注入页面执行：
//   page.evaluate(`(${src})(${JSON.stringify(cfg)})`)
// cfg（全部由 Node 侧测量后传入）:
//   mainText   主文档正文长度（归一化口径见 snapshot-redirect.mjs）
//   frameTexts { [frame 绝对 src（剥 hash）]: 正文长度 }
//   minFrameText / textRatio / minBox —— 阈值（可覆盖，默认 spec §4 常量）
// 返回 { redirect: { url, frameText } | null }——多候选取正文最长者。
function __u2mDetectContentFrame(cfg) {
  cfg = cfg || {};
  const MIN_FRAME_TEXT = cfg.minFrameText ?? 500; // frame 正文下限
  const TEXT_RATIO = cfg.textRatio ?? 3;          // frame 须 ≥ 比例 × 主文档正文
  const MIN_BOX = cfg.minBox ?? 200;              // iframe 可视盒下限（px）
  const mainText = cfg.mainText || 0;
  const frameTexts = cfg.frameTexts || {};
  const hereUrl = location.href.split('#')[0];
  let best = null;
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    const src = (f.src || '').split('#')[0];
    if (!/^https?:/i.test(src) || src === hereUrl) continue; // 可导航（排除 srcdoc/about:blank/自嵌套）
    const r = f.getBoundingClientRect();
    if (r.width < MIN_BOX || r.height < MIN_BOX) continue;   // 可见（排除隐藏工具 iframe）
    const textLen = frameTexts[src];
    if (typeof textLen !== 'number' || textLen < MIN_FRAME_TEXT) continue; // 内容量
    if (textLen < TEXT_RATIO * mainText) continue;            // 占优
    if (!best || textLen > best.frameText) best = { url: src, frameText: textLen };
  }
  return { redirect: best };
}
