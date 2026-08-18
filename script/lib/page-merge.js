function __u2mMergeIframes(minMainText) {
  const minMain = typeof minMainText === 'number' ? minMainText : 500;
  const textLen = (document.body && document.body.innerText ? document.body.innerText : '')
    .replace(/\s+/g, ' ').trim().length;
  if (textLen >= minMain) return 0; // 主文档内容充足，不合并（iframe 视作挂件）
  let rounds = 0;
  for (; rounds < 5; rounds++) {
    const frames = Array.from(document.querySelectorAll('iframe')).filter((f) => {
      try { return f.contentDocument && f.contentDocument.body; } catch (e) { return false; }
    });
    if (!frames.length) break;
    for (const f of frames) {
      const host = document.createElement('div');
      for (const n of Array.from(f.contentDocument.body.childNodes)) {
        host.appendChild(document.adoptNode(n));
      }
      f.replaceWith(host);
    }
  }
  return rounds;
}
