function __u2mPrepareBody(cfg) {
  cfg = cfg || {};
  const MIN_MAIN_TEXT = typeof cfg.minMainText === 'number' ? cfg.minMainText : 500;
  // 不标记的纯文本修饰/薄语义行内标签（strong/br 之类只作用于文本，
  // 无独立结构意义；span/a/code/img 等可承载结构/链接/代码/图片，照常标记）
  const EXCLUDE_TAGS = new Set([
    'STRONG', 'EM', 'B', 'I', 'U', 'S', 'SMALL', 'MARK', 'SUB', 'SUP', 'BR', 'WBR',
    'ABBR', 'CITE', 'DFN', 'KBD', 'SAMP', 'VAR', 'Q', 'TIME', 'DATA', 'BDI', 'BDO',
    'RUBY', 'RP', 'RT',
  ]);

  // 1. 合并同源内容 iframe（吸收 __u2mMergeIframes，同阈值 500；主文档文本充足则不合并）
  const textLen = (document.body && document.body.innerText ? document.body.innerText : '')
    .replace(/\s+/g, ' ').trim().length;
  if (textLen < MIN_MAIN_TEXT) {
    for (let r = 0; r < 5; r++) {
      const frames = Array.from(document.querySelectorAll('iframe')).filter((f) => {
        try { return f.contentDocument && f.contentDocument.body; } catch (e) { return false; }
      });
      if (!frames.length) break;
      for (const f of frames) {
        const host = document.createElement('div');
        for (const n of Array.from(f.contentDocument.body.childNodes)) host.appendChild(document.adoptNode(n));
        f.replaceWith(host);
      }
    }
  }

  // 2. 注入 <base>（先于 src 绝对化）：相对 URL 在 setContent 重载时解析回源站
  if (!document.querySelector('base[data-u2m-base]')) {
    const b = document.createElement('base');
    b.setAttribute('data-u2m-base', '1');
    b.href = location.href.split('#')[0];
    document.head.prepend(b);
  }

  // 3. 内联外部 CSS（同步 XHR；fetch 失败的 <link> 原样保留，渲染时由 <base>+cookie+网络兜底）
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  const cssChunks = [];
  const kept = [];
  for (const l of links) {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', l.href, false); // 同步（函数不得 async，见约定测试）
      x.send();
      if (x.status >= 200 && x.status < 300) cssChunks.push(x.responseText);
      else kept.push(l);
    } catch (e) { kept.push(l); }
  }
  if (cssChunks.length) {
    const s = document.createElement('style');
    s.setAttribute('data-u2m-inlined', '1');
    s.textContent = cssChunks.join('\n');
    document.head.appendChild(s);
  }
  for (const l of links) if (!kept.includes(l)) l.remove();

  // 4. 剥尽 JS 与噪声标签 + on* 事件属性（mermaid 源码已由 pageInit 存为 data-u2m-mermaid-src）
  document.querySelectorAll('script,noscript,template').forEach((e) => e.remove());
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });

  // 5. 剥叶子噪声（复制按钮，防泄漏为文本噪声）
  document.querySelectorAll('.copy,.copy-btn,button[aria-label*="copy" i]').forEach((e) => e.remove());

  // 6. 资源 src 绝对化（依赖 <base>）：setContent 后页面是 about:blank，
  //    processImages 用 new URL(src, frame.url()) 解析相对 src 会失败，故抓取时绝对化。
  document.querySelectorAll('img[src],video[src],audio[src],source[src]').forEach((el) => {
    try { if (el.src) el.setAttribute('src', el.src); } catch (e) { /* 忽略 */ }
  });

  // 7. 打 data-idx：body 内所有元素按文档序递增标记，仅排除
  //    EXCLUDE_TAGS（纯文本修饰/薄语义行内标签）与 svg/math 内部后代
  //    （根元素本身标记；内部细节对下游不可见——步骤 2 剥 svg 属性，
  //    转换按原子块处理，标记内部只会膨胀快照）
  let n = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el = walker.nextNode();
  while (el) {
    const insideForeign = el.parentElement && el.parentElement.closest('svg, math');
    if (!EXCLUDE_TAGS.has(el.tagName.toUpperCase()) && !insideForeign) {
      el.setAttribute('data-idx', String(++n));
    }
    el = walker.nextNode();
  }
  return true;
}
