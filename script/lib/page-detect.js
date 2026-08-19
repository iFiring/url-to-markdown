async function __u2mDetectVirtualList(cfg) {
  cfg = cfg || {};
  const SIG_CHARS = cfg.signatureChars || 400;   // 顶部正文签名长度
  const ITERS = cfg.scrollIters || 60;           // 滚到底最大轮次（与 progressiveScroll 一致）
  const WAIT = cfg.scrollWait || 150;            // 每轮等待 ms

  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const bodyText = () => normalize(document.body.innerText || '');

  // 1) 顶部取签名：当前 innerText 归一化后前 SIG_CHARS 字符
  const sig = bodyText().slice(0, SIG_CHARS);
  if (!sig) return { isVirtualList: false, signature: '' };

  // 2) 滚到底加载全程（与 progressiveScroll 同款循环，至 scrollHeight 稳定）
  let last = -1;
  for (let i = 0; i < ITERS; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, WAIT));
    const h = document.documentElement.scrollHeight;
    if (h === last) break;
    last = h;
  }

  // 3) 关键时序：在底部、回顶之前检查。虚拟列表回顶会重新渲染顶部窗口，回顶后检查会失效。
  //    顶部签名仍在 → 普通长页（顶部只是滚出视口、节点仍在 DOM）；消失 → 节点被回收 → 虚拟列表。
  const now = bodyText();
  return { isVirtualList: !now.includes(sig), signature: sig };
}
