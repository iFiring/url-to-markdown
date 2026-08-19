function __u2mDeriveClassifyInput(cfg) {
  cfg = cfg || {};
  const N = typeof cfg.placeholderMinChars === 'number' ? cfg.placeholderMinChars : 40;

  // 白名单信号属性（spec §5.1：不含 color/font/text-*）。getComputedStyle 枚举的是长写属性。
  const isSignalProp = (p) => {
    if (/^(position|display|float|clear|visibility|box-shadow|transform|z-index|width|height|gap)$/.test(p)) return true;
    if (/^(min-|max-)(width|height)$/.test(p)) return true;
    if (/^overflow(-x|-y)?$/.test(p)) return true;
    if (/^border(-(top|right|bottom|left))?(-(width|style|color))?$/.test(p)) return true;
    if (/^border.*radius$/.test(p)) return true;
    if (p === 'background-color') return true;
    if (/^flex(-.+)?$/.test(p)) return true;
    if (/^grid(-.+)?$/.test(p)) return true;
    return false;
  };

  // 1. 长文本占位（含代码块文本——代码靠结构识别，内容不读）
  let k = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent && node.textContent.trim().length > N) {
      node.textContent = '{{T' + (++k) + '}}';
    }
    node = walker.nextNode();
  }

  // 2. 剥 <style>/<link rel=stylesheet>/<noscript>/<template>
  document.querySelectorAll('style,link[rel~="stylesheet"],noscript,template').forEach((e) => e.remove());

  // 3. 白名单信号样式内联（非信号样式全部抹掉，压 token）
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    const parts = [];
    for (let i = 0; i < cs.length; i++) {
      const prop = cs.item(i);
      if (isSignalProp(prop)) parts.push(prop + ':' + cs.getPropertyValue(prop));
    }
    el.removeAttribute('style');
    if (parts.length) el.setAttribute('style', parts.join(';'));
  });

  return document.body.outerHTML;
}
