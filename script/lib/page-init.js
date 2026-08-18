function __u2mPageInit() {
  // 1) IntersectionObserver 劫持：callback 立即以 isIntersecting=true 触发（懒加载）
  if (window.IntersectionObserver) {
    window.IntersectionObserver = class {
      constructor(cb) { this._cb = cb; }
      observe(target) {
        try {
          this._cb([{ target, isIntersecting: true, intersectionRatio: 1, time: 0,
            boundingClientRect: target.getBoundingClientRect ? target.getBoundingClientRect() : {},
            rootBounds: null, intersectionRect: null }], this);
        } catch (e) { /* 业务回调异常不阻断 */ }
      }
      unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  }
  // 2) Mermaid 源码快照：抢在渲染替换前把 textContent 存进行 attribute
  const SEL = '.mermaid, pre.mermaid';
  const snap = (n) => {
    if (n.nodeType === 1 && n.matches && n.matches(SEL) && !n.hasAttribute('data-u2m-mermaid-src')) {
      n.setAttribute('data-u2m-mermaid-src', n.textContent || '');
    }
  };
  const scan = (root) => { if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(snap); };
  const start = () => {
    scan(document);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) { snap(n); if (n.nodeType === 1) scan(n); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
}
__u2mPageInit();
